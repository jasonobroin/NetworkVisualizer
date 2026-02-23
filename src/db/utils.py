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

        # Strategy 5: also index truncated hostnames — CDP device_id is sometimes
        # the short hostname (e.g. "Jason-9800-L") while the DB device name has a
        # suffix (e.g. "Jason-9800-CL").  Build a secondary lookup keyed on the
        # first token before any trailing variant suffix.
        # Also build a model → device map for platform-string matching (Strategy 6).
        model_to_device: dict[str, Device] = {}
        for dev in all_devices:
            if dev.model:
                model_to_device[dev.model.lower().strip()] = dev

        def _resolve_neighbour(device_id: str, platform: str | None) -> Device | None:
            """
            Resolve an LLDP/CDP neighbour device_id to a Device in the database.

            Strategies tried in order:
            1. Exact MAC match
            2. MAC ± small offset (Meraki AP radio vs management MAC)
            3. Case-insensitive name/hostname exact match
            4. Platform string contains a known device name or serial
            """
            normalised = device_id.lower().strip()

            # Strategy 1: exact MAC (only attempt if it looks like a MAC address)
            parts = normalised.replace("-", ":").split(":")
            if len(parts) == 6 and all(len(p) <= 2 for p in parts):
                mac_norm = normalised.replace("-", ":")
                match = mac_to_device.get(mac_norm)
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

            # Strategy 3: exact hostname / name match
            match = name_to_device.get(normalised)
            if match:
                return match

            # Strategy 4: platform string contains a serial or name we know
            if platform:
                for name, dev in name_to_device.items():
                    if name and name in platform.lower():
                        return dev

            return None

        def _get_or_create_placeholder(
            session: Session,
            device_id: str,
            platform: str | None,
            ip: str | None,
        ) -> Device:
            """
            Return an existing unmanaged placeholder for this neighbour device_id,
            or create one if it doesn't exist yet.

            Placeholders are created for CDP/LLDP neighbours that cannot be
            resolved to a known managed device — e.g. non-Meraki gear seen via CDP.
            The device_id (usually a hostname) is used as the serial key so we
            don't create duplicates on re-scan.
            """
            # Use a synthetic serial: "cdp:<device_id>" to avoid clashing with
            # real Meraki serials
            synthetic_serial = f"cdp:{device_id}"
            existing = session.query(Device).filter_by(serial=synthetic_serial).first()
            if existing:
                # Refresh IP/platform if we have better info now
                if ip and not existing.ip:
                    existing.ip = ip
                return existing

            # Derive a device type from the platform string if possible
            dev_type = "other"
            if platform:
                p = platform.upper()
                if any(x in p for x in ("MS", "SWITCH", "CATALYST")):
                    dev_type = "ms"
                elif any(x in p for x in ("MR", "CW", "ACCESS POINT", "AIR-AP", "AP SOFTWARE")):
                    dev_type = "mr"
                elif any(x in p for x in ("MX", "FIREWALL", "ASA")):
                    dev_type = "mx"
                elif any(x in p for x in ("C9800", "WLC", "WIRELESS LAN")):
                    dev_type = "other"

            placeholder = Device(
                serial=synthetic_serial,
                name=device_id,            # use the CDP hostname as display name
                model=_extract_model(platform) or "Unknown",
                device_type=dev_type,
                is_managed=False,          # unmanaged — user can annotate
                ip=ip,
                notes=f"Auto-created from CDP/LLDP neighbour data. Platform: {platform or '—'}",
            )
            session.add(placeholder)
            session.flush()
            logger.info(
                "Created placeholder device %r (serial=%s) from CDP/LLDP",
                device_id, synthetic_serial,
            )
            # Add to lookup so subsequent ports on this scan resolve to it
            name_to_device[device_id.lower().strip()] = placeholder
            return placeholder

        def _extract_model(platform: str | None) -> str | None:
            """
            Attempt to extract a model string from a CDP platform field.
            e.g. "cisco C9800-L-C-K9" → "C9800-L-C-K9"
            """
            if not platform:
                return None
            # Take the last whitespace-separated token if it looks like a model
            tokens = platform.strip().split()
            if tokens:
                candidate = tokens[-1]
                # Looks like a model if it contains letters and digits/hyphens
                if any(c.isalpha() for c in candidate) and any(c.isdigit() for c in candidate):
                    return candidate
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
                        # Can't resolve to a known device — create an unmanaged
                        # placeholder so the link is still visible in the UI.
                        dst_device = _get_or_create_placeholder(
                            session,
                            neighbour.device_id,
                            neighbour.platform,
                            neighbour.ip_address,
                        )

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


