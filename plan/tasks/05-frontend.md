# Task 05 — Web Frontend

## Goal
Build the single-page web UI that visualizes the network topology using Cytoscape.js.
Rooms are displayed as compound parent nodes containing device nodes.
Wired links connect devices. A side panel shows port detail when a device or link is clicked.

## Inputs
- `plan/AGENTS.md` — rules to follow
- `GET /topology` response schema from Task 04
- `GET /rooms`, `PATCH /device/{id}/room`, `PATCH /device/{id}`, `POST /scan`, `DELETE /db` endpoints

## Expected Outputs
- `frontend/index.html` — single HTML file, loads Cytoscape.js from CDN
- `frontend/app.js` — all UI logic
- `frontend/style.css` — layout and styling

## UI Layout

```
+-------------------------------------------------------+
|  NetworkVisualizer         [Rescan] [Reset DB]         |
+------------------------------------+------------------+
|                                    |                  |
|   Cytoscape.js graph               |  Detail Panel    |
|                                    |                  |
|   [Room: Living Room]              |  (click a device |
|     [Switch MS120]                 |   or link to     |
|     [AP MR36]                      |   populate)      |
|                                    |                  |
|   [Room: Office]                   |                  |
|     [Switch MS120-8FP]             |                  |
|     [MX68 Firewall]                |                  |
|                                    |                  |
+------------------------------------+------------------+
```

## Graph Behaviour

### Nodes
- **Room nodes** — compound parent nodes, labelled with room name, styled as a rounded rectangle with a light background
- **Device nodes** — children of room nodes (if assigned); devices without a room appear in an "Unassigned" group
  - Colour by type: MX (orange), MS (blue), MR (green), router (red), other (grey)
  - Label: device name + model
  - Unmanaged devices styled with a dashed border

### Edges
- Represent wired links between devices
- Labelled with source port ID
- On hover: show port speed

### Click behaviour
- **Click a device** → populate detail panel with:
  - Device name, model, type, IP, MAC
  - Room assignment dropdown (all rooms + "Unassigned")
  - Port list table: port ID, description, state, speed, VLAN, PoE capable, PoE active, PoE power (mW), connected neighbour
  - For unmanaged devices: show editable annotation form (name, type, port count, notes, MAC, IP)
- **Click a link/edge** → show: src device+port, dst device+port, link type (CDP/LLDP/manual)

## Buttons
- **Rescan Network** — calls `POST /scan`, shows a spinner while running, then reloads the graph
- **Reset Database** — shows a browser `confirm()` dialog: "This will delete all data. Are you sure?"
  - If confirmed, calls `DELETE /db` with header `X-Confirm-Reset: yes-delete-everything`
  - Then reloads the page

## Room Assignment
- Dropdown in the device detail panel lists all rooms + "Unassigned"
- On change, calls `PATCH /device/{id}/room` immediately
- Graph re-renders to move the device node to the new room

## Constraints
- Load Cytoscape.js from CDN (no build step, no npm)
- Plain HTML/JS — no React, Vue, or other framework
- All API calls use `fetch()` with proper error handling
- Show user-friendly error messages if API calls fail
- The frontend is served as static files by FastAPI (`StaticFiles`)
- Must work in modern Chrome/Firefox — no IE support needed
- Responsive layout is nice-to-have but not required for v1

## Status
[ ] Not started

