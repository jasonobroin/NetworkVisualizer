"""
Meraki Dashboard API discovery client.

Fetches the full wired network topology from the Meraki Dashboard API including
devices, switch ports, PoE status, and CDP/LLDP neighbour information.

Usage:
    from src.discovery.meraki_client import MerakiDiscoveryClient
    client = MerakiDiscoveryClient()
    results = client.run_discovery()
"""

import logging
import os
from typing import Optional

import meraki

from src.discovery.models import (
    DeviceInfo,
    DeviceType,
    DiscoveryResult,
    LldpCdpNeighbour,
    PortInfo,
)

logger = logging.getLogger(__name__)

# Meraki switch models that support PoE on some or all ports.
# Models ending in "P", "FP", "LP", "POE" are PoE-capable.
_POE_MODEL_SUFFIXES = ("P", "FP", "LP", "POE", "P-HW")

# Models where NO ports are PoE capable (non-PoE variants)
_NON_POE_MODELS = frozenset(
    [
        "MS120-8",
        "MS125-24",
        "MS125-48",
        "MS210-24",
        "MS210-48",
        "MS225-24",
        "MS225-48",
        "MS250-24",
        "MS250-48",
        "MS350-24",
        "MS350-48",
    ]
)


def _classify_device(model: str) -> DeviceType:
    """Derive a broad DeviceType from a Meraki model string."""
    model_upper = model.upper()
    if model_upper.startswith("MX"):
        return DeviceType.MX
    if model_upper.startswith("MS"):
        return DeviceType.MS
    if model_upper.startswith("MR") or model_upper.startswith("CW"):
        return DeviceType.MR
    return DeviceType.OTHER


def _port_is_poe_capable(model: str, port_id: str) -> bool:
    """
    Determine whether a specific port on a switch model is PoE capable.

    Uses model name heuristics. The Meraki API port status endpoint provides
    definitive per-port PoE data, but this is used as a fallback/display hint.
    """
    if model in _NON_POE_MODELS:
        return False
    model_upper = model.upper()
    # SFP/uplink ports are never PoE
    if "SFP" in port_id.upper() or port_id.upper().startswith("U"):
        return False
    for suffix in _POE_MODEL_SUFFIXES:
        if model_upper.endswith(suffix):
            return True
    return False


class MerakiDiscoveryClient:
    """
    Client for discovering network topology via the Meraki Dashboard API.

    Reads the API key from the MERAKI_API_KEY environment variable.
    Never logs or exposes the key.
    """

    def __init__(self) -> None:
        """Initialise the Meraki Dashboard API client."""
        api_key = os.environ.get("MERAKI_API_KEY")
        if not api_key:
            raise EnvironmentError(
                "MERAKI_API_KEY environment variable is not set. "
                "Copy .env.example to .env and add your key."
            )
        # suppress_logging=True prevents the SDK from printing the API key
        self._dashboard = meraki.DashboardAPI(
            api_key=api_key,
            suppress_logging=True,
            print_console=False,
            output_log=False,
        )
        logger.info("Meraki Dashboard API client initialised")

    def run_discovery(self) -> list[DiscoveryResult]:
        """
        Run a full discovery across all accessible organisations and networks.

        Returns a list of DiscoveryResult objects, one per organisation.
        Errors encountered for individual devices/networks are collected in
        DiscoveryResult.errors rather than raising exceptions.
        """
        results: list[DiscoveryResult] = []

        try:
            orgs = self._dashboard.organizations.getOrganizations()
        except meraki.APIError as exc:
            logger.error("Failed to fetch organisations: %s", exc)
            return results

        logger.info("Found %d organisation(s)", len(orgs))

        for org in orgs:
            org_id = org["id"]
            org_name = org.get("name", org_id)
            logger.info("Discovering org: %s (%s)", org_name, org_id)
            result = self._discover_org(org_id, org_name)
            results.append(result)

        return results

    def _discover_org(self, org_id: str, org_name: str) -> DiscoveryResult:
        """Discover all devices within a single organisation."""
        errors: list[str] = []
        all_devices: list[DeviceInfo] = []

        try:
            networks = self._dashboard.organizations.getOrganizationNetworks(
                org_id, total_pages="all"
            )
        except meraki.APIError as exc:
            msg = f"Failed to fetch networks for org {org_id}: {exc}"
            logger.error(msg)
            return DiscoveryResult(
                organisation_id=org_id,
                organisation_name=org_name,
                network_count=0,
                errors=[msg],
            )

        logger.info("Found %d network(s) in org %s", len(networks), org_name)

        for network in networks:
            net_id = network["id"]
            net_name = network.get("name", net_id)
            try:
                devices = self._discover_network(net_id, net_name)
                all_devices.extend(devices)
            except Exception as exc:
                msg = f"Error discovering network {net_name} ({net_id}): {exc}"
                logger.error(msg)
                errors.append(msg)

        return DiscoveryResult(
            organisation_id=org_id,
            organisation_name=org_name,
            network_count=len(networks),
            devices=all_devices,
            errors=errors,
        )

    def _discover_network(self, net_id: str, net_name: str) -> list[DeviceInfo]:
        """Discover all devices in a single network."""
        logger.info("Discovering network: %s (%s)", net_name, net_id)
        device_infos: list[DeviceInfo] = []

        try:
            raw_devices = self._dashboard.networks.getNetworkDevices(net_id)
        except meraki.APIError as exc:
            logger.error("Failed to fetch devices for network %s: %s", net_name, exc)
            return device_infos

        for dev in raw_devices:
            serial = dev.get("serial", "")
            model = dev.get("model", "UNKNOWN")
            device_type = _classify_device(model)

            device_info = DeviceInfo(
                serial=serial,
                name=dev.get("name") or dev.get("mac") or serial,
                model=model,
                device_type=device_type,
                mac=dev.get("mac"),
                ip=dev.get("lanIp"),
                network_id=net_id,
                network_name=net_name,
            )

            # Fetch switch port details for MS devices
            if device_type == DeviceType.MS and serial:
                device_info.ports = self._discover_switch_ports(serial, model)

            device_infos.append(device_info)
            logger.info(
                "  Device: %s (%s) — %d port(s)",
                device_info.name,
                model,
                len(device_info.ports),
            )

        return device_infos

    def _discover_switch_ports(self, serial: str, model: str) -> list[PortInfo]:
        """
        Fetch all port configuration, status, and LLDP/CDP data for a switch.

        Combines three API calls:
        - getDeviceSwitchPorts — port config (enabled, VLAN, PoE enabled)
        - getDeviceSwitchPortsStatuses — live status (link state, speed, PoE active/power)
        - getDeviceLldpCdp — neighbour info per port
        """
        ports: list[PortInfo] = []

        # --- Port configuration ---
        try:
            port_configs = self._dashboard.switch.getDeviceSwitchPorts(serial)
        except meraki.APIError as exc:
            logger.warning("Could not fetch port configs for %s: %s", serial, exc)
            return ports

        # --- Port status (live data) ---
        port_statuses: dict[str, dict] = {}
        try:
            statuses = self._dashboard.switch.getDeviceSwitchPortsStatuses(serial)
            port_statuses = {str(s["portId"]): s for s in statuses}
        except meraki.APIError as exc:
            logger.warning("Could not fetch port statuses for %s: %s", serial, exc)

        # --- LLDP/CDP neighbours ---
        lldp_cdp: dict[str, LldpCdpNeighbour] = {}
        try:
            neighbour_data = self._dashboard.devices.getDeviceLldpCdp(serial)
            lldp_cdp = self._parse_lldp_cdp(neighbour_data)
        except meraki.APIError as exc:
            logger.warning("Could not fetch LLDP/CDP for %s: %s", serial, exc)

        # --- Combine ---
        for cfg in port_configs:
            port_id = str(cfg.get("portId", ""))
            status = port_statuses.get(port_id, {})

            # PoE capability: use model heuristic; override if status says definitively
            poe_capable = _port_is_poe_capable(model, port_id)
            poe_enabled = cfg.get("poeEnabled", False)

            # Live PoE status from port status endpoint
            poe_active = False
            poe_power_mw: Optional[float] = None
            if status:
                poe_active = status.get("powerUsageInWh") is not None or (
                    status.get("poeEnabled") is True
                    and status.get("status", "").lower() == "connected"
                )
                raw_power = status.get("powerUsageInWh")
                if raw_power is not None:
                    # API returns Wh usage; for display we show current watts where available
                    # Use clientCount as a proxy signal — actual mW not always available
                    poe_power_mw = None  # Will be enhanced when API provides instantaneous data

                # Check for explicit PoE power draw in newer API responses
                if "poeClass" in status or "powerUsage" in status:
                    poe_active = True
                    poe_capable = True

            # Speed from status
            speed = status.get("speed") if status else None
            link_state = "up" if status.get("status", "").lower() == "connected" else "down"
            if not status:
                link_state = "unknown"

            port = PortInfo(
                port_id=port_id,
                name=cfg.get("name") or cfg.get("portId", ""),
                enabled=cfg.get("enabled", True),
                link_state=link_state,
                speed=str(speed) if speed else None,
                vlan=cfg.get("vlan"),
                poe_capable=poe_capable,
                poe_enabled=poe_enabled,
                poe_active=poe_active,
                poe_power_mw=poe_power_mw,
                neighbour=lldp_cdp.get(port_id),
            )
            ports.append(port)

        return ports

    def _parse_lldp_cdp(self, data: dict) -> dict[str, LldpCdpNeighbour]:
        """
        Parse the getDeviceLldpCdp response into a port_id → LldpCdpNeighbour mapping.

        The Meraki API returns a nested structure:
        {
          "sourceMac": "...",
          "ports": {
            "1": { "cdp": {...}, "lldp": {...} },
            ...
          }
        }
        """
        result: dict[str, LldpCdpNeighbour] = {}
        ports_data = data.get("ports", {})

        for port_id, port_neighbours in ports_data.items():
            # Prefer LLDP over CDP if both present
            for protocol in ("lldp", "cdp"):
                neighbour_raw = port_neighbours.get(protocol)
                if not neighbour_raw:
                    continue
                result[str(port_id)] = LldpCdpNeighbour(
                    protocol=protocol,
                    device_id=neighbour_raw.get("deviceId") or neighbour_raw.get("chassisId"),
                    platform=neighbour_raw.get("platform") or neighbour_raw.get("systemDescription"),
                    port_id=neighbour_raw.get("portId"),
                    ip_address=neighbour_raw.get("managementAddress") or neighbour_raw.get("ipv4Address"),
                    system_name=neighbour_raw.get("systemName"),
                )
                break  # Only record one neighbour per port

        return result

