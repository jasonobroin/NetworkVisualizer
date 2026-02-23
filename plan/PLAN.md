# NetworkVisualizer — Project Plan

## Overview

A web-based, Dockerised network visualizer for a Meraki home network.
Devices are discovered automatically via the Meraki Dashboard API. The topology
is stored in a SQLite database and displayed in an interactive web UI using
Cytoscape.js. Rooms act as grouping containers; devices can be assigned to rooms
via a dropdown. A manual "Rescan" button triggers fresh discovery.

---

## Tech Stack

| Concern        | Choice                          |
|----------------|---------------------------------|
| Language       | Python 3.12                     |
| Package mgmt   | `uv`                            |
| Backend        | FastAPI                         |
| ORM / DB       | SQLAlchemy + SQLite             |
| Meraki API     | `meraki` Python SDK             |
| Frontend       | HTML/JS + Cytoscape.js          |
| Container      | Single Docker container         |
| Repo           | Git                             |

---

## Feature Checklist

### Phase 1 — Foundation
- [x] Git repo initialised with `.gitignore` and `.env.example`
- [x] `pyproject.toml` configured with `uv`
- [x] `Dockerfile` and `docker-compose.yml` created
- [x] `README.md` written with setup and run instructions
- [x] `plan/` directory with AGENTS.md, PLAN.md, DECISIONS.md, tasks/

### Phase 2 — Discovery
- [x] Meraki SDK client (`src/discovery/meraki_client.py`)
- [x] Fetch organisations and networks
- [x] Fetch all devices (MX, MS, MR)
- [x] Fetch switch ports with speed, VLAN, PoE capable, PoE active
- [x] Fetch CDP/LLDP neighbour data per port
- [x] Handle unmanaged/unknown devices on ports

### Phase 3 — Database
- [x] SQLAlchemy models: `Device`, `Port`, `Link`, `Room`, `DeviceRoom`
- [x] Managed and unmanaged device support (name, type, port count, notes, MAC, IP)
- [x] `reset_db()` utility
- [x] `seed_from_discovery()` utility

### Phase 4 — API
- [x] `POST /scan` — trigger full Meraki rescan
- [x] `GET /topology` — return full graph JSON for frontend
- [x] `PATCH /device/{id}` — annotate unmanaged device
- [x] `PATCH /device/{id}/room` — assign device to room
- [x] `DELETE /db` — reset database (with confirmation token)

### Phase 5 — Frontend
- [x] Cytoscape.js flat graph (devices + links, no compound nodes)
- [x] Port detail side-panel (PoE capable/active, speed, VLAN, neighbour)
- [x] Room assignment via colour-coded border rings + legend panel
- [x] Room dropdown reassignment with inline "new room" creation
- [x] "Rescan Network" button with spinner
- [x] "Reset Layout" button (clears localStorage positions)
- [x] "Reset Database" button with confirmation prompt
- [x] Unmanaged device annotation form (name, type, port count, notes, MAC, IP)
- [x] Node positions persisted in localStorage; auto-layout on first load
- [x] Edge labels show source port number; colours by link type (LLDP/CDP/manual)

### Phase 6 — Docker & Docs
- [x] Finalised Dockerfile (python:3.12-slim + uv)
- [x] docker-compose.yml with named SQLite volume and .env injection
- [x] README.md complete with Future Development section

---

## Post-Launch Fixes

- [x] Meraki API `productTypes` filter — sensors excluded at API level
- [x] LLDP link resolution via MAC address matching (not serial/name)
- [x] MAC ±offset resolution for Meraki AP radio vs management MAC
- [x] CDP hostname matching for non-Meraki devices (e.g. Catalyst 9800-L)
- [x] Bidirectional LLDP deduplication
- [x] Removed compound/parent room nodes (caused large overlapping boxes)
- [x] Room membership shown via node border ring colour + legend in side panel
- [x] Port table moved to bottom panel; click port row highlights graph edge + dims others
- [x] Port row with link shows ⇢ hint; clicking re-centres graph on that edge
- [x] MR/CW AP wired ports via `getOrganizationWirelessDevicesEthernetStatuses` — live speed, PoE standard, all ports without hardcoding; LLDP/CDP neighbour overlaid where detected
- [x] Node positions persisted in localStorage; ⊞ Reset Layout button clears them
- [x] `--reload` flag documented for local dev; `DATABASE_URL` sqlite:/// prefix fixed in README
- [x] SVG network icons per device type (switch, firewall, AP, camera, router, server) replacing geometric shapes
- [x] MV camera support — discovered via `productTypes=camera`, classified as `DeviceType.MV`, purple icon, included in topology (previously filtered out by `_is_infrastructure`)
- [x] New nodes no longer pile at `{0,0}` when preset layout used — staggered below existing nodes
- [x] Node positions correctly preserved across `reloadGraph` — saved before graph destroy, in-memory state kept current
- [x] Click Room / Device type / Link type in legend to highlight matching nodes/edges; all others dim
- [x] Viewport saved before highlight and restored (animated) when highlight is cleared
- [x] Clicking the same legend item again, or the canvas background, clears the highlight
- [x] Device counts shown per room and per device type in legend; zero-count types omitted
- [x] `ScanMeta` DB table added — stores org name, org ID, network names, last scan timestamp
- [x] Network info header bar added below toolbar — shows org name, Meraki network names, total device count, last scan time (populated on first rescan)
- [x] Unresolved CDP/LLDP neighbours auto-create unmanaged placeholder devices (e.g. `Jason-9800-L`) so links are visible; keyed on `cdp:<hostname>` synthetic serial to avoid duplicates on rescan; device type inferred from platform string
- [x] Manual link creation — `+ Link` button on UP ports with no auto-discovered neighbour; inline device picker with filter; `POST /api/link` endpoint; manual links survive rescan
- [x] Manual link deletion — `✕ Unlink` button on ports with a manual link; `DELETE /api/link/{id}` endpoint; LLDP/CDP links protected from manual deletion
- [x] Port neighbour column shows resolved device name (from link graph) instead of raw MAC address; unresolved neighbours shown in muted italic; tooltip includes platform + remote port
- [x] AP uplink port neighbour resolution fixed — links stored with `src_port_id` (switch side) now correctly resolve to the AP's friendly name via `dst_device_id` lookup; direction logic corrected

---

## Unsolved Issues

- [ ] **SVG node icon vertical alignment** — icons render slightly high within nodes in Cytoscape.js. Root cause: `background-fit: contain` ignores `background-position-y`; `background-fit: none` with `background-offset` uses top-left anchor semantics, not centre. Attempts to compensate via SVG viewBox padding and `background-clip: node` produced no visible improvement. Workaround: acceptable for now. Possible fix: canvas-based icon renderer or a Cytoscape extension that supports HTML node content.

---

## Future Development (Post-Phase-6)

- Cisco Catalyst support (SSH/NETCONF)
- Drag-and-drop room layout repositioning (Option C — two-level view)
- Continuous background polling option
- MCP server integration for richer agent tooling
- Port utilisation history / change log
- Export topology as image or PDF

