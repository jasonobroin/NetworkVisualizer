"""
Database utility functions.

Provides reset_db() for wiping the schema and seed_from_discovery() for
populating the database from Meraki discovery results.
"""

import logging
import os
from typing import Optional

from sqlalchemy.orm import Session

from src.db.database import engine, SessionLocal
from src.db.models import Base, Device, Link, Port
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

        for result in discovery_results:
            for dev_info in result.devices:
                src_device = serial_to_device.get(dev_info.serial)
                if not src_device:
                    continue
                for port_info in dev_info.ports:
                    neighbour = port_info.neighbour
                    if not neighbour or not neighbour.device_id:
                        continue

                    # Try to find the destination device by its Meraki serial or name
                    dst_device = (
                        session.query(Device)
                        .filter(
                            (Device.serial == neighbour.device_id)
                            | (Device.name == neighbour.device_id)
                        )
                        .first()
                    )

                    src_port = port_lookup.get((src_device.id, port_info.port_id))

                    link = Link(
                        src_device_id=src_device.id,
                        src_port_id=src_port.id if src_port else None,
                        dst_device_id=dst_device.id if dst_device else None,
                        dst_port_id=None,  # We don't always know the remote port ID
                        link_type=neighbour.protocol,
                        notes=f"{neighbour.platform or ''} on port {neighbour.port_id or ''}".strip(),
                    )
                    session.add(link)
                    summary["links_added"] += 1

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


