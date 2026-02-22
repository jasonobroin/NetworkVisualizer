"""
Meraki Dashboard API discovery client.

Fetches the full wired network topology from the Meraki Dashboard API including
devices, switch ports, PoE status, and CDP/LLDP neighbour information.

Uses productTypes filtering at the org level to request only networking
infrastructure (switch, appliance, wireless, wirelessController) — sensors,
cameras, and smart-home devices are excluded at the API call level.

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

# Only fetch these Meraki product types — excludes sensor, cellularGateway,
# systemsManager, secureConnect, campusGateway
_INFRA_PRODUCT_TYPES = ["switch", "appliance", "wireless", "wirelessController", "camera"]

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

# Known wired port layout for Meraki AP models — FALLBACK ONLY.
# Used only when the org-level wireless ethernet statuses API call fails.
# wired0 is always the uplink; additional ports are downstream.
_AP_WIRED_PORTS_FALLBACK: dict[str, list[tuple[str, str]]] = {
    "MR36H":    [("wired0", "Uplink"), ("wired1", "Ethernet 1"), ("wired2", "Ethernet 2"),
                 ("wired3", "Ethernet 3"), ("wired4", "Ethernet 4")],
    "MR57":     [("wired0", "Uplink"), ("wired1", "Ethernet 1"), ("wired2", "Ethernet 2")],
    "CW9166":   [("wired0", "Uplink"), ("wired1", "Ethernet 1")],
    "CW9164":   [("wired0", "Uplink"), ("wired1", "Ethernet 1")],
    "CW9163":   [("wired0", "Uplink"), ("wired1", "Ethernet 1")],
    "_default": [("wired0", "Uplink")],
}


def _ap_port_layout_fallback(model: str) -> list[tuple[str, str]]:
    """Return fallback port layout when live API data is unavailable."""
    model_upper = model.upper()
    for prefix, layout in _AP_WIRED_PORTS_FALLBACK.items():
        if prefix != "_default" and model_upper.startswith(prefix.upper()):
            return layout
    return _AP_WIRED_PORTS_FALLBACK["_default"]


def _classify_device(model: str) -> DeviceType:
    """Derive a broad DeviceType from a Meraki model string."""
    model_upper = model.upper()
    if model_upper.startswith("MX") or model_upper.startswith("Z"):
        return DeviceType.MX
    if model_upper.startswith("MS") or model_upper.startswith("C9"):
        return DeviceType.MS
    if model_upper.startswith("MR") or model_upper.startswith("CW"):
        return DeviceType.MR
    if model_upper.startswith("MV"):
        return DeviceType.MV
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
        Run a full discovery across all accessible organisations.

        Returns a list of DiscoveryResult objects, one per organisation.
        Only infrastructure product types are fetched (switch, appliance,
        wireless, wirelessController) — sensors and cameras are excluded
        at the API level via the productTypes parameter.
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
        """
        Discover all infrastructure devices within a single organisation.

        Uses getOrganizationDevices with productTypes filtering — a single
        paginated call per org rather than one call per network. Also fetches
        the network list once to build a network_id → name lookup.
        """
        errors: list[str] = []
        all_devices: list[DeviceInfo] = []

        # Build network_id → network_name lookup
        network_names: dict[str, str] = {}
        try:
            networks = self._dashboard.organizations.getOrganizationNetworks(
                org_id, total_pages="all"
            )
            network_names = {n["id"]: n.get("name", n["id"]) for n in networks}
        except meraki.APIError as exc:
            logger.warning("Could not fetch network names for org %s: %s", org_id, exc)

        # Fetch all infrastructure devices in one call with productTypes filter
        try:
            raw_devices = self._dashboard.organizations.getOrganizationDevices(
                org_id,
                total_pages="all",
                productTypes=_INFRA_PRODUCT_TYPES,
            )
        except meraki.APIError as exc:
            msg = f"Failed to fetch devices for org {org_id}: {exc}"
            logger.error(msg)
            return DiscoveryResult(
                organisation_id=org_id,
                organisation_name=org_name,
                network_count=len(network_names),
                errors=[msg],
            )

        logger.info(
            "Fetched %d infrastructure device(s) from org %s (productTypes=%s)",
            len(raw_devices), org_name, _INFRA_PRODUCT_TYPES,
        )

        # Fetch org-level wireless ethernet port statuses once — gives live speed,
        # duplex, PoE standard for every AP wired port without per-device API calls.
        # serial → list of port dicts from the API response
        ap_eth_statuses: dict[str, list[dict]] = {}
        try:
            eth_data = self._dashboard.wireless.getOrganizationWirelessDevicesEthernetStatuses(
                org_id, total_pages="all"
            )
            for entry in eth_data:
                s = entry.get("serial")
                if s:
                    ap_eth_statuses[s] = entry.get("ports", [])
            logger.info(
                "Fetched wireless ethernet statuses for %d AP(s) in org %s",
                len(ap_eth_statuses), org_name,
            )
        except Exception as exc:
            logger.warning(
                "Could not fetch wireless ethernet statuses for org %s: %s — "
                "falling back to model layout table for AP ports",
                org_name, exc,
            )

        for dev in raw_devices:
            serial = dev.get("serial", "")
            model = dev.get("model", "UNKNOWN")
            net_id = dev.get("networkId", "")
            device_type = _classify_device(model)

            device_info = DeviceInfo(
                serial=serial,
                name=dev.get("name") or dev.get("mac") or serial,
                model=model,
                device_type=device_type,
                mac=dev.get("mac"),
                ip=dev.get("lanIp"),
                network_id=net_id,
                network_name=network_names.get(net_id, net_id),
            )

            # Fetch switch port details for MS devices only
            if device_type == DeviceType.MS and serial:
                try:
                    device_info.ports = self._discover_switch_ports(serial, model)
                except Exception as exc:
                    msg = f"Error fetching ports for {serial} ({model}): {exc}"
                    logger.error(msg)
                    errors.append(msg)

            # Fetch wired port / uplink info for MR/CW access points
            elif device_type == DeviceType.MR and serial:
                try:
                    device_info.ports = self._discover_ap_ports(
                        serial, model, ap_eth_statuses.get(serial, [])
                    )
                except Exception as exc:
                    msg = f"Error fetching AP ports for {serial} ({model}): {exc}"
                    logger.error(msg)
                    errors.append(msg)

            # MV cameras — single uplink only, no port API available
            # They appear as neighbours on switch ports (already captured via LLDP)
            elif device_type == DeviceType.MV:
                logger.debug("Camera %s (%s): no port discovery needed", serial, model)

            all_devices.append(device_info)
            logger.info(
                "  Device: %s (%s) — %d port(s)",
                device_info.name, model, len(device_info.ports),
            )

        return DiscoveryResult(
            organisation_id=org_id,
            organisation_name=org_name,
            network_count=len(network_names),
            devices=all_devices,
            errors=errors,
        )

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

    def _discover_ap_ports(
        self,
        serial: str,
        model: str,
        eth_statuses: list[dict],
    ) -> list[PortInfo]:
        """
        Build wired PortInfo objects for a Meraki MR/CW access point.

        Uses two data sources, combined:

        1. eth_statuses — from getOrganizationWirelessDevicesEthernetStatuses.
           Provides all physical ports (even with nothing connected), live speed,
           duplex, and PoE standard per port.  Port names are "Ethernet 0",
           "Ethernet 1", … which map to wired0, wired1, …

        2. getDeviceLldpCdp — overlay neighbour info (switch name + port) onto
           any port where a CDP/LLDP-speaking neighbour is detected.

        Falls back to the model layout table if eth_statuses is empty.
        """
        # Fetch LLDP/CDP neighbours — keyed by wiredN port_id
        lldp_cdp: dict[str, LldpCdpNeighbour] = {}
        try:
            neighbour_data = self._dashboard.devices.getDeviceLldpCdp(serial)
            lldp_cdp = self._parse_lldp_cdp(neighbour_data)
        except meraki.APIError as exc:
            logger.warning("Could not fetch LLDP/CDP for AP %s: %s", serial, exc)

        ports: list[PortInfo] = []

        if eth_statuses:
            # Build from live API data — no hardcoding needed
            for port_dict in eth_statuses:
                # "Ethernet 0" → "wired0", "Ethernet 1" → "wired1", etc.
                raw_name: str = port_dict.get("name", "")
                port_id = raw_name.lower().replace(" ", "").replace("ethernet", "wired")
                # "wired0" → "Uplink", others keep the API name
                display_name = "Uplink" if port_id == "wired0" else raw_name

                link_neg = port_dict.get("linkNegotiation") or {}
                speed_val = link_neg.get("speed")   # int Mbps or None
                duplex    = link_neg.get("duplex")   # "full" / None

                # Port is up if speed is negotiated
                link_state = "up" if speed_val else "unknown"

                # Speed string e.g. "1 Gbps", "100 Mbps"
                speed_str: Optional[str] = None
                if speed_val:
                    speed_str = f"{speed_val // 1000} Gbps" if speed_val >= 1000 else f"{speed_val} Mbps"

                poe_info = port_dict.get("poe") or {}
                poe_standard = poe_info.get("standard")   # "802.3at" / "802.3af" / None
                poe_capable  = poe_standard is not None
                # wired0 is the uplink (consumes PoE); downstream ports supply PoE
                poe_active = poe_capable and port_id != "wired0" and link_state == "up"

                ports.append(PortInfo(
                    port_id=port_id,
                    name=display_name,
                    enabled=True,
                    link_state=link_state,
                    speed=speed_str,
                    vlan=None,
                    poe_capable=poe_capable,
                    poe_enabled=poe_capable,
                    poe_active=poe_active,
                    neighbour=lldp_cdp.get(port_id),
                ))
        else:
            # Fallback: use model layout table when live data unavailable
            logger.debug("AP %s (%s): no live ethernet data, using model fallback", serial, model)
            for port_id, display_name in _ap_port_layout_fallback(model):
                neighbour = lldp_cdp.get(port_id)
                ports.append(PortInfo(
                    port_id=port_id,
                    name=display_name,
                    enabled=True,
                    link_state="up" if neighbour else "unknown",
                    poe_capable=False,
                    poe_enabled=False,
                    poe_active=False,
                    neighbour=neighbour,
                ))

        logger.debug(
            "AP %s (%s): %d port(s) (%d with neighbours)",
            serial, model, len(ports), len(lldp_cdp),
        )
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

