"""
Device routes — annotation and room assignment.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from src.api.schemas import DeviceRead, DeviceRoomUpdate, DeviceUpdate, LinkRead, ManualLinkCreate, PortRead, UnmanagedDeviceCreate
from src.db.database import get_db
from src.db.models import Device, DeviceRoom, Link, Port, Room

logger = logging.getLogger(__name__)
router = APIRouter()


def _device_to_read(device: Device, db: Session) -> DeviceRead:
    """Build a DeviceRead response, resolving room assignment."""
    dr = db.query(DeviceRoom).filter(DeviceRoom.device_id == device.id).first()
    room_id, room_name = None, None
    if dr:
        room = db.get(Room, dr.room_id)
        if room:
            room_id, room_name = room.id, room.name
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
        ports=[PortRead.from_orm_port(p) for p in device.ports],
    )


@router.get("/devices", response_model=list[DeviceRead], summary="List all devices")
def list_devices(db: Session = Depends(get_db)) -> list[DeviceRead]:
    """Return all devices (managed and unmanaged) with their ports and room assignments."""
    devices = db.query(Device).order_by(Device.name).all()
    return [_device_to_read(d, db) for d in devices]


@router.post("/devices/unmanaged", response_model=DeviceRead, status_code=201,
             summary="Manually add an unmanaged device")
def create_unmanaged_device(
    body: UnmanagedDeviceCreate,
    db: Session = Depends(get_db),
) -> DeviceRead:
    """
    Add a manually-entered unmanaged device (e.g. a cheap router with no API).

    The device will appear in the topology as an annotated node.
    """
    device = Device(
        serial=None,
        name=body.name,
        model=None,
        device_type=body.device_type,
        is_managed=False,
        mac=body.mac,
        ip=body.ip,
        port_count=body.port_count,
        notes=body.notes,
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    logger.info("Created unmanaged device: %s (id=%d)", device.name, device.id)
    return _device_to_read(device, db)


@router.patch("/device/{device_id}", response_model=DeviceRead, summary="Annotate a device")
def update_device(
    device_id: int,
    body: DeviceUpdate,
    db: Session = Depends(get_db),
) -> DeviceRead:
    """
    Update a device's annotation fields.

    All fields are optional — only provided fields are updated.
    Works for both managed and unmanaged devices.
    """
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail={"error": f"Device {device_id} not found"})

    if body.name is not None:
        device.name = body.name
    if body.device_type is not None:
        device.device_type = body.device_type
    if body.port_count is not None:
        device.port_count = body.port_count
    if body.notes is not None:
        device.notes = body.notes
    if body.mac is not None:
        device.mac = body.mac
    if body.ip is not None:
        device.ip = body.ip

    db.commit()
    db.refresh(device)
    logger.info("Updated device %d: %s", device.id, device.name)
    return _device_to_read(device, db)


@router.patch("/device/{device_id}/room", response_model=DeviceRead, summary="Assign device to a room")
def assign_device_room(
    device_id: int,
    body: DeviceRoomUpdate,
    db: Session = Depends(get_db),
) -> DeviceRead:
    """
    Assign a device to a room, or unassign it by passing room_id=null.

    Creates or updates the DeviceRoom record.
    """
    device = db.get(Device, device_id)
    if not device:
        raise HTTPException(status_code=404, detail={"error": f"Device {device_id} not found"})

    # Remove existing assignment
    db.query(DeviceRoom).filter(DeviceRoom.device_id == device_id).delete()

    if body.room_id is not None:
        room = db.get(Room, body.room_id)
        if not room:
            raise HTTPException(status_code=404, detail={"error": f"Room {body.room_id} not found"})
        db.add(DeviceRoom(device_id=device_id, room_id=body.room_id))
        logger.info("Assigned device %d to room %d (%s)", device_id, body.room_id, room.name)
    else:
        logger.info("Unassigned device %d from room", device_id)

    db.commit()
    db.refresh(device)
    return _device_to_read(device, db)


@router.post("/link", response_model=LinkRead, status_code=201,
             summary="Manually create a link between a port and a device")
def create_manual_link(
    body: ManualLinkCreate,
    db: Session = Depends(get_db),
) -> LinkRead:
    """
    Create a manual wired link between a source port and a destination device.

    Use this for connections that can't be auto-discovered via LLDP/CDP,
    e.g. an AP downstream port connected to a NUC.
    """
    port = db.get(Port, body.src_port_id)
    if not port:
        raise HTTPException(status_code=404, detail={"error": f"Port {body.src_port_id} not found"})
    dst = db.get(Device, body.dst_device_id)
    if not dst:
        raise HTTPException(status_code=404, detail={"error": f"Device {body.dst_device_id} not found"})

    # Remove any existing manual link from this port
    db.query(Link).filter(
        Link.src_port_id == body.src_port_id,
        Link.link_type == "manual",
    ).delete(synchronize_session="fetch")

    link = Link(
        src_device_id=port.device_id,
        src_port_id=port.id,
        dst_device_id=body.dst_device_id,
        dst_port_id=None,
        link_type="manual",
        notes=body.notes or f"Manually linked to {dst.name}",
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    logger.info(
        "Manual link created: port %d → device %d (%s)",
        port.id, dst.id, dst.name,
    )
    return LinkRead.model_validate(link)


@router.delete("/link/{link_id}", status_code=204, summary="Delete a manual link")
def delete_manual_link(
    link_id: int,
    db: Session = Depends(get_db),
) -> None:
    """
    Delete a manual link by ID.  Only manual links can be deleted this way;
    LLDP/CDP links are rebuilt on every scan.
    """
    link = db.get(Link, link_id)
    if not link:
        raise HTTPException(status_code=404, detail={"error": f"Link {link_id} not found"})
    if link.link_type != "manual":
        raise HTTPException(
            status_code=400,
            detail={"error": "Only manual links can be deleted. LLDP/CDP links are managed by scans."},
        )
    db.delete(link)
    db.commit()
    logger.info("Manual link %d deleted", link_id)

