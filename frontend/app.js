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
     * Convert topology API response into Cytoscape elements array.
     * Rooms → compound parent nodes; devices → children; links → edges.
     */
    const elements = [];

    // Always add a virtual "Unassigned" room for devices with no room
    elements.push({
        data: { id: 'room-unassigned', label: 'Unassigned', type: 'room' },
    });

    // Room nodes
    for (const room of topo.rooms) {
        elements.push({
            data: { id: `room-${room.id}`, label: room.name, type: 'room', roomId: room.id },
        });
    }

    // Device id → room compound id lookup
    const deviceRoomMap = {};
    for (const d of topo.devices) {
        deviceRoomMap[d.id] = d.room_id ? `room-${d.room_id}` : 'room-unassigned';
    }

    // Device nodes
    for (const device of topo.devices) {
        const color = DEVICE_COLORS[device.device_type] || DEVICE_COLORS.other;
        const label = `${device.name}\n${device.model || ''}`.trim();
        elements.push({
            data: {
                id: `device-${device.id}`,
                label,
                type: 'device',
                deviceId: device.id,
                deviceType: device.device_type,
                // Store as string so Cytoscape selectors work: [isManaged="false"]
                isManaged: String(device.is_managed),
                color,
                parent: deviceRoomMap[device.id],
            },
        });
    }

    // Edge (link) elements — deduplicate bidirectional links
    const seen = new Set();
    for (const link of topo.links) {
        if (!link.dst_device_id) continue;
        const key = [Math.min(link.src_device_id, link.dst_device_id),
                     Math.max(link.src_device_id, link.dst_device_id)].join('-');
        if (seen.has(key)) continue;
        seen.add(key);
        elements.push({
            data: {
                id: `link-${link.id}`,
                source: `device-${link.src_device_id}`,
                target: `device-${link.dst_device_id}`,
                linkType: link.link_type,
                linkId: link.id,
            },
        });
    }

    return elements;
}

function buildCytoscapeStyle() {
    /** Return the Cytoscape stylesheet array. */
    return [
        // Room compound nodes
        {
            selector: 'node[type="room"]',
            style: {
                'background-color': '#ecf0f1',
                'background-opacity': 0.6,
                'border-color': '#bdc3c7',
                'border-width': 1.5,
                'border-style': 'solid',
                'label': 'data(label)',
                'text-valign': 'top',
                'text-halign': 'center',
                'font-size': '11px',
                'font-weight': 600,
                'color': '#555',
                'padding': '18px',
                'shape': 'roundrectangle',
            },
        },
        // Unassigned room — dashed border
        {
            selector: 'node#room-unassigned',
            style: {
                'border-style': 'dashed',
                'border-color': '#95a5a6',
                'background-color': '#f8f9fa',
            },
        },
        // Device nodes
        {
            selector: 'node[type="device"]',
            style: {
                'background-color': 'data(color)',
                'label': 'data(label)',
                'text-valign': 'bottom',
                'text-halign': 'center',
                'font-size': '9px',
                'color': '#2c3e50',
                'text-margin-y': 4,
                'width': 36,
                'height': 36,
                'shape': 'ellipse',
                'border-width': 2,
                'border-color': '#fff',
                'text-wrap': 'wrap',
                'text-max-width': '80px',
            },
        },
        // Unmanaged device — dashed border (isManaged stored as string)
        {
            selector: 'node[type="device"][isManaged="false"]',
            style: {
                'border-style': 'dashed',
                'border-color': '#7f8c8d',
                'border-width': 2.5,
                'background-color': '#7f8c8d',
            },
        },
        // Selected node
        {
            selector: 'node:selected',
            style: {
                'border-color': '#f39c12',
                'border-width': 3,
            },
        },
        // Edges
        {
            selector: 'edge',
            style: {
                'width': 2,
                'line-color': '#95a5a6',
                'target-arrow-shape': 'none',
                'curve-style': 'bezier',
                'opacity': 0.7,
            },
        },
        {
            selector: 'edge:selected',
            style: {
                'line-color': '#f39c12',
                'width': 3,
                'opacity': 1,
            },
        },
    ];
}

function renderGraph(topo) {
    /** Build or rebuild the Cytoscape graph from topology data. */
    const elements = buildCytoscapeElements(topo);
    const hasDevices = topo.devices.length > 0;

    document.getElementById('empty-state').style.display = hasDevices ? 'none' : 'block';

    if (cy) {
        cy.destroy();
        cy = null;
    }

    // Register cose-bilkent if available, fall back to built-in cose
    let layoutName = 'cose';
    if (typeof cytoscapeCoseBilkent !== 'undefined') {
        try {
            cytoscape.use(cytoscapeCoseBilkent);
            layoutName = 'cose-bilkent';
        } catch (_) {
            // Already registered — still use it
            layoutName = 'cose-bilkent';
        }
    }

    cy = cytoscape({
        container: document.getElementById('cy'),
        elements,
        style: buildCytoscapeStyle(),
        layout: {
            name: layoutName,
            animate: false,
            nodeDimensionsIncludeLabels: true,
            idealEdgeLength: 100,
            nodeRepulsion: 8000,
            padding: 30,
        },
        wheelSensitivity: 0.3,
    });

    // Attach event handlers after render
    attachGraphEvents();
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
    /** Wire up Cytoscape click events. */
    cy.on('tap', 'node[type="device"]', evt => {
        const deviceId = evt.target.data('deviceId');
        showDeviceDetail(deviceId);
    });

    cy.on('tap', 'edge', evt => {
        const linkId = evt.target.data('linkId');
        showLinkDetail(linkId);
    });

    cy.on('tap', evt => {
        // Tap on background — clear panel
        if (evt.target === cy) showPlaceholder();
    });
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
    document.getElementById('btn-scan').addEventListener('click', handleScan);
    document.getElementById('btn-reset').addEventListener('click', handleReset);

    showPlaceholder();

    try {
        await fetchTopology();
        renderGraph(topology);
    } catch (err) {
        showToast(`Failed to load topology: ${err.message}`, 'error');
        document.getElementById('empty-state').style.display = 'block';
    }
});


