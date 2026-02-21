---
applyTo: "frontend/**"
---

# Frontend Instructions — NetworkVisualizer

## Stack
- Plain HTML5 / vanilla JavaScript (ES2020+)
- **No frameworks** — no React, Vue, Angular, etc.
- **Cytoscape.js** loaded from CDN (no build step, no npm)
- CSS in `frontend/style.css`

## Cytoscape.js Conventions

### Compound nodes (rooms)
Rooms are compound parent nodes. Devices are children assigned via `parent: roomId`.
Devices without a room assignment go into a special "unassigned" parent node.

```javascript
// Room node
{ data: { id: 'room-1', label: 'Living Room', type: 'room' } }

// Device node (child of room)
{ data: { id: 'device-42', label: 'MS120\nLiving Room Switch', parent: 'room-1', type: 'ms' } }
```

### Styling
Colour devices by type:
- `mx` → `#e67e22` (orange)
- `ms` → `#2980b9` (blue)
- `mr` → `#27ae60` (green)
- `router` → `#c0392b` (red)
- `other` / unmanaged → `#7f8c8d` (grey, dashed border)

Rooms: light grey background (`#ecf0f1`), rounded rectangle, no border.

### Layout
Use `preset` layout if positions are stored, otherwise `cose-bilkent` or `cola` for auto-layout.
For compound nodes with rooms, `cose` works well.

## API Calls
- All API calls use `fetch()`.
- API base URL: `/api` (same origin).
- Always handle errors and show a user-friendly message in the UI.
- Show a loading spinner/overlay during `POST /api/scan` (it may take several seconds).

## Detail Panel
The right-hand panel updates on node/edge click.
- Device click: show device info table + port list table + room dropdown + annotation form (if unmanaged)
- Edge click: show src device/port + dst device/port + link type

## Room Dropdown
- Populated from `GET /api/rooms`
- On change: call `PATCH /api/device/{id}/room` then refresh the graph
- Include an "Unassigned" option (sends `room_id: null`)

## Buttons
- **Rescan**: show spinner, call `POST /api/scan`, then reload graph data
- **Reset DB**: `confirm()` dialog, then `DELETE /api/db` with `X-Confirm-Reset` header, then reload page

## Code Style
- Use `async/await` for all fetch calls (no `.then()` chains)
- Comment all major functions
- Keep `app.js` organised in clear sections: init, data loading, graph rendering, event handlers, UI helpers

