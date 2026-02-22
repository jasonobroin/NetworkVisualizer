"""
SQLAlchemy ORM models for the NetworkVisualizer database.

Tables:
- rooms         — physical locations (rooms/areas)
- devices       — managed (Meraki) and unmanaged (manually annotated) devices
- ports         — switch ports belonging to managed devices
- links         — wired connections between devices/ports
- device_rooms  — many-to-one assignment of a device to a room
"""

from typing import Optional

from sqlalchemy import (
    Boolean,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    """Shared declarative base for all ORM models."""
    pass


class Room(Base):
    """A physical location — a room or area in the building."""

    __tablename__ = "rooms"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False, unique=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    device_rooms: Mapped[list["DeviceRoom"]] = relationship(
        "DeviceRoom", back_populates="room", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Room id={self.id} name={self.name!r}>"


class Device(Base):
    """
    A network device — either managed (discovered via Meraki API) or
    unmanaged (manually annotated by the user).
    """

    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    serial: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(256), nullable=False)
    model: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    device_type: Mapped[str] = mapped_column(
        String(32), nullable=False, default="other"
    )  # mx / ms / mr / router / other
    is_managed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    mac: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    port_count: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    network_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    network_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)

    # Relationships
    ports: Mapped[list["Port"]] = relationship(
        "Port", back_populates="device", cascade="all, delete-orphan"
    )
    device_rooms: Mapped[list["DeviceRoom"]] = relationship(
        "DeviceRoom", back_populates="device", cascade="all, delete-orphan"
    )
    src_links: Mapped[list["Link"]] = relationship(
        "Link", foreign_keys="Link.src_device_id", back_populates="src_device"
    )
    dst_links: Mapped[list["Link"]] = relationship(
        "Link", foreign_keys="Link.dst_device_id", back_populates="dst_device"
    )

    def __repr__(self) -> str:
        return f"<Device id={self.id} name={self.name!r} model={self.model!r}>"


class Port(Base):
    """A single network port on a managed switch device."""

    __tablename__ = "ports"
    __table_args__ = (
        UniqueConstraint("device_id", "port_id", name="uq_device_port"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    port_id: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    link_state: Mapped[str] = mapped_column(String(16), nullable=False, default="unknown")
    speed: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    vlan: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    poe_capable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    poe_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    poe_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    poe_power_mw: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # LLDP/CDP neighbour snapshot stored as plain strings
    neighbour_device_id: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    neighbour_platform: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    neighbour_port_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    neighbour_ip: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    neighbour_protocol: Mapped[Optional[str]] = mapped_column(String(8), nullable=True)

    # Relationships
    device: Mapped["Device"] = relationship("Device", back_populates="ports")
    src_links: Mapped[list["Link"]] = relationship(
        "Link", foreign_keys="Link.src_port_id", back_populates="src_port"
    )
    dst_links: Mapped[list["Link"]] = relationship(
        "Link", foreign_keys="Link.dst_port_id", back_populates="dst_port"
    )

    def __repr__(self) -> str:
        return f"<Port id={self.id} device_id={self.device_id} port_id={self.port_id!r}>"


class Link(Base):
    """A wired connection between two devices, optionally referencing specific ports."""

    __tablename__ = "links"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    src_device_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    src_port_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("ports.id", ondelete="SET NULL"), nullable=True
    )
    dst_device_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("devices.id", ondelete="SET NULL"), nullable=True
    )
    dst_port_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("ports.id", ondelete="SET NULL"), nullable=True
    )
    link_type: Mapped[str] = mapped_column(
        String(16), nullable=False, default="unknown"
    )  # cdp / lldp / manual / unknown
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    src_device: Mapped["Device"] = relationship(
        "Device", foreign_keys=[src_device_id], back_populates="src_links"
    )
    src_port: Mapped[Optional["Port"]] = relationship(
        "Port", foreign_keys=[src_port_id], back_populates="src_links"
    )
    dst_device: Mapped[Optional["Device"]] = relationship(
        "Device", foreign_keys=[dst_device_id], back_populates="dst_links"
    )
    dst_port: Mapped[Optional["Port"]] = relationship(
        "Port", foreign_keys=[dst_port_id], back_populates="dst_links"
    )

    def __repr__(self) -> str:
        return (
            f"<Link id={self.id} "
            f"src={self.src_device_id}:{self.src_port_id} "
            f"dst={self.dst_device_id}:{self.dst_port_id} "
            f"type={self.link_type!r}>"
        )


class DeviceRoom(Base):
    """Assignment of a device to a room (many devices → one room)."""

    __tablename__ = "device_rooms"
    __table_args__ = (
        UniqueConstraint("device_id", name="uq_device_room"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("devices.id", ondelete="CASCADE"), nullable=False
    )
    room_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False
    )

    # Relationships
    device: Mapped["Device"] = relationship("Device", back_populates="device_rooms")
    room: Mapped["Room"] = relationship("Room", back_populates="device_rooms")

    def __repr__(self) -> str:
        return f"<DeviceRoom device_id={self.device_id} room_id={self.room_id}>"


class ScanMeta(Base):
    """
    Singleton-style table storing metadata about the last successful scan.

    Only one row is ever kept (id=1). Stores the Meraki organisation name,
    a comma-separated list of network names seen, and the UTC timestamp of
    the last scan.
    """

    __tablename__ = "scan_meta"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    org_name: Mapped[Optional[str]] = mapped_column(String(256), nullable=True)
    org_id: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    network_names: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # comma-separated
    last_scan_at: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)  # ISO 8601

    def __repr__(self) -> str:
        return f"<ScanMeta org={self.org_name!r} last_scan={self.last_scan_at!r}>"

