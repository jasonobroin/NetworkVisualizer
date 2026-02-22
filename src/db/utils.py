"""
Database utility functions.

Provides reset_db() for wiping the schema and seed_from_discovery() for
populating the database from Meraki discovery results.
"""

import logging
import os
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from src.db.database import engine, SessionLocal
from src.db.models import Base, Device, Link, Port, ScanMeta
from src.discovery.models import DiscoveryResult

logger = logging.getLogger(__name__)


def init_db() -> None:
    """
    Create all database tables if they do not already exist.

    Safe to call on every startup — uses CREATE TABLE IF NOT EXISTS semantics.
    """
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables initialised")


def reset_db() -> None:
    """
    Drop all tables and recreate the schema.

    ⚠️ Destructive — deletes ALL data including rooms and annotations.

    This function is protected: it will raise RuntimeError unless the
    RUNNING_IN_DOCKER environment variable is set to 'true'.
    This prevents accidental data loss in local development.
    """
    running_in_docker = os.environ.get("RUNNING_IN_DOCKER", "").lower()
    if running_in_docker != "true":
        raise RuntimeError(
            "reset_db() refused: RUNNING_IN_DOCKER is not 'true'. "
            "This operation must only be run inside the Docker container."
        )

    logger.warning("⚠️  RESETTING DATABASE — all data will be deleted")
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    logger.info("Database reset complete — empty schema recreated")


def seed_from_discovery(
    discovery_results: list[DiscoveryResult],
    db: Optional[Session] = None,
) -> dict[str, int]:
    """
    Upsert devices, ports, and links from a list of DiscoveryResult objects.

    Existing room assignments and manual device annotations (name overrides,
    notes, port_count, MAC, IP for unmanaged devices) are preserved.

    Args:
        discovery_results: Output of MerakiDiscoveryClient.run_discovery()
        db: Optional existing Session. If None, a new session is created.

    Returns:
        Summary dict with keys: devices_added, devices_updated, ports_added, links_added
    """
    summary = {"devices_added": 0, "devices_updated": 0, "ports_added": 0, "links_added": 0}

    def _run(session: Session) -> None:
        # Build a serial → Device lookup for existing managed devices
        existing_by_serial: dict[str, Device] = {
            d.serial: d
            for d in session.query(Device).filter(Device.serial.isnot(None)).all()
        }

        # serial → DB Device (populated during this run, for link building)
        serial_to_device: dict[str, Device] = {}
        # (device_id, port_id_str) → Port DB object
        port_lookup: dict[tuple[int, str], Port] = {}

        for result in discovery_results:
            for dev_info in result.devices:
                serial = dev_info.serial

                if serial in existing_by_serial:
                    # Update existing managed device — preserve user annotations
                    device = existing_by_serial[serial]
                    device.model = dev_info.model
                    device.device_type = dev_info.device_type.value
                    device.network_id = dev_info.network_id
                    device.network_name = dev_info.network_name
                    # Only update name if user hasn't customised it
                    # (we treat the Meraki name as the source of truth on rescan)
                    device.name = dev_info.name or device.name
                    device.mac = dev_info.mac or device.mac
                    device.ip = dev_info.ip or device.ip
                    summary["devices_updated"] += 1
                else:
                    # New device
                    device = Device(
                        serial=serial,
                        name=dev_info.name or serial,
                        model=dev_info.model,
                        device_type=dev_info.device_type.value,
                        is_managed=True,
                        mac=dev_info.mac,
                        ip=dev_info.ip,
                        network_id=dev_info.network_id,
                        network_name=dev_info.network_name,
                    )
                    session.add(device)
                    summary["devices_added"] += 1

                session.flush()  # Assign ID if new
                serial_to_device[serial] = device

                # --- Ports ---
                # Delete and recreate ports (port configs can change)
                if dev_info.ports:
                    existing_port_ids = {
                        p.port_id for p in session.query(Port)
                        .filter(Port.device_id == device.id).all()
                    }
                    for port_info in dev_info.ports:
                        neighbour = port_info.neighbour
                        if port_info.port_id in existing_port_ids:
                            # Update existing port
                            port = (
                                session.query(Port)
                                .filter(Port.device_id == device.id, Port.port_id == port_info.port_id)
                                .one()
                            )
                            port.name = port_info.name
                            port.enabled = port_info.enabled
                            port.link_state = port_info.link_state
                            port.speed = port_info.speed
                            port.vlan = port_info.vlan
                            port.poe_capable = port_info.poe_capable
                            port.poe_enabled = port_info.poe_enabled
                            port.poe_active = port_info.poe_active
                            port.poe_power_mw = port_info.poe_power_mw
                            port.neighbour_device_id = neighbour.device_id if neighbour else None
                            port.neighbour_platform = neighbour.platform if neighbour else None
                            port.neighbour_port_id = neighbour.port_id if neighbour else None
                            port.neighbour_ip = neighbour.ip_address if neighbour else None
                            port.neighbour_protocol = neighbour.protocol if neighbour else None
                        else:
                            port = Port(
                                device_id=device.id,
                                port_id=port_info.port_id,
                                name=port_info.name,
                                enabled=port_info.enabled,
                                link_state=port_info.link_state,
                                speed=port_info.speed,
                                vlan=port_info.vlan,
                                poe_capable=port_info.poe_capable,
                                poe_enabled=port_info.poe_enabled,
                                poe_active=port_info.poe_active,
                                poe_power_mw=port_info.poe_power_mw,
                                neighbour_device_id=neighbour.device_id if neighbour else None,
                                neighbour_platform=neighbour.platform if neighbour else None,
                                neighbour_port_id=neighbour.port_id if neighbour else None,
                                neighbour_ip=neighbour.ip_address if neighbour else None,
                                neighbour_protocol=neighbour.protocol if neighbour else None,
                            )
                            session.add(port)
                            summary["ports_added"] += 1

                        session.flush()
                        port_lookup[(device.id, port_info.port_id)] = port

        # --- Links (built from LLDP/CDP neighbour data) ---
        # Delete all managed links and rebuild from current discovery data
        session.query(Link).filter(Link.link_type.in_(["cdp", "lldp"])).delete(
            synchronize_session="fetch"
        )

        # Build lookup tables for multi-strategy neighbour resolution
        all_devices = session.query(Device).all()

        # Strategy 1: exact MAC match (normalised lower-case)
        mac_to_device: dict[str, Device] = {}
        for dev in all_devices:
            if dev.mac:
                mac_to_device[dev.mac.lower().strip()] = dev

        # Strategy 2: name/hostname match (case-insensitive) — used for CDP device IDs
        name_to_device: dict[str, Device] = {}
        for dev in all_devices:
            if dev.name:
                name_to_device[dev.name.lower().strip()] = dev
            if dev.serial:
                name_to_device[dev.serial.lower().strip()] = dev

        def _mac_to_int(mac: str) -> int | None:
            """Convert colon-separated MAC to integer, return None on error."""
            try:
                return int(mac.replace(":", "").replace("-", ""), 16)
            except ValueError:
                return None

        def _int_to_mac(n: int) -> str:
            """Convert integer back to colon-separated MAC string."""
            return ":".join(f"{(n >> (i * 8)) & 0xFF:02x}" for i in reversed(range(6)))

        def _resolve_neighbour(device_id: str, platform: str | None) -> Device | None:
            """
            Resolve an LLDP/CDP neighbour device_id to a Device in the database.

            Strategies tried in order:
            1. Exact MAC match — works for most managed Meraki devices
            2. MAC ± small offset — Meraki APs advertise a bridge/radio MAC via LLDP
               that differs from their management MAC by a small offset (typically
               within ±16 of the last two octets)
            3. Case-insensitive name/hostname match — CDP device_id is often a hostname
            4. Serial number match — some devices advertise their serial via CDP
            """
            normalised = device_id.lower().strip()

            # Strategy 1: exact MAC
            if ":" in normalised or "-" in normalised:
                match = mac_to_device.get(normalised.replace("-", ":"))
                if match:
                    return match

                # Strategy 2: MAC ± offset (handles Meraki AP radio vs management MAC)
                n = _mac_to_int(normalised)
                if n is not None:
                    for offset in range(-16, 17):
                        if offset == 0:
                            continue
                        candidate = _int_to_mac(n + offset)
                        match = mac_to_device.get(candidate)
                        if match:
                            logger.debug(
                                "Resolved %s via MAC offset %+d → %s (%s)",
                                device_id, offset, match.name, candidate,
                            )
                            return match

            # Strategy 3: hostname / name match (CDP often sends sysName)
            match = name_to_device.get(normalised)
            if match:
                return match

            # Strategy 4: platform string contains a serial or name we know
            if platform:
                for name, dev in name_to_device.items():
                    if name and name in platform.lower():
                        return dev

            return None

        # Track already-added links to deduplicate bidirectional LLDP pairs
        # Key: frozenset of {src_device_id, dst_device_id}
        seen_links: set[frozenset] = set()

        for result in discovery_results:
            for dev_info in result.devices:
                src_device = serial_to_device.get(dev_info.serial)
                if not src_device:
                    continue
                for port_info in dev_info.ports:
                    neighbour = port_info.neighbour
                    if not neighbour or not neighbour.device_id:
                        continue

                    dst_device = _resolve_neighbour(
                        neighbour.device_id, neighbour.platform
                    )

                    if dst_device is None:
                        logger.debug(
                            "Could not resolve LLDP/CDP neighbour %r on %s port %s",
                            neighbour.device_id, dev_info.serial, port_info.port_id,
                        )
                        continue

                    # Deduplicate: LLDP reports both sides of every link
                    link_key = frozenset([src_device.id, dst_device.id])
                    if link_key in seen_links:
                        continue
                    seen_links.add(link_key)

                    src_port = port_lookup.get((src_device.id, port_info.port_id))

                    link = Link(
                        src_device_id=src_device.id,
                        src_port_id=src_port.id if src_port else None,
                        dst_device_id=dst_device.id,
                        dst_port_id=None,
                        link_type=neighbour.protocol,
                        notes=f"{neighbour.platform or ''} on port {neighbour.port_id or ''}".strip(),
                    )
                    session.add(link)
                    summary["links_added"] += 1

        # ── Persist scan metadata (org name, network names, timestamp) ──────
        if discovery_results:
            first = discovery_results[0]
            all_net_names = sorted({
                dev.network_name
                for result in discovery_results
                for dev in result.devices
                if dev.network_name
            })
            meta = session.get(ScanMeta, 1)
            if meta is None:
                meta = ScanMeta(id=1)
                session.add(meta)
            meta.org_name = first.organisation_name
            meta.org_id   = first.organisation_id
            meta.network_names = ", ".join(all_net_names)
            meta.last_scan_at  = datetime.now(timezone.utc).isoformat()

        session.commit()

    if db is not None:
        _run(db)
    else:
        with SessionLocal() as session:
            _run(session)

    logger.info(
        "Seed complete: %d added, %d updated, %d ports, %d links",
        summary["devices_added"],
        summary["devices_updated"],
        summary["ports_added"],
        summary["links_added"],
    )
    return summary


