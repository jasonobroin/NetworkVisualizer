"""
Room management routes.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from src.api.schemas import RoomCreate, RoomRead
from src.db.database import get_db
from src.db.models import Room

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/rooms", response_model=list[RoomRead], summary="List all rooms")
def list_rooms(db: Session = Depends(get_db)) -> list[RoomRead]:
    """Return all rooms, ordered by name."""
    rooms = db.query(Room).order_by(Room.name).all()
    return [RoomRead.model_validate(r) for r in rooms]


@router.post("/rooms", response_model=RoomRead, status_code=201, summary="Create a new room")
def create_room(body: RoomCreate, db: Session = Depends(get_db)) -> RoomRead:
    """
    Create a new room.

    Room names must be unique. Returns 409 if the name already exists.
    """
    existing = db.query(Room).filter(Room.name == body.name).first()
    if existing:
        raise HTTPException(status_code=409, detail={"error": f"Room '{body.name}' already exists"})

    room = Room(name=body.name, notes=body.notes)
    db.add(room)
    db.commit()
    db.refresh(room)
    logger.info("Created room: %s (id=%d)", room.name, room.id)
    return RoomRead.model_validate(room)


@router.patch("/rooms/{room_id}", response_model=RoomRead, summary="Update a room")
def update_room(
    room_id: int,
    body: RoomCreate,
    db: Session = Depends(get_db),
) -> RoomRead:
    """Update a room's name or notes."""
    room = db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail={"error": f"Room {room_id} not found"})
    room.name = body.name
    room.notes = body.notes
    db.commit()
    db.refresh(room)
    return RoomRead.model_validate(room)


@router.delete("/rooms/{room_id}", status_code=204, summary="Delete a room")
def delete_room(room_id: int, db: Session = Depends(get_db)) -> None:
    """
    Delete a room.

    Device room assignments for this room are automatically removed (cascade).
    """
    room = db.get(Room, room_id)
    if not room:
        raise HTTPException(status_code=404, detail={"error": f"Room {room_id} not found"})
    db.delete(room)
    db.commit()
    logger.info("Deleted room %d", room_id)

