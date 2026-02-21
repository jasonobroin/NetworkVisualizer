"""
Discovery data models.

Plain Pydantic models representing data fetched from the Meraki Dashboard API.
These are transport objects — they are not persisted directly; see src/db/models.py.
"""

from enum import StrEnum
from typing import Optional

from pydantic import BaseModel, Field


class DeviceType(StrEnum):
    """Broad device category derived from Meraki model string."""

    MX = "mx"
    MS = "ms"
    MR = "mr"
    OTHER = "other"


class LldpCdpNeighbour(BaseModel):
    """A neighbour reported via CDP or LLDP on a single port."""

    protocol: str = Field(description="cdp or lldp")
    device_id: Optional[str] = None
    platform: Optional[str] = None
    port_id: Optional[str] = None
    ip_address: Optional[str] = None
    system_name: Optional[str] = None


class PortInfo(BaseModel):
    """All information about a single switch port."""

    port_id: str
    name: Optional[str] = None
    enabled: bool = True
    link_state: str = "unknown"
    speed: Optional[str] = None
    vlan: Optional[int] = None
    poe_capable: bool = False
    poe_enabled: bool = False
    poe_active: bool = False
    poe_power_mw: Optional[float] = None
    neighbour: Optional[LldpCdpNeighbour] = None


class DeviceInfo(BaseModel):
    """All information about a single Meraki device."""

    serial: str
    name: Optional[str] = None
    model: str
    device_type: DeviceType
    mac: Optional[str] = None
    ip: Optional[str] = None
    network_id: str
    network_name: Optional[str] = None
    ports: list[PortInfo] = Field(default_factory=list)


class DiscoveryResult(BaseModel):
    """Top-level result returned by a full discovery run."""

    organisation_id: str
    organisation_name: str
    network_count: int
    devices: list[DeviceInfo] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)

