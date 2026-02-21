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
- [ ] Git repo initialised with `.gitignore` and `.env.example`
- [ ] `pyproject.toml` configured with `uv`
- [ ] `Dockerfile` and `docker-compose.yml` created
- [ ] `README.md` written with setup and run instructions
- [ ] `plan/` directory with AGENTS.md, PLAN.md, DECISIONS.md, tasks/

### Phase 2 — Discovery
- [ ] Meraki SDK client (`src/discovery/meraki_client.py`)
- [ ] Fetch organisations and networks
- [ ] Fetch all devices (MX, MS, MR)
- [ ] Fetch switch ports with speed, VLAN, PoE capable, PoE active
- [ ] Fetch CDP/LLDP neighbour data per port
- [ ] Handle unmanaged/unknown devices on ports

### Phase 3 — Database
- [ ] SQLAlchemy models: `Device`, `Port`, `Link`, `Room`, `DeviceRoom`
- [ ] Managed and unmanaged device support (name, type, port count, notes, MAC, IP)
- [ ] `reset_db()` utility
- [ ] `seed_from_discovery()` utility

### Phase 4 — API
- [ ] `POST /scan` — trigger full Meraki rescan
- [ ] `GET /topology` — return full graph JSON for frontend
- [ ] `PATCH /device/{id}` — annotate unmanaged device
- [ ] `PATCH /device/{id}/room` — assign device to room
- [ ] `DELETE /db` — reset database (with confirmation token)

### Phase 5 — Frontend
- [ ] Cytoscape.js compound graph (rooms → devices → links)
- [ ] Port detail side-panel (PoE capable/active, speed, VLAN, neighbour)
- [ ] Room dropdown reassignment
- [ ] "Rescan Network" button
- [ ] "Reset Database" button with confirmation prompt
- [ ] Unmanaged device annotation form (name, type, port count, notes, MAC, IP)

### Phase 6 — Docker & Docs
- [ ] Finalised Dockerfile (python:3.12-slim + uv)
- [ ] docker-compose.yml with named SQLite volume and .env injection
- [ ] README.md complete with Future Development section

---

## Future Development (Post-Phase-6)

- Cisco Catalyst support (SSH/NETCONF)
- Drag-and-drop room layout repositioning
- Continuous background polling option
- MCP server integration for richer agent tooling
- Port utilisation history / change log
- Export topology as image or PDF

