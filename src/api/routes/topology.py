"""
Topology routes — return the full graph payload for the Cytoscape.js frontend.
"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from src.api.schemas import DeviceRead, LinkRead, PortRead, RoomRead, TopologyResponse
from src.db.database import get_db
from src.db.models import Device, DeviceRoom, Link, Room

logger = logging.getLogger(__name__)
router = APIRouter()


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
def get_topology(db: Session = Depends(get_db)) -> TopologyResponse:
    """
    Return the full network topology as a JSON payload for Cytoscape.js.

    Includes all rooms, devices (with ports and PoE data), and wired links.
    Devices without a room assignment have room_id=null.
    """
    rooms = db.query(Room).order_by(Room.name).all()
    devices = db.query(Device).order_by(Device.name).all()
    links = db.query(Link).all()

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
        device_reads.append(_build_device_read(device, rid, rname))

    return TopologyResponse(
        rooms=[RoomRead.model_validate(r) for r in rooms],
        devices=device_reads,
        links=[LinkRead.model_validate(lnk) for lnk in links],
    )

