# Task 04 — FastAPI Backend

## Goal
Build the FastAPI REST API that serves topology data to the frontend, triggers
Meraki discovery, handles device annotation, room assignment, and database reset.

## Inputs
- `plan/AGENTS.md` — rules to follow
- `src/api/main.py` — entry point from Task 01 (extend it)
- `src/db/models.py` and `src/db/utils.py` — from Task 03
- `src/discovery/meraki_client.py` — from Task 02

## Expected Outputs
- `src/api/main.py` — updated with all routes and app setup
- `src/api/routes/` — split routes into sub-modules:
  - `src/api/routes/scan.py` — scan/discovery routes
  - `src/api/routes/topology.py` — graph data routes
  - `src/api/routes/devices.py` — device annotation routes
  - `src/api/routes/rooms.py` — room management routes
  - `src/api/routes/admin.py` — DB reset route
- `src/api/schemas.py` — Pydantic request/response schemas

## Endpoints

### `GET /health`
Returns `{"status": "ok"}`. No auth required.

### `POST /scan`
Triggers a full Meraki discovery run.
- Calls `meraki_client.run_discovery()`
- Calls `seed_from_discovery()` with the result
- Returns summary: `{devices_added, devices_updated, ports_added, links_added, scanned_at}`
- Long-running — should run synchronously for now (async background task is a future improvement)

### `GET /topology`
Returns the full graph as JSON for Cytoscape.js.
Response shape:
```json
{
  "rooms": [...],
  "devices": [...],
  "links": [...]
}
```
Each device includes its room assignment (if set), all ports, and PoE/speed info.
Unmanaged devices are included with `is_managed: false`.

### `PATCH /device/{id}`
Update device annotation (for unmanaged devices or to override names).
Request body: `name`, `device_type`, `port_count`, `notes`, `mac`, `ip` (all optional).

### `PATCH /device/{id}/room`
Assign a device to a room.
Request body: `{"room_id": <int>}`. Pass `null` to unassign.

### `POST /rooms`
Create a new room. Request body: `{"name": "<string>", "notes": "<string>"}`.

### `GET /rooms`
List all rooms.

### `DELETE /db`
Reset the database.
- Requires header `X-Confirm-Reset: yes-delete-everything` as a safety guard
- Calls `reset_db()`
- Returns `{"reset": true}`

## Constraints
- All routes must have docstrings
- Use Pydantic v2 schemas for all request/response bodies
- FastAPI dependency injection for DB sessions (not global state)
- CORS must be enabled (the frontend is served from the same container but allow all origins for dev)
- All errors must return structured JSON `{"error": "<message>"}`
- Do not log or expose the Meraki API key in any response or log output

## Status
[ ] Not started

