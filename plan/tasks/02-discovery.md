# Task 02 — Meraki Discovery Module

## Goal
Build the Meraki API discovery client that fetches the full network topology.
This module is the source of truth for all network data before it is stored in the database.

## Inputs
- `plan/AGENTS.md` — rules to follow
- `.env` / `MERAKI_API_KEY` environment variable (read at runtime only, never hardcoded)
- `meraki` Python SDK (already in `pyproject.toml` from Task 01)

## Expected Outputs
- `src/discovery/meraki_client.py` — main discovery class/functions
- `src/discovery/models.py` — plain dataclasses/Pydantic models for discovered data (DeviceInfo, PortInfo, LinkInfo)

## Data to Fetch
The client must fetch and return structured data for:
1. **Organisations** — list all orgs the API key has access to
2. **Networks** — list all networks in each org
3. **Devices** — for each network: serial, model, name, MAC, LAN IP, device type (MX/MS/MR/other)
4. **Switch ports** (MS devices only) — for each port:
   - Port ID, name/description
   - Enabled state
   - Speed (configured and actual if available)
   - VLAN (access VLAN or trunk native)
   - PoE capable (derived from model)
   - PoE enabled (port config)
   - PoE active / power draw (from port status endpoint)
   - Link state (up/down)
   - Connected device info from CDP/LLDP (device ID, platform, port, IP)
5. **CDP/LLDP neighbours** — per device, cross-reference to build link map

## Constraints
- API key must be read from `os.environ["MERAKI_API_KEY"]` only
- Use the official `meraki` Python SDK — do not make raw HTTP calls
- All functions must have type hints and docstrings
- Return structured Pydantic models, not raw dicts
- Handle API rate limiting gracefully (the SDK does this; ensure it is not disabled)
- Log progress to stdout (not to a file) using Python `logging`
- Do not store or print the API key in any log output

## Status
[x] Complete

