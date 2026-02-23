"""
Pydantic v2 request/response schemas for the NetworkVisualizer API.

Separate Create, Update, and Read schemas are defined where appropriate.
All ORM-mapped Read schemas use model_config = ConfigDict(from_attributes=True).
"""

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Room schemas
# ---------------------------------------------------------------------------

class RoomCreate(BaseModel):
    """Request body for creating a new room."""

    name: str = Field(min_length=1, max_length=128)
    notes: Optional[str] = None


class RoomRead(BaseModel):
    """Response schema for a room."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Port schemas
# ---------------------------------------------------------------------------

class NeighbourRead(BaseModel):
    """CDP/LLDP neighbour information for a port."""

    protocol: Optional[str] = None
    device_id: Optional[str] = None
    platform: Optional[str] = None
    port_id: Optional[str] = None
    ip: Optional[str] = None


class PortRead(BaseModel):
    """Response schema for a single switch port."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    port_id: str
    name: Optional[str] = None
    enabled: bool
    link_state: str
    speed: Optional[str] = None
    vlan: Optional[int] = None
    poe_capable: bool
    poe_enabled: bool
    poe_active: bool
    poe_power_mw: Optional[float] = None
    neighbour: Optional[NeighbourRead] = None

    @classmethod
    def from_orm_port(cls, port) -> "PortRead":
        """Build a PortRead from an ORM Port, assembling the neighbour sub-object."""
        neighbour = None
        if port.neighbour_device_id or port.neighbour_platform:
            neighbour = NeighbourRead(
                protocol=port.neighbour_protocol,
                device_id=port.neighbour_device_id,
                platform=port.neighbour_platform,
                port_id=port.neighbour_port_id,
                ip=port.neighbour_ip,
            )
        return cls(
            id=port.id,
            port_id=port.port_id,
            name=port.name,
            enabled=port.enabled,
            link_state=port.link_state,
            speed=port.speed,
            vlan=port.vlan,
            poe_capable=port.poe_capable,
            poe_enabled=port.poe_enabled,
            poe_active=port.poe_active,
            poe_power_mw=port.poe_power_mw,
            neighbour=neighbour,
        )


# ---------------------------------------------------------------------------
# Device schemas
# ---------------------------------------------------------------------------

class DeviceUpdate(BaseModel):
    """Request body for annotating/updating a device (managed or unmanaged)."""

    name: Optional[str] = Field(default=None, max_length=256)
    device_type: Optional[str] = Field(default=None, pattern="^(mx|ms|mr|router|other)$")
    port_count: Optional[int] = Field(default=None, ge=1)
    notes: Optional[str] = None
    mac: Optional[str] = Field(default=None, max_length=32)
    ip: Optional[str] = Field(default=None, max_length=64)


class DeviceRoomUpdate(BaseModel):
    """Request body for assigning a device to a room."""

    room_id: Optional[int] = Field(default=None, description="Room ID, or null to unassign")


class DeviceRead(BaseModel):
    """Response schema for a device, including its ports and room assignment."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    serial: Optional[str] = None
    name: str
    model: Optional[str] = None
    device_type: str
    is_managed: bool
    mac: Optional[str] = None
    ip: Optional[str] = None
    port_count: Optional[int] = None
    notes: Optional[str] = None
    network_id: Optional[str] = None
    network_name: Optional[str] = None
    room_id: Optional[int] = None
    room_name: Optional[str] = None
    ports: list[PortRead] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Link schemas
# ---------------------------------------------------------------------------

class LinkRead(BaseModel):
    """Response schema for a wired link between two devices."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    src_device_id: int
    src_port_id: Optional[int] = None
    dst_device_id: Optional[int] = None
    dst_port_id: Optional[int] = None
    link_type: str
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Manual link schema
# ---------------------------------------------------------------------------

class ManualLinkCreate(BaseModel):
    """Request body for manually creating a link between a port and a device."""

    src_port_id: int = Field(description="DB id of the source port")
    dst_device_id: int = Field(description="DB id of the destination device")
    notes: Optional[str] = None


# ---------------------------------------------------------------------------
# Topology schema (composite for the frontend)
# ---------------------------------------------------------------------------

class NetworkSummary(BaseModel):
    """High-level summary of the Meraki org shown in the UI header."""

    org_name: Optional[str] = None
    org_id: Optional[str] = None
    network_names: list[str] = Field(default_factory=list)
    last_scan_at: Optional[str] = None
    total_devices: int = 0


class TopologyResponse(BaseModel):
    """Full topology payload consumed by the Cytoscape.js frontend."""

    rooms: list[RoomRead]
    devices: list[DeviceRead]
    links: list[LinkRead]
    summary: NetworkSummary = Field(default_factory=NetworkSummary)


# ---------------------------------------------------------------------------
# Scan / admin schemas
# ---------------------------------------------------------------------------

class ScanResponse(BaseModel):
    """Response returned after a discovery scan."""

    devices_added: int
    devices_updated: int
    ports_added: int
    links_added: int
    errors: list[str] = Field(default_factory=list)
    scanned_at: str


class ResetResponse(BaseModel):
    """Response returned after a database reset."""

    reset: bool


class UnmanagedDeviceCreate(BaseModel):
    """Request body for manually adding an unmanaged device."""

    name: str = Field(min_length=1, max_length=256)
    device_type: str = Field(default="other", pattern="^(mx|ms|mr|router|other)$")
    port_count: Optional[int] = Field(default=None, ge=1)
    notes: Optional[str] = None
    mac: Optional[str] = Field(default=None, max_length=32)
    ip: Optional[str] = Field(default=None, max_length=64)

