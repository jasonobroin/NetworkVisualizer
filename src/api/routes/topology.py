"""
Topology routes — return the full graph payload for the Cytoscape.js frontend.
"""

import logging

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from src.api.schemas import DeviceRead, LinkRead, PortRead, RoomRead, TopologyResponse
from src.db.database import get_db
from src.db.models import Device, DeviceRoom, Link, Room

logger = logging.getLogger(__name__)
router = APIRouter()

# Model prefixes that indicate sensor/smart-home devices — not wired infra
_SENSOR_MODEL_PREFIXES = ("MT", "HS-", "SM", "MC", "MG")


def _is_infrastructure(device: Device) -> bool:
    """
    Return True if this device is wired network infrastructure.

    Filters out Meraki sensors (MT*) and smart-home devices (HS-*).
    Keeps MS, MX, MR, CW, MV cameras, and unmanaged devices.
    """
    if not device.is_managed:
        return True  # Always show manually-added unmanaged devices
    model = (device.model or "").upper()
    for prefix in _SENSOR_MODEL_PREFIXES:
        if model.startswith(prefix.upper()):
            return False
    return True


def _build_device_read(device: Device, room_id: int | None, room_name: str | None) -> DeviceRead:
    """Assemble a DeviceRead from an ORM Device, including ports and room info."""
    ports = [PortRead.from_orm_port(p) for p in device.ports]
    return DeviceRead(
        id=device.id,
        serial=device.serial,
        name=device.name,
        model=device.model,
        device_type=device.device_type,
        is_managed=device.is_managed,
        mac=device.mac,
        ip=device.ip,
        port_count=device.port_count or len(device.ports) or None,
        notes=device.notes,
        network_id=device.network_id,
        network_name=device.network_name,
        room_id=room_id,
        room_name=room_name,
        ports=ports,
    )


@router.get("/topology", response_model=TopologyResponse, summary="Get full network topology graph")
def get_topology(
    wired_only: bool = Query(default=True, description="Exclude sensors and smart-home devices"),
    db: Session = Depends(get_db),
) -> TopologyResponse:
    """
    Return the full network topology as a JSON payload for Cytoscape.js.

    By default (wired_only=true) only network devices are returned:
    switches (MS), routers/firewalls (MX), wireless APs (MR/CW), cameras (MV),
    and unmanaged devices.  Sensors (MT*) and smart-home devices are excluded.

    Pass ?wired_only=false to include all discovered devices.
    """
    rooms = db.query(Room).order_by(Room.name).all()
    all_devices = db.query(Device).order_by(Device.name).all()
    all_links = db.query(Link).all()

    # Apply infrastructure filter
    devices = [d for d in all_devices if (not wired_only) or _is_infrastructure(d)]
    visible_ids = {d.id for d in devices}

    # Only include links where both endpoints are in the visible set
    links = [
        lnk for lnk in all_links
        if lnk.src_device_id in visible_ids and (lnk.dst_device_id or 0) in visible_ids
    ]

    # Build device_id → (room_id, room_name) lookup
    room_assignments: dict[int, tuple[int, str]] = {}
    for dr in db.query(DeviceRoom).all():
        room = db.get(Room, dr.room_id)
        if room:
            room_assignments[dr.device_id] = (room.id, room.name)

    device_reads = []
    for device in devices:
        assignment = room_assignments.get(device.id)
        rid, rname = assignment if assignment else (None, None)
        ports = [PortRead.from_orm_port(p) for p in device.ports]
        device_reads.append(DeviceRead(
            id=device.id,
            serial=device.serial,
            name=device.name,
            model=device.model,
            device_type=device.device_type,
            is_managed=device.is_managed,
            mac=device.mac,
            ip=device.ip,
            port_count=device.port_count or len(device.ports) or None,
            notes=device.notes,
            network_id=device.network_id,
            network_name=device.network_name,
            room_id=rid,
            room_name=rname,
            ports=ports,
        ))

    logger.info(
        "Topology: %d devices (%d filtered), %d links (wired_only=%s)",
        len(devices), len(all_devices) - len(devices), len(links), wired_only,
    )

    return TopologyResponse(
        rooms=[RoomRead.model_validate(r) for r in rooms],
        devices=device_reads,
        links=[LinkRead.model_validate(lnk) for lnk in links],
    )
