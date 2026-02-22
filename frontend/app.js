/**
 * NetworkVisualizer — frontend application
 *
 * Sections:
 *  1. State & room colour palette
 *  2. API helpers
 *  3. Graph rendering (Cytoscape.js)
 *  4. Detail panel
 *  5. Event handlers
 *  6. UI helpers
 *  7. Init
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. State & room colour palette
// ─────────────────────────────────────────────────────────────────────────────

let cy = null;
let topology = null;
let rooms = [];
let savedPositions = {};
// room id (number) → hex colour string, built when topology loads
let roomColorMap = {};

const POSITIONS_KEY = 'nv_positions';

// Distinct colours for room border rings — enough for ~16 rooms
const ROOM_PALETTE = [
    '#e74c3c','#3498db','#2ecc71','#9b59b6',
    '#f39c12','#1abc9c','#e67e22','#16a085',
    '#c0392b','#2980b9','#27ae60','#8e44ad',
    '#d35400','#148f77','#a93226','#1f618d',
];

/** Assign a stable colour to every room, sorted by room id for consistency. */
function buildRoomColors(roomList) {
    roomColorMap = {};
    const sorted = [...roomList].sort((a, b) => a.id - b.id);
    sorted.forEach((r, i) => {
        roomColorMap[r.id] = ROOM_PALETTE[i % ROOM_PALETTE.length];
    });
}

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
    /** Fetch wrapper — throws on non-2xx with a readable message. */
    const res = await fetch(`${API}${path}`, options);
    const body = res.headers.get('content-type')?.includes('json')
        ? await res.json() : await res.text();
    if (!res.ok) {
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
    topology = await apiFetch('/topology');
    rooms = await apiFetch('/rooms');
    buildRoomColors(rooms);
}

async function triggerScan() {
    return await apiFetch('/scan', { method: 'POST' });
}

async function resetDatabase() {
    return await apiFetch('/db', {
        method: 'DELETE',
        headers: { 'X-Confirm-Reset': 'yes-delete-everything' },
    });
}

async function patchDevice(deviceId, body) {
    return await apiFetch(`/device/${deviceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

async function assignRoom(deviceId, roomId) {
    return await apiFetch(`/device/${deviceId}/room`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room_id: roomId }),
    });
}

async function createRoom(name, notes = '') {
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

// Border width for room ring vs default
const ROOM_BORDER_WIDTH  = 5;
const DEFAULT_BORDER_WIDTH = 2;

function buildCytoscapeElements(topo) {
    /**
     * Flat element list — no compound nodes.
     * Room membership shown via a thick coloured border ring on each node.
     * Saved positions from localStorage are applied when available.
     */
    const elements = [];

    for (const device of topo.devices) {
        const nodeColor  = DEVICE_COLORS[device.device_type] || DEVICE_COLORS.other;
        const roomColor  = device.room_id ? (roomColorMap[device.room_id] || '#bdc3c7') : '#ffffff';
        const borderW    = device.room_id ? ROOM_BORDER_WIDTH : DEFAULT_BORDER_WIDTH;
        // Label: name + model only — room shown in legend, not cluttering the node
        const label = [device.name, device.model].filter(Boolean).join('\n');
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
                nodeColor,
                roomColor,
                borderW,
                roomId: device.room_id || null,
                roomName: device.room_name || '',
            },
        };
        if (pos) el.position = { x: pos.x, y: pos.y };
        elements.push(el);
    }

    // Port DB id → port_id string for edge labels
    const portIdMap = {};
    for (const device of topo.devices) {
        for (const p of (device.ports || [])) portIdMap[p.id] = p.port_id;
    }

    // Edges — deduplicate bidirectional links
    const seen = new Set();
    for (const link of topo.links) {
        if (!link.dst_device_id) continue;
        const key = [Math.min(link.src_device_id, link.dst_device_id),
                     Math.max(link.src_device_id, link.dst_device_id)].join('-');
        if (seen.has(key)) continue;
        seen.add(key);
        const rawPort = link.src_port_id != null ? portIdMap[link.src_port_id] : null;
        elements.push({
            data: {
                id: `link-${link.id}`,
                source: `device-${link.src_device_id}`,
                target: `device-${link.dst_device_id}`,
                linkType: link.link_type,
                linkId: link.id,
                srcPort: rawPort != null ? `p${rawPort}` : '',
            },
        });
    }
    return elements;
}

function buildCytoscapeStyle() {
    return [
        // Base device style — uses mapped data properties for colour/border
        {
            selector: 'node[type="device"]',
            style: {
                'background-color':  'data(nodeColor)',
                'border-color':      'data(roomColor)',
                'border-width':      'data(borderW)',
                'border-style':      'solid',
                'label':             'data(label)',
                'text-valign':       'bottom',
                'text-halign':       'center',
                'font-size':         '10px',
                'color':             '#2c3e50',
                'text-margin-y':     6,
                'width':             46,
                'height':            46,
                'text-wrap':         'wrap',
                'text-max-width':    '100px',
                'shape':             'roundrectangle',
            },
        },
        // MR/CW APs — triangle
        { selector: 'node[deviceType="mr"]', style: { 'shape': 'triangle', 'width': 42, 'height': 42 } },
        // MX routers — diamond
        { selector: 'node[deviceType="mx"]', style: { 'shape': 'diamond', 'width': 50, 'height': 50 } },
        // Unmanaged — dashed border ring, hexagon shape
        {
            selector: 'node[isManaged="false"]',
            style: {
                'border-style':  'dashed',
                'background-color': '#7f8c8d',
                'shape':         'hexagon',
            },
        },
        // Selected — bright orange outline, overrides room ring
        {
            selector: 'node:selected',
            style: {
                'border-color': '#f39c12',
                'border-width': 4,
                'border-style': 'solid',
            },
        },
        // Edges
        {
            selector: 'edge',
            style: {
                'width': 2.5,
                'line-color': '#95a5a6',
                'target-arrow-shape': 'none',
                'curve-style': 'bezier',
                'opacity': 0.85,
                'label': 'data(srcPort)',
                'font-size': '9px',
                'color': '#555',
                'text-rotation': 'autorotate',
                'text-margin-y': -7,
                'text-background-color': '#eaf0f6',
                'text-background-opacity': 0.85,
                'text-background-padding': '1px',
            },
        },
        { selector: 'edge[linkType="lldp"]',   style: { 'line-color': '#5d8aa8' } },
        { selector: 'edge[linkType="cdp"]',    style: { 'line-color': '#1abc9c' } },
        { selector: 'edge[linkType="manual"]', style: { 'line-color': '#e67e22', 'line-style': 'dashed' } },
        { selector: 'edge:selected',           style: { 'line-color': '#f39c12', 'width': 3.5, 'opacity': 1 } },
        // Port-click highlight — overrides all other edge styles
        {
            selector: 'edge.highlighted',
            style: {
                'line-color':            '#2ecc71',
                'width':                 5,
                'opacity':               1,
                'line-style':            'solid',
                'font-size':             '11px',
                'font-weight':           'bold',
                'color':                 '#27ae60',
                'text-background-color': '#fff',
                'text-background-opacity': 1,
                'text-background-padding': '3px',
                'z-index':               999,
            },
        },
        // Dim all other edges when one is highlighted
        {
            selector: 'edge.dimmed',
            style: { 'opacity': 0.15 },
        },
        // Dim nodes when a link is highlighted
        {
            selector: 'node.dimmed',
            style: { 'opacity': 0.25 },
        },
    ];
}

function renderGraph(topo) {
    const elements = buildCytoscapeElements(topo);
    const hasDevices = topo.devices.length > 0;
    document.getElementById('empty-state').style.display = hasDevices ? 'none' : 'block';

    if (cy) { cy.destroy(); cy = null; }

    if (typeof cytoscapeCoseBilkent !== 'undefined') {
        try { cytoscape.use(cytoscapeCoseBilkent); } catch (_) {}
    }

    const deviceEls = elements.filter(el => el.data?.type === 'device');
    const savedCount = deviceEls.filter(el => el.position).length;
    const usePreset = savedCount >= Math.ceil(deviceEls.length / 2);

    const layout = usePreset
        ? { name: 'preset', padding: 40, fit: savedCount < deviceEls.length }
        : {
            name: typeof cytoscapeCoseBilkent !== 'undefined' ? 'cose-bilkent' : 'cose',
            animate: false,
            nodeDimensionsIncludeLabels: true,
            idealEdgeLength: 130,
            nodeRepulsion: 12000,
            padding: 60,
            randomize: false,
          };

    cy = cytoscape({
        container: document.getElementById('cy'),
        elements,
        style: buildCytoscapeStyle(),
        layout,
        wheelSensitivity: 0.3,
        minZoom: 0.15,
        maxZoom: 3,
    });

    cy.on('dragfree', 'node', () => savePositions());
    cy.one('layoutstop', () => savePositions());
    attachGraphEvents();

    // Update the legend whenever rooms or topology changes
    renderLegend(topo);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Detail panel & legend
// ─────────────────────────────────────────────────────────────────────────────

function renderLegend(topo) {
    /**
     * Render the room colour legend and device type key into #legend.
     * Called after every graph render.
     */
    const el = document.getElementById('legend');
    if (!el) return;

    const assignedRooms = topo.rooms.filter(r =>
        topo.devices.some(d => d.room_id === r.id)
    );

    let html = '';

    if (assignedRooms.length) {
        html += '<div class="legend-section"><strong>Rooms</strong>';
        for (const r of assignedRooms) {
            const c = roomColorMap[r.id] || '#bdc3c7';
            html += `<div class="legend-item">
                <span class="legend-swatch" style="border:3px solid ${c};background:transparent;"></span>
                ${escHtml(r.name)}
            </div>`;
        }
        // Unassigned devices indicator
        if (topo.devices.some(d => !d.room_id)) {
            html += `<div class="legend-item">
                <span class="legend-swatch" style="border:2px solid #fff;background:#ccc;"></span>
                Unassigned
            </div>`;
        }
        html += '</div>';
    }

    html += `<div class="legend-section"><strong>Device type</strong>
        <div class="legend-item"><span class="legend-swatch" style="background:#2980b9;border-radius:3px;"></span> Switch (MS)</div>
        <div class="legend-item"><span class="legend-swatch" style="background:#e67e22;clip-path:polygon(50% 0%,100% 100%,0% 100%);transform:rotate(0deg);"></span> Firewall/Router (MX)</div>
        <div class="legend-item"><span class="legend-swatch" style="background:#27ae60;clip-path:polygon(50% 0%,100% 100%,0% 100%);"></span> Wireless AP (MR/CW)</div>
        <div class="legend-item"><span class="legend-swatch" style="background:#c0392b;border-radius:3px;"></span> Router</div>
        <div class="legend-item"><span class="legend-swatch" style="background:#7f8c8d;border:2px dashed #555;"></span> Unmanaged</div>
    </div>
    <div class="legend-section"><strong>Links</strong>
        <div class="legend-item"><span class="legend-line" style="background:#5d8aa8;"></span> LLDP</div>
        <div class="legend-item"><span class="legend-line" style="background:#1abc9c;"></span> CDP</div>
        <div class="legend-item"><span class="legend-line" style="background:#e67e22;border-top:2px dashed #e67e22;height:0;"></span> Manual</div>
    </div>`;

    el.innerHTML = html;
}

function showPlaceholder() {
    document.getElementById('detail-content').innerHTML =
        '<p id="detail-placeholder">Click a device or link to see details.</p>';
    hidePortPanel();
}

function showDeviceDetail(deviceId) {
    const device = topology.devices.find(d => d.id === deviceId);
    if (!device) return;

    const panel = document.getElementById('detail-content');
    const roomColor = device.room_id ? (roomColorMap[device.room_id] || '#ccc') : null;
    const roomBadge = device.room_name
        ? `<span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:0.75rem;font-weight:600;
                border:2px solid ${roomColor};color:${roomColor};margin-left:6px;">${escHtml(device.room_name)}</span>`
        : '';

    const infoRows = [
        ['Model',   device.model || '—'],
        ['Type',    device.device_type.toUpperCase()],
        ['IP',      device.ip || '—'],
        ['MAC',     device.mac || '—'],
        ['Network', device.network_name || '—'],
        ['Managed', device.is_managed ? 'Yes' : 'No (manual)'],
    ];

    const infoHtml = infoRows.map(([label, value]) =>
        `<div class="info-row"><span class="label">${label}</span><span class="value">${escHtml(String(value))}</span></div>`
    ).join('');

    panel.innerHTML = `
        <div class="detail-section">
            <h3>Device Info</h3>
            <div style="font-weight:600;font-size:0.9rem;padding:4px 0 8px;">${escHtml(device.name)}${roomBadge}</div>
            ${infoHtml}
        </div>

        <div class="detail-section">
            <h3>Room Assignment</h3>
            <select class="room-select" id="room-select-${device.id}"
                    onchange="handleRoomChange(${device.id}, this.value)">
                <option value="">— Unassigned —</option>
                ${buildRoomOptions(device.room_id)}
            </select>
            <div style="margin-top:8px;display:flex;gap:6px;">
                <input type="text" id="new-room-input" placeholder="New room name…"
                    style="flex:1;padding:5px 8px;border:1px solid #bdc3c7;border-radius:4px;font-size:0.82rem;">
                <button class="btn btn-success" style="padding:5px 10px;font-size:0.8rem"
                    onclick="handleCreateRoom(${device.id})">Add</button>
            </div>
        </div>

        ${buildAnnotationForm(device)}
    `;

    // Populate the bottom port panel (hidden if no ports)
    if (device.ports && device.ports.length > 0) {
        showPortPanel(device.ports, device.name);
    } else {
        hidePortPanel();
    }
}

function buildPortTable(ports) {
    // Build port DB id → link id lookup from current topology
    const portLinkMap = {};
    if (topology) {
        for (const link of topology.links) {
            if (link.src_port_id) portLinkMap[link.src_port_id] = link.id;
            if (link.dst_port_id) portLinkMap[link.dst_port_id] = link.id;
        }
    }

    const rows = ports.map(p => {
        const linkId = portLinkMap[p.id];
        const rowAttrs = linkId
            ? `data-link-id="${linkId}" data-port-id="${p.id}" class="port-row port-linked"`
            : `data-port-id="${p.id}" class="port-row"`;

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
            poeBadge = `<span class="badge badge-poe-on">PoE●${mw}</span>`;
        } else {
            poeBadge = `<span class="badge badge-poe-off">${p.poe_enabled ? 'Enabled' : 'Off'}</span>`;
        }

        const nbr = p.neighbour
            ? `<span title="${escHtml(p.neighbour.platform || '')} — port ${escHtml(p.neighbour.port_id || '')}">${escHtml(p.neighbour.device_id || '—')}</span>`
            : '—';

        // Show a small graph icon on rows that have a link to click
        const linkHint = linkId ? ' <span class="port-link-hint" title="Click to highlight link in graph">⇢</span>' : '';

        return `<tr ${rowAttrs}>
            <td><strong>${escHtml(p.port_id)}</strong>${linkHint}${p.name ? `<br><span style="color:#95a5a6;font-size:0.7rem">${escHtml(p.name)}</span>` : ''}</td>
            <td>${stateBadge}</td>
            <td>${escHtml(p.speed || '—')}</td>
            <td>${p.vlan != null ? p.vlan : '—'}</td>
            <td>${poeBadge}</td>
            <td>${nbr}</td>
        </tr>`;
    }).join('');

    return `<div style="overflow-x:auto"><table class="port-table">
        <thead><tr><th>Port</th><th>State</th><th>Speed</th><th>VLAN</th><th>PoE</th><th>Neighbour</th></tr></thead>
        <tbody>${rows}</tbody>
    </table></div>`;
}

function showPortPanel(ports, deviceName) {
    /** Show the bottom port strip with the port table for the given device. */
    document.getElementById('port-panel-title').textContent = `Ports — ${deviceName}`;
    document.getElementById('port-panel-content').innerHTML = buildPortTable(ports);
    document.getElementById('port-panel').classList.add('visible');
    attachPortPanelEvents();
}

function hidePortPanel() {
    /** Hide the bottom port strip and clear any graph highlight. */
    clearHighlight();
    document.getElementById('port-panel').classList.remove('visible');
}

let _highlightedLinkId = null;  // track currently highlighted link

function highlightLink(linkId) {
    /** Highlight the edge for linkId and dim all others. */
    if (!cy) return;
    clearHighlight();
    const edgeId = `link-${linkId}`;
    const edge = cy.$(`#${edgeId}`);
    if (!edge.length) return;

    // Dim everything, then highlight the target edge and its endpoint nodes
    cy.edges().addClass('dimmed');
    cy.nodes().addClass('dimmed');
    edge.removeClass('dimmed').addClass('highlighted');
    edge.connectedNodes().removeClass('dimmed');

    // Pan & zoom to show the edge with context
    cy.animate({
        fit: { eles: edge.connectedNodes(), padding: 80 },
        duration: 350,
        easing: 'ease-in-out-cubic',
    });

    _highlightedLinkId = linkId;
}

function clearHighlight() {
    /** Remove all highlight/dim classes from the graph. */
    if (!cy) return;
    cy.edges().removeClass('highlighted dimmed');
    cy.nodes().removeClass('dimmed');
    _highlightedLinkId = null;

    // Clear selected row in port table
    document.querySelectorAll('.port-row.active').forEach(r => r.classList.remove('active'));
}

function attachPortPanelEvents() {
    /** Delegate click events on port rows in the port panel. */
    const content = document.getElementById('port-panel-content');

    // Remove old listener by replacing the node
    const fresh = content.cloneNode(true);
    content.parentNode.replaceChild(fresh, content);

    fresh.addEventListener('click', evt => {
        const row = evt.target.closest('tr.port-row');
        if (!row) return;

        const linkId = row.dataset.linkId ? parseInt(row.dataset.linkId, 10) : null;

        // Toggle off if clicking the already-highlighted row
        if (linkId && linkId === _highlightedLinkId) {
            clearHighlight();
            return;
        }

        // Clear previous selection
        document.querySelectorAll('.port-row.active').forEach(r => r.classList.remove('active'));
        row.classList.add('active');

        if (linkId) {
            highlightLink(linkId);
        } else {
            clearHighlight();
        }
    });
}

function buildAnnotationForm(device) {
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
    hidePortPanel();
    const link = topology.links.find(l => l.id === linkId);
    if (!link) return;
    const srcDevice = topology.devices.find(d => d.id === link.src_device_id);
    const dstDevice = link.dst_device_id ? topology.devices.find(d => d.id === link.dst_device_id) : null;
    const srcPort = srcDevice?.ports?.find(p => p.id === link.src_port_id);

    document.getElementById('detail-content').innerHTML = `
        <div class="detail-section">
            <h3>Link Detail</h3>
            <div class="info-row"><span class="label">Type</span><span class="value">${link.link_type.toUpperCase()}</span></div>
            <div class="info-row"><span class="label">Source</span><span class="value">${escHtml(srcDevice?.name || String(link.src_device_id))}</span></div>
            <div class="info-row"><span class="label">Source Port</span><span class="value">${escHtml(srcPort?.port_id || '—')}</span></div>
            <div class="info-row"><span class="label">Destination</span><span class="value">${escHtml(dstDevice?.name || String(link.dst_device_id || '—'))}</span></div>
            <div class="info-row"><span class="label">Notes</span><span class="value">${escHtml(link.notes || '—')}</span></div>
        </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Event handlers
// ─────────────────────────────────────────────────────────────────────────────

function attachGraphEvents() {
    cy.on('tap', 'node[type="device"]', evt => showDeviceDetail(evt.target.data('deviceId')));
    cy.on('tap', 'edge',               evt => showLinkDetail(evt.target.data('linkId')));
    cy.on('tap', evt => {
        if (evt.target === cy) {
            showPlaceholder();
            clearHighlight();
        }
    });
}

async function handleRoomChange(deviceId, roomIdStr) {
    const roomId = roomIdStr ? parseInt(roomIdStr, 10) : null;
    try {
        await assignRoom(deviceId, roomId);
        showToast('Room assignment saved', 'success');
        await reloadGraph();
        showDeviceDetail(deviceId);
    } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
}

async function handleCreateRoom(deviceId) {
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
    } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
}

async function handleSaveAnnotation(deviceId, isManaged) {
    const managed = isManaged === true || isManaged === 'true';
    const body = {
        name:        document.getElementById('ann-name')?.value || undefined,
        device_type: document.getElementById('ann-type')?.value || undefined,
        notes:       document.getElementById('ann-notes')?.value || undefined,
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
    } catch (err) { showToast(`Error: ${err.message}`, 'error'); }
}

async function handleScan() {
    const btn = document.getElementById('btn-scan');
    const status = document.getElementById('scan-status');
    btn.disabled = true;
    showSpinner('Scanning network…');
    status.textContent = 'Scanning…';
    try {
        const result = await triggerScan();
        await reloadGraph();
        status.textContent = `Last scan: ${new Date(result.scanned_at).toLocaleTimeString()}`;
        showToast(`Scan complete — +${result.devices_added} devices, +${result.ports_added} ports`, 'success');
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
    if (!confirm('⚠️ Reset Database\n\nThis will permanently delete ALL data.\n\nAre you sure?')) return;
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
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function reloadGraph() {
    await fetchTopology();
    renderGraph(topology);
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Init
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    loadPositions();
    document.getElementById('btn-scan').addEventListener('click', handleScan);
    document.getElementById('btn-reset').addEventListener('click', handleReset);
    document.getElementById('btn-layout').addEventListener('click', () => {
        localStorage.removeItem(POSITIONS_KEY);
        savedPositions = {};
        if (topology) renderGraph(topology);
        showToast('Layout reset', 'success');
    });
    document.getElementById('port-panel-close').addEventListener('click', hidePortPanel);

    showPlaceholder();

    try {
        await fetchTopology();
        renderGraph(topology);
    } catch (err) {
        showToast(`Failed to load topology: ${err.message}`, 'error');
        document.getElementById('empty-state').style.display = 'block';
    }
});

