/**
 * NetworkVisualizer — frontend application
 *
 * Sections:
 *  1. State
 *  2. API helpers
 *  3. Graph rendering (Cytoscape.js)
 *  4. Detail panel
 *  5. Event handlers
 *  6. UI helpers (spinner, toast, room dropdown)
 *  7. Init
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. State
// ─────────────────────────────────────────────────────────────────────────────

let cy = null;          // Cytoscape instance
let topology = null;    // Last fetched topology { rooms, devices, links }
let rooms = [];         // Flat list of room objects for dropdowns
let savedPositions = {}; // device-{id} → {x, y} — persisted across reloads

const POSITIONS_KEY = 'nv_positions';

function loadPositions() {
    try { savedPositions = JSON.parse(localStorage.getItem(POSITIONS_KEY) || '{}'); }
    catch (_) { savedPositions = {}; }
}

function savePositions() {
    if (!cy) return;
    const pos = {};
    cy.nodes('[type="device"]').forEach(n => { pos[n.id()] = n.position(); });
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(pos));
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. API helpers
// ─────────────────────────────────────────────────────────────────────────────

const API = '/api';

async function apiFetch(path, options = {}) {
    /** Fetch wrapper — throws on non-2xx with structured error message. */
    const res = await fetch(`${API}${path}`, options);
    const body = res.headers.get('content-type')?.includes('json')
        ? await res.json()
        : await res.text();
    if (!res.ok) {
        // FastAPI errors: { "detail": "string" } or { "detail": { "error": "string" } }
        let msg = res.statusText;
        if (body?.detail) {
            msg = typeof body.detail === 'object'
                ? (body.detail.error || JSON.stringify(body.detail))
                : body.detail;
        } else if (body?.error) {
            msg = body.error;
        } else if (typeof body === 'string' && body) {
            msg = body;
        }
        throw new Error(msg);
    }
    return body;
}

async function fetchTopology() {
    /** Load full topology from the API. */
    topology = await apiFetch('/topology');
    rooms = await apiFetch('/rooms');
}

async function triggerScan() {
    /** POST /scan — returns a ScanResponse summary. */
    return await apiFetch('/scan', { method: 'POST' });
}

async function resetDatabase() {
    /** DELETE /db — requires confirmation header. */
    return await apiFetch('/db', {
        method: 'DELETE',
        headers: { 'X-Confirm-Reset': 'yes-delete-everything' },
    });
}

async function patchDevice(deviceId, body) {
    /** PATCH /device/{id} — update annotation fields. */
    return await apiFetch(`/device/${deviceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

async function assignRoom(deviceId, roomId) {
    /** PATCH /device/{id}/room — assign or unassign room. */
    return await apiFetch(`/device/${deviceId}/room`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id: roomId }),
    });
}

async function createRoom(name, notes = '') {
    /** POST /rooms — create a new room. */
    return await apiFetch('/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, notes }),
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Graph rendering
// ─────────────────────────────────────────────────────────────────────────────

const DEVICE_COLORS = {
    mx:     '#e67e22',
    ms:     '#2980b9',
    mr:     '#27ae60',
    router: '#c0392b',
    other:  '#7f8c8d',
};

function buildCytoscapeElements(topo) {
    /**
     * Convert topology API response into a flat Cytoscape elements array.
     * No compound/parent nodes — rooms are shown as a label line on the device.
     * Saved positions from localStorage are applied where available.
     */
    const elements = [];

    // Room id → name lookup
    const roomNames = {};
    for (const r of topo.rooms) roomNames[r.id] = r.name;

    // Device nodes — flat, no parent
    for (const device of topo.devices) {
        const color = DEVICE_COLORS[device.device_type] || DEVICE_COLORS.other;
        const roomLine = device.room_name ? `\n[${device.room_name}]` : '';
        const label = `${device.name}\n${device.model || ''}${roomLine}`.trim();
        const nodeId = `device-${device.id}`;
        const pos = savedPositions[nodeId];
        const el = {
            data: {
                id: nodeId,
                label,
                type: 'device',
                deviceId: device.id,
                deviceType: device.device_type,
                isManaged: String(device.is_managed),
                color,
                roomId: device.room_id || null,
                roomName: device.room_name || '',
            },
        };
        if (pos) el.position = { x: pos.x, y: pos.y };
        elements.push(el);
    }

    // Build port DB id → port_id string lookup for edge labels
    const portIdMap = {};
    for (const device of topo.devices) {
        for (const p of (device.ports || [])) {
            portIdMap[p.id] = p.port_id;
        }
    }

    // Edge (link) elements — deduplicate bidirectional links
    const seen = new Set();
    for (const link of topo.links) {
        if (!link.dst_device_id) continue;
        const key = [Math.min(link.src_device_id, link.dst_device_id),
                     Math.max(link.src_device_id, link.dst_device_id)].join('-');
        if (seen.has(key)) continue;
        seen.add(key);
        const rawPort = link.src_port_id != null ? portIdMap[link.src_port_id] : null;
        const srcPort = rawPort != null ? `p${rawPort}` : '';
        elements.push({
            data: {
                id: `link-${link.id}`,
                source: `device-${link.src_device_id}`,
                target: `device-${link.dst_device_id}`,
                linkType: link.link_type,
                linkId: link.id,
                srcPort,
            },
        });
    }

    return elements;
}

function buildCytoscapeStyle() {
    /** Return the Cytoscape stylesheet array. */
    return [
        // All device nodes — base style
        {
            selector: 'node[type="device"]',
            style: {
                'background-color': 'data(color)',
                'label': 'data(label)',
                'text-valign': 'bottom',
                'text-halign': 'center',
                'font-size': '10px',
                'color': '#2c3e50',
                'text-margin-y': 5,
                'width': 48,
                'height': 48,
                'border-width': 2,
                'border-color': '#fff',
                'text-wrap': 'wrap',
                'text-max-width': '100px',
                'shape': 'roundrectangle',
            },
        },
        // MR/CW APs — triangle
        {
            selector: 'node[type="device"][deviceType="mr"]',
            style: { 'shape': 'triangle', 'width': 44, 'height': 44 },
        },
        // MX routers — diamond
        {
            selector: 'node[type="device"][deviceType="mx"]',
            style: { 'shape': 'diamond', 'width': 52, 'height': 52 },
        },
        // Unmanaged — dashed border, hexagon
        {
            selector: 'node[type="device"][isManaged="false"]',
            style: {
                'border-style': 'dashed',
                'border-color': '#7f8c8d',
                'border-width': 2.5,
                'background-color': '#7f8c8d',
                'shape': 'hexagon',
            },
        },
        // Selected node
        {
            selector: 'node:selected',
            style: {
                'border-color': '#f39c12',
                'border-width': 3.5,
                'border-style': 'solid',
            },
        },
        // Edges — base
        {
            selector: 'edge',
            style: {
                'width': 2.5,
                'line-color': '#7f8c8d',
                'target-arrow-shape': 'none',
                'curve-style': 'bezier',
                'opacity': 0.85,
                'label': 'data(srcPort)',
                'font-size': '9px',
                'color': '#444',
                'text-rotation': 'autorotate',
                'text-margin-y': -7,
                'text-background-color': '#eaf0f6',
                'text-background-opacity': 0.8,
                'text-background-padding': '1px',
            },
        },
        // LLDP — blue-grey
        { selector: 'edge[linkType="lldp"]', style: { 'line-color': '#5d8aa8', 'width': 2.5 } },
        // CDP — teal
        { selector: 'edge[linkType="cdp"]',  style: { 'line-color': '#1abc9c', 'width': 2.5 } },
        // Manual — dashed orange
        { selector: 'edge[linkType="manual"]', style: { 'line-color': '#e67e22', 'line-style': 'dashed', 'width': 2 } },
        // Selected edge
        { selector: 'edge:selected', style: { 'line-color': '#f39c12', 'width': 3.5, 'opacity': 1 } },
    ];
}

function renderGraph(topo) {
    /** Build or rebuild the Cytoscape graph from topology data. */
    const elements = buildCytoscapeElements(topo);
    const hasDevices = topo.devices.length > 0;

    document.getElementById('empty-state').style.display = hasDevices ? 'none' : 'block';

    if (cy) { cy.destroy(); cy = null; }

    // Register cose-bilkent once
    if (typeof cytoscapeCoseBilkent !== 'undefined') {
        try { cytoscape.use(cytoscapeCoseBilkent); } catch (_) {}
    }

    // Use preset (saved positions) if we have them for at least half the nodes,
    // otherwise fall back to auto-layout
    const deviceElements = elements.filter(el => el.data && el.data.type === 'device');
    const savedCount = deviceElements.filter(el => el.position).length;
    const usePreset = savedCount >= Math.ceil(deviceElements.length / 2);

    const layout = usePreset
        ? { name: 'preset', padding: 40, fit: savedCount < deviceElements.length }
        : {
            name: typeof cytoscapeCoseBilkent !== 'undefined' ? 'cose-bilkent' : 'cose',
            animate: false,
            nodeDimensionsIncludeLabels: true,
            idealEdgeLength: 120,
            nodeRepulsion: 12000,
            padding: 50,
            randomize: false,
          };

    cy = cytoscape({
        container: document.getElementById('cy'),
        elements,
        style: buildCytoscapeStyle(),
        layout,
        wheelSensitivity: 0.3,
        minZoom: 0.2,
        maxZoom: 3,
    });

    // Save positions whenever a node is dragged
    cy.on('dragfree', 'node', () => savePositions());

    // Draw room hull overlays after layout is done
    cy.one('layoutstop', () => {
        drawRoomHulls(topo);
        savePositions();
    });

    attachGraphEvents();
}

// ─── Room hull overlay ────────────────────────────────────────────────────────

/**
 * Draw lightweight room label + dashed bounding-box overlays using an SVG
 * layer placed behind the Cytoscape canvas. This avoids compound node sizing
 * issues entirely — rooms are purely cosmetic annotations.
 */
function drawRoomHulls(topo) {
    // Remove any existing hull SVG
    const existing = document.getElementById('room-hulls');
    if (existing) existing.remove();

    if (!cy || topo.devices.every(d => !d.room_id)) return;

    const container = document.getElementById('cy-wrapper');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'room-hulls';
    svg.style.cssText = 'position:absolute;inset:0;pointer-events:none;overflow:visible;';
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    container.prepend(svg);   // behind the canvas

    // Group devices by room
    const roomDevices = {};
    for (const dev of topo.devices) {
        if (!dev.room_id) continue;
        if (!roomDevices[dev.room_id]) roomDevices[dev.room_id] = { name: dev.room_name, nodes: [] };
        const node = cy.$(`#device-${dev.id}`);
        if (node.length) roomDevices[dev.room_id].nodes.push(node);
    }

    const pan  = cy.pan();
    const zoom = cy.zoom();

    /** Convert a Cytoscape model-space point to screen pixel coords. */
    function toScreen(pt) {
        return { x: pt.x * zoom + pan.x, y: pt.y * zoom + pan.y };
    }

    const PAD = 20;
    const ROOM_COLORS = [
        '#3498db','#e74c3c','#2ecc71','#9b59b6',
        '#f39c12','#1abc9c','#e67e22','#16a085',
    ];
    let colorIdx = 0;

    for (const [roomId, info] of Object.entries(roomDevices)) {
        if (!info.nodes.length) continue;

        // Bounding box of all nodes in this room
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const node of info.nodes) {
            const bb = node.renderedBoundingBox({ includeLabels: true });
            minX = Math.min(minX, bb.x1);
            minY = Math.min(minY, bb.y1);
            maxX = Math.max(maxX, bb.x2);
            maxY = Math.max(maxY, bb.y2);
        }

        const x = minX - PAD, y = minY - PAD;
        const w = maxX - minX + PAD * 2, h = maxY - minY + PAD * 2;
        const color = ROOM_COLORS[colorIdx++ % ROOM_COLORS.length];

        // Dashed rectangle
        const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        rect.setAttribute('x', x); rect.setAttribute('y', y);
        rect.setAttribute('width', w); rect.setAttribute('height', h);
        rect.setAttribute('rx', 10); rect.setAttribute('ry', 10);
        rect.setAttribute('fill', color);
        rect.setAttribute('fill-opacity', '0.05');
        rect.setAttribute('stroke', color);
        rect.setAttribute('stroke-width', '1.5');
        rect.setAttribute('stroke-dasharray', '6 3');
        svg.appendChild(rect);

        // Room label
        const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        text.setAttribute('x', x + 10);
        text.setAttribute('y', y + 16);
        text.setAttribute('font-size', '12');
        text.setAttribute('font-family', 'system-ui, sans-serif');
        text.setAttribute('font-weight', '600');
        text.setAttribute('fill', color);
        text.setAttribute('fill-opacity', '0.9');
        text.textContent = info.name;
        svg.appendChild(text);
    }
}

/** Redraw room hulls whenever the viewport changes (pan/zoom/drag). */
function attachHullUpdater(topo) {
    if (!cy) return;
    cy.on('viewport dragfree', () => drawRoomHulls(topo));
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Detail panel
// ─────────────────────────────────────────────────────────────────────────────

function showPlaceholder() {
    document.getElementById('detail-content').innerHTML =
        '<p id="detail-placeholder">Click a device or link to see details.</p>';
}

function showDeviceDetail(deviceId) {
    /** Populate the detail panel for a clicked device node. */
    const device = topology.devices.find(d => d.id === deviceId);
    if (!device) return;

    const panel = document.getElementById('detail-content');
    const roomOptions = buildRoomOptions(device.room_id);

    const infoRows = [
        ['Name',    device.name],
        ['Model',   device.model || '—'],
        ['Type',    device.device_type.toUpperCase()],
        ['IP',      device.ip || '—'],
        ['MAC',     device.mac || '—'],
        ['Network', device.network_name || '—'],
        ['Managed', device.is_managed ? 'Yes' : 'No (manual)'],
    ];

    const infoHtml = infoRows.map(([label, value]) =>
        `<div class="info-row"><span class="label">${label}</span><span class="value">${value}</span></div>`
    ).join('');

    const portTableHtml = device.ports && device.ports.length > 0
        ? buildPortTable(device.ports)
        : '<p style="font-size:0.8rem;color:#95a5a6">No port data available.</p>';

    const annotationHtml = buildAnnotationForm(device);

    panel.innerHTML = `
        <div class="detail-section">
            <h3>Device Info</h3>
            ${infoHtml}
        </div>

        <div class="detail-section">
            <h3>Room Assignment</h3>
            <select class="room-select" id="room-select-${device.id}" onchange="handleRoomChange(${device.id}, this.value)">
                <option value="">— Unassigned —</option>
                ${roomOptions}
            </select>
            <div style="margin-top:8px;display:flex;gap:6px;">
                <input type="text" id="new-room-input" placeholder="New room name…"
                    style="flex:1;padding:5px 8px;border:1px solid #bdc3c7;border-radius:4px;font-size:0.82rem;">
                <button class="btn btn-success" style="padding:5px 10px;font-size:0.8rem"
                    onclick="handleCreateRoom(${device.id})">Add</button>
            </div>
        </div>

        <div class="detail-section">
            <h3>Ports</h3>
            ${portTableHtml}
        </div>

        ${annotationHtml}
    `;
}

function buildPortTable(ports) {
    /** Build the HTML port table for a device. */
    const rows = ports.map(p => {
        const stateBadge = p.link_state === 'up'
            ? '<span class="badge badge-up">UP</span>'
            : p.link_state === 'down'
                ? '<span class="badge badge-down">DOWN</span>'
                : '<span class="badge badge-unknown">?</span>';

        let poeBadge;
        if (!p.poe_capable) {
            poeBadge = '<span class="badge badge-no-poe">No PoE</span>';
        } else if (p.poe_active) {
            const mw = p.poe_power_mw != null ? ` ${p.poe_power_mw}mW` : '';
            poeBadge = `<span class="badge badge-poe-on">PoE ●${mw}</span>`;
        } else {
            poeBadge = `<span class="badge badge-poe-off">${p.poe_enabled ? 'Enabled' : 'Disabled'}</span>`;
        }

        const neighbour = p.neighbour
            ? `<span title="${p.neighbour.platform || ''} — port ${p.neighbour.port_id || ''}">${p.neighbour.device_id || '—'}</span>`
            : '—';

        return `<tr>
            <td><strong>${p.port_id}</strong>${p.name ? `<br><span style="color:#95a5a6;font-size:0.7rem">${p.name}</span>` : ''}</td>
            <td>${stateBadge}</td>
            <td>${p.speed || '—'}</td>
            <td>${p.vlan != null ? p.vlan : '—'}</td>
            <td>${poeBadge}</td>
            <td>${neighbour}</td>
        </tr>`;
    }).join('');

    return `<div style="overflow-x:auto">
        <table class="port-table">
            <thead>
                <tr>
                    <th>Port</th><th>State</th><th>Speed</th><th>VLAN</th><th>PoE</th><th>Neighbour</th>
                </tr>
            </thead>
            <tbody>${rows}</tbody>
        </table>
    </div>`;
}

function buildAnnotationForm(device) {
    /** Build the annotation form — shown for all devices, prominent for unmanaged. */
    const title = device.is_managed ? 'Override / Notes' : '⚠️ Unmanaged Device — Annotate';
    return `
        <div class="detail-section">
            <h3>${title}</h3>
            <div class="annotation-form">
                <label>Display Name</label>
                <input type="text" id="ann-name" value="${escHtml(device.name)}">
                <label>Type</label>
                <select id="ann-type">
                    ${['mx','ms','mr','router','other'].map(t =>
                        `<option value="${t}" ${device.device_type === t ? 'selected' : ''}>${t.toUpperCase()}</option>`
                    ).join('')}
                </select>
                ${!device.is_managed ? `
                <label>Port Count</label>
                <input type="number" id="ann-ports" min="1" value="${device.port_count || ''}">
                <label>MAC Address</label>
                <input type="text" id="ann-mac" value="${escHtml(device.mac || '')}">
                <label>IP Address</label>
                <input type="text" id="ann-ip" value="${escHtml(device.ip || '')}">` : ''}
                <label>Notes</label>
                <textarea id="ann-notes">${escHtml(device.notes || '')}</textarea>
                <button class="btn btn-primary" onclick="handleSaveAnnotation(${device.id}, ${device.is_managed})">
                    Save
                </button>
            </div>
        </div>`;
}

function buildRoomOptions(selectedRoomId) {
    return rooms.map(r =>
        `<option value="${r.id}" ${r.id === selectedRoomId ? 'selected' : ''}>${escHtml(r.name)}</option>`
    ).join('');
}

function showLinkDetail(linkId) {
    /** Populate the detail panel for a clicked edge. */
    const link = topology.links.find(l => l.id === linkId);
    if (!link) return;

    const srcDevice = topology.devices.find(d => d.id === link.src_device_id);
    const dstDevice = link.dst_device_id ? topology.devices.find(d => d.id === link.dst_device_id) : null;

    const srcPort = srcDevice?.ports?.find(p => p.id === link.src_port_id);

    const panel = document.getElementById('detail-content');
    panel.innerHTML = `
        <div class="detail-section">
            <h3>Link Detail</h3>
            <div class="info-row"><span class="label">Type</span><span class="value">${link.link_type.toUpperCase()}</span></div>
            <div class="info-row"><span class="label">Source</span><span class="value">${srcDevice?.name || link.src_device_id}</span></div>
            <div class="info-row"><span class="label">Source Port</span><span class="value">${srcPort?.port_id || '—'}</span></div>
            <div class="info-row"><span class="label">Destination</span><span class="value">${dstDevice?.name || link.dst_device_id || '—'}</span></div>
            <div class="info-row"><span class="label">Notes</span><span class="value">${link.notes || '—'}</span></div>
        </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Event handlers
// ─────────────────────────────────────────────────────────────────────────────

function attachGraphEvents() {
    /** Wire up Cytoscape tap events and room hull updater. */
    cy.on('tap', 'node[type="device"]', evt => {
        showDeviceDetail(evt.target.data('deviceId'));
    });
    cy.on('tap', 'edge', evt => {
        showLinkDetail(evt.target.data('linkId'));
    });
    cy.on('tap', evt => {
        if (evt.target === cy) showPlaceholder();
    });
    attachHullUpdater(topology);
}

async function handleRoomChange(deviceId, roomIdStr) {
    /** Called when the room dropdown changes. */
    const roomId = roomIdStr ? parseInt(roomIdStr, 10) : null;
    try {
        await assignRoom(deviceId, roomId);
        showToast('Room assignment saved', 'success');
        await reloadGraph();
        showDeviceDetail(deviceId);
    } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
    }
}

async function handleCreateRoom(deviceId) {
    /** Create a new room from the inline input and assign the device to it. */
    const input = document.getElementById('new-room-input');
    const name = input.value.trim();
    if (!name) return;
    try {
        const room = await createRoom(name);
        rooms.push(room);
        await assignRoom(deviceId, room.id);
        showToast(`Room "${name}" created`, 'success');
        input.value = '';
        await reloadGraph();
        showDeviceDetail(deviceId);
    } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
    }
}

async function handleSaveAnnotation(deviceId, isManaged) {
    /** Save device annotation fields. isManaged may be boolean or string. */
    const managed = isManaged === true || isManaged === 'true';
    const body = {
        name:  document.getElementById('ann-name')?.value || undefined,
        device_type: document.getElementById('ann-type')?.value || undefined,
        notes: document.getElementById('ann-notes')?.value || undefined,
    };
    if (!managed) {
        const ports = document.getElementById('ann-ports')?.value;
        const mac   = document.getElementById('ann-mac')?.value;
        const ip    = document.getElementById('ann-ip')?.value;
        if (ports) body.port_count = parseInt(ports, 10);
        if (mac)   body.mac = mac;
        if (ip)    body.ip  = ip;
    }
    try {
        await patchDevice(deviceId, body);
        showToast('Device saved', 'success');
        await reloadGraph();
        showDeviceDetail(deviceId);
    } catch (err) {
        showToast(`Error: ${err.message}`, 'error');
    }
}

async function handleScan() {
    /** Trigger a Meraki discovery scan. */
    const btn = document.getElementById('btn-scan');
    const status = document.getElementById('scan-status');
    btn.disabled = true;
    showSpinner('Scanning network…');
    status.textContent = 'Scanning…';
    try {
        const result = await triggerScan();
        await reloadGraph();
        status.textContent = `Last scan: ${new Date(result.scanned_at).toLocaleTimeString()}`;
        const msg = `+${result.devices_added} devices, +${result.ports_added} ports`;
        showToast(`Scan complete — ${msg}`, 'success');
        if (result.errors.length > 0) {
            console.warn('Scan errors:', result.errors);
            showToast(`${result.errors.length} warning(s) — see console`, 'error');
        }
    } catch (err) {
        showToast(`Scan failed: ${err.message}`, 'error');
        status.textContent = 'Scan failed';
    } finally {
        btn.disabled = false;
        hideSpinner();
    }
}

async function handleReset() {
    /** Reset the database after user confirmation. */
    const confirmed = confirm(
        '⚠️ Reset Database\n\nThis will permanently delete ALL devices, ports, links, rooms, and annotations.\n\nAre you sure?'
    );
    if (!confirmed) return;

    const btn = document.getElementById('btn-reset');
    btn.disabled = true;
    showSpinner('Resetting database…');
    try {
        await resetDatabase();
        showToast('Database reset — reloading…', 'success');
        setTimeout(() => location.reload(), 1200);
    } catch (err) {
        showToast(`Reset failed: ${err.message}`, 'error');
        btn.disabled = false;
        hideSpinner();
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. UI helpers
// ─────────────────────────────────────────────────────────────────────────────

function showSpinner(msg = 'Loading…') {
    const el = document.getElementById('spinner-overlay');
    el.querySelector('.spinner-msg').textContent = msg;
    el.classList.add('active');
}

function hideSpinner() {
    document.getElementById('spinner-overlay').classList.remove('active');
}

let toastTimer = null;
function showToast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `visible ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, 3500);
}

function escHtml(str) {
    /** Escape HTML special characters to prevent XSS. */
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function reloadGraph() {
    /** Re-fetch topology from API and re-render the graph. */
    await fetchTopology();
    renderGraph(topology);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Init
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    /** Application entry point — load topology and render graph. */
    loadPositions();
    document.getElementById('btn-scan').addEventListener('click', handleScan);
    document.getElementById('btn-reset').addEventListener('click', handleReset);
    document.getElementById('btn-layout').addEventListener('click', () => {
        localStorage.removeItem(POSITIONS_KEY);
        savedPositions = {};
        if (topology) renderGraph(topology);
        showToast('Layout reset — positions cleared', 'success');
    });

    showPlaceholder();

    try {
        await fetchTopology();
        renderGraph(topology);
    } catch (err) {
        showToast(`Failed to load topology: ${err.message}`, 'error');
        document.getElementById('empty-state').style.display = 'block';
    }
});


