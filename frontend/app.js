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
    savedPositions = pos;  // keep in-memory state current
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

// ─── Network device icons (inline SVG data URIs) ──────────────────────────────
//
// Cisco-style monochrome icons. Each SVG is white on a transparent background
// so it reads clearly over the coloured node fill.
//
// Encoding: btoa(svgString) — plain base64, no external dependency.

function _svgUri(svg) {
    /** Convert an SVG string to a Cytoscape-compatible data URI. */
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svg)));
}

const DEVICE_ICONS = {
    // MS switch — content within x=10..54, y=14..50 (balanced padding)
    ms: _svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <rect x="10" y="18" width="44" height="28" rx="4" fill="none" stroke="white" stroke-width="4"/>
        <line x1="17" y1="27" x2="47" y2="27" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="17" y1="37" x2="47" y2="37" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
        <polyline points="24,22 17,27 24,32" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
        <polyline points="40,32 47,37 40,42" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`),

    // MX firewall — shield padded symmetrically
    mx: _svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <path d="M32 8 L54 16 L54 33 C54 45 44 53 32 57 C20 53 10 45 10 33 L10 16 Z"
              fill="none" stroke="white" stroke-width="4" stroke-linejoin="round"/>
        <line x1="32" y1="22" x2="32" y2="46" stroke="white" stroke-width="4" stroke-linecap="round"/>
        <line x1="20" y1="32" x2="44" y2="32" stroke="white" stroke-width="4" stroke-linecap="round"/>
    </svg>`),

    // MR/CW AP — box y=36..54, arcs up to y=12, total span y=12..54 (centre=33), padded sides
    mr: _svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <rect x="10" y="37" width="44" height="16" rx="3" fill="none" stroke="white" stroke-width="4"/>
        <line x1="32" y1="37" x2="32" y2="28" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
        <path d="M23 30 A13 13 0 0 1 41 30" fill="none" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
        <path d="M17 24 A20 20 0 0 1 47 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round"/>
        <path d="M11 18 A28 28 0 0 1 53 18" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="21" cy="45" r="2.5" fill="white"/>
        <circle cx="32" cy="45" r="2.5" fill="white"/>
        <circle cx="43" cy="45" r="2.5" fill="white"/>
    </svg>`),

    // Router — circle with arrows, padded within 10..54
    router: _svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <circle cx="32" cy="32" r="20" fill="none" stroke="white" stroke-width="4"/>
        <line x1="32" y1="12" x2="32" y2="52" stroke="white" stroke-width="3" stroke-linecap="round"/>
        <line x1="12" y1="32" x2="52" y2="32" stroke="white" stroke-width="3" stroke-linecap="round"/>
        <polyline points="28,17 32,12 36,17" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        <polyline points="28,47 32,52 36,47" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        <polyline points="17,28 12,32 17,36" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
        <polyline points="47,28 52,32 47,36" fill="none" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`),

    // Server — top bar y=12..26, bottom bar y=38..52, gap centred at y=32
    other: _svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <rect x="10" y="12" width="44" height="16" rx="3" fill="none" stroke="white" stroke-width="4"/>
        <rect x="10" y="36" width="44" height="16" rx="3" fill="none" stroke="white" stroke-width="4"/>
        <circle cx="47" cy="20" r="3" fill="white"/>
        <circle cx="47" cy="44" r="3" fill="white"/>
        <line x1="17" y1="20" x2="38" y2="20" stroke="white" stroke-width="3" stroke-linecap="round"/>
        <line x1="17" y1="44" x2="38" y2="44" stroke="white" stroke-width="3" stroke-linecap="round"/>
    </svg>`),

    // MV camera — lens circle with crosshairs and a small body/mount
    mv: _svgUri(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
        <circle cx="32" cy="30" r="16" fill="none" stroke="white" stroke-width="4"/>
        <circle cx="32" cy="30" r="7"  fill="none" stroke="white" stroke-width="3"/>
        <line x1="32" y1="14" x2="32" y2="10" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="32" y1="46" x2="32" y2="50" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="16" y1="30" x2="12" y2="30" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="48" y1="30" x2="52" y2="30" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
        <rect x="24" y="50" width="16" height="6" rx="2" fill="none" stroke="white" stroke-width="3"/>
    </svg>`),
};

// Tinted background colours — slightly desaturated so the white icon pops
const DEVICE_COLORS = {
    mx:     '#c07a3a',   // warm brown-orange
    ms:     '#2471a3',   // steel blue
    mr:     '#1e8449',   // forest green
    mv:     '#6c3483',   // purple — cameras
    router: '#922b21',   // dark red
    other:  '#626567',   // mid grey
};

// Border width for room ring vs default
const ROOM_BORDER_WIDTH    = 5;
const DEFAULT_BORDER_WIDTH = 2;

function buildCytoscapeElements(topo) {
    /**
     * Flat element list — no compound nodes.
     * Room membership shown via a thick coloured border ring on each node.
     * Saved positions from localStorage are applied when available.
     */
    const elements = [];

    for (const device of topo.devices) {
        const nodeColor = DEVICE_COLORS[device.device_type] || DEVICE_COLORS.other;
        const roomColor = device.room_id ? (roomColorMap[device.room_id] || '#bdc3c7') : '#ffffff';
        const borderW   = device.room_id ? ROOM_BORDER_WIDTH : DEFAULT_BORDER_WIDTH;
        const icon      = DEVICE_ICONS[device.device_type] || DEVICE_ICONS.other;
        const label     = [device.name, device.model].filter(Boolean).join('\n');
        const nodeId    = `device-${device.id}`;
        const pos       = savedPositions[nodeId];
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
                icon,
                roomId:   device.room_id || null,
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
        // ── All device nodes ────────────────────────────────────────────────
        {
            selector: 'node[type="device"]',
            style: {
                'shape':                    'roundrectangle',
                'width':                    52,
                'height':                   52,
                'background-color':         'data(nodeColor)',
                'background-image':         'data(icon)',
                'background-fit':           'contain',
                'background-clip':          'node',
                'background-image-opacity': 1,
                'border-color':             'data(roomColor)',
                'border-width':             'data(borderW)',
                'border-style':             'solid',
                'label':                    'data(label)',
                'text-valign':              'bottom',
                'text-halign':              'center',
                'font-size':                '10px',
                'color':                    '#2c3e50',
                'text-margin-y':            6,
                'text-wrap':                'wrap',
                'text-max-width':           '110px',
            },
        },
        // Unmanaged — dashed border, greyed fill, same icon
        {
            selector: 'node[isManaged="false"]',
            style: {
                'background-color': '#7f8c8d',
                'border-style':     'dashed',
                'border-color':     '#566573',
                'border-width':     2.5,
            },
        },
        // Selected — bright orange outline overrides room ring
        {
            selector: 'node:selected',
            style: {
                'border-color': '#f39c12',
                'border-width': 4,
                'border-style': 'solid',
            },
        },
        // ── Edges ────────────────────────────────────────────────────────────
        {
            selector: 'edge',
            style: {
                'width':                    2.5,
                'line-color':               '#95a5a6',
                'target-arrow-shape':       'none',
                'curve-style':              'bezier',
                'opacity':                  0.85,
                'label':                    'data(srcPort)',
                'font-size':                '9px',
                'color':                    '#555',
                'text-rotation':            'autorotate',
                'text-margin-y':            -7,
                'text-background-color':    '#eaf0f6',
                'text-background-opacity':  0.85,
                'text-background-padding':  '1px',
            },
        },
        { selector: 'edge[linkType="lldp"]',   style: { 'line-color': '#5d8aa8' } },
        { selector: 'edge[linkType="cdp"]',    style: { 'line-color': '#1abc9c' } },
        { selector: 'edge[linkType="manual"]', style: { 'line-color': '#e67e22', 'line-style': 'dashed' } },
        { selector: 'edge:selected',           style: { 'line-color': '#f39c12', 'width': 3.5, 'opacity': 1 } },
        // Port-click highlight
        {
            selector: 'edge.highlighted',
            style: {
                'line-color':              '#2ecc71',
                'width':                   5,
                'opacity':                 1,
                'line-style':              'solid',
                'font-size':               '11px',
                'font-weight':             'bold',
                'color':                   '#27ae60',
                'text-background-color':   '#fff',
                'text-background-opacity': 1,
                'text-background-padding': '3px',
                'z-index':                 999,
            },
        },
        { selector: 'edge.dimmed', style: { 'opacity': 0.12 } },
        { selector: 'node.dimmed', style: { 'opacity': 0.15 } },
        // Room highlight — bright border, full opacity, slight glow via outline
        {
            selector: 'node.room-highlighted',
            style: {
                'opacity':       1,
                'border-width':  6,
                'border-style':  'solid',
            },
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
    const unsavedEls = deviceEls.filter(el => !el.position);
    const usePreset  = savedCount >= Math.ceil(deviceEls.length / 2);

    // Give unsaved nodes a staggered starting position so they don't all
    // pile up at {0,0} when a preset layout is used.  Place them in a row
    // below/beside the existing nodes so the user can drag them into place.
    if (usePreset && unsavedEls.length > 0) {
        // Find the bounding box of saved nodes to place new ones below it
        const savedPositionList = deviceEls
            .filter(el => el.position)
            .map(el => el.position);
        const maxY = savedPositionList.length
            ? Math.max(...savedPositionList.map(p => p.y)) + 120
            : 300;
        const startX = savedPositionList.length
            ? Math.min(...savedPositionList.map(p => p.x))
            : 100;
        unsavedEls.forEach((el, i) => {
            el.position = { x: startX + i * 120, y: maxY };
        });
    }

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

    // Pre-compute counts
    const roomCounts = {};
    for (const d of topo.devices) {
        if (d.room_id) roomCounts[d.room_id] = (roomCounts[d.room_id] || 0) + 1;
    }
    const unassignedCount = topo.devices.filter(d => !d.room_id).length;

    const typeCounts = {};
    for (const d of topo.devices) {
        typeCounts[d.device_type] = (typeCounts[d.device_type] || 0) + 1;
    }

    let html = '';

    if (assignedRooms.length) {
        html += '<div class="legend-section"><strong>Rooms</strong><div class="legend-hint">Click to highlight</div>';
        for (const r of assignedRooms) {
            const c     = roomColorMap[r.id] || '#bdc3c7';
            const count = roomCounts[r.id] || 0;
            const badge = `<span class="legend-count">${count}</span>`;
            html += `<div class="legend-item legend-room-item" data-room-id="${r.id}" onclick="handleRoomHighlight(${r.id})" title="Click to highlight ${escHtml(r.name)}">
                <span class="legend-swatch" style="border:3px solid ${c};background:transparent;"></span>
                ${escHtml(r.name)} ${badge}
            </div>`;
        }
        if (unassignedCount > 0) {
            html += `<div class="legend-item legend-room-item" data-room-id="unassigned" onclick="handleRoomHighlight('unassigned')" title="Click to highlight unassigned devices">
                <span class="legend-swatch" style="border:2px solid #fff;background:#ccc;"></span>
                Unassigned <span class="legend-count">${unassignedCount}</span>
            </div>`;
        }
        html += '</div>';
    }

    // Device type labels and their display names
    const typeLabels = {
        ms:     'Switch (MS)',
        mx:     'Firewall (MX)',
        mr:     'Wireless AP (MR/CW)',
        mv:     'Camera (MV)',
        router: 'Router',
        other:  'Unmanaged',
    };

    html += '<div class="legend-section"><strong>Device type</strong><div class="legend-hint">Click to highlight</div>';
    for (const [type, label] of Object.entries(typeLabels)) {
        const count = typeCounts[type] || 0;
        if (count === 0) continue;  // omit types not present in this topology
        const badge = `<span class="legend-count">${count}</span>`;
        const iconStyle = type === 'other'
            ? `background:#7f8c8d;border:2px dashed #566573;`
            : `background:${DEVICE_COLORS[type]};`;
        html += `<div class="legend-item legend-type-item" data-device-type="${type}" onclick="handleDeviceTypeHighlight('${type}')">
            <span class="legend-icon" style="${iconStyle}"><img src="${DEVICE_ICONS[type]}"></span>
            ${label} ${badge}
        </div>`;
    }
    html += '</div>';

    html += `<div class="legend-section"><strong>Links</strong><div class="legend-hint">Click to highlight</div>
        <div class="legend-item legend-type-item" data-link-type="lldp" onclick="handleLinkTypeHighlight('lldp')"><span class="legend-line" style="background:#5d8aa8;"></span> LLDP</div>
        <div class="legend-item legend-type-item" data-link-type="cdp" onclick="handleLinkTypeHighlight('cdp')"><span class="legend-line" style="background:#1abc9c;"></span> CDP</div>
        <div class="legend-item legend-type-item" data-link-type="manual" onclick="handleLinkTypeHighlight('manual')"><span class="legend-line" style="background:#e67e22;border-top:2px dashed #e67e22;height:0;"></span> Manual</div>
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

let _highlightedLinkId  = null;  // port-panel edge highlight
let _activeRoomId       = null;  // legend room highlight
let _activeDeviceType   = null;  // legend device type highlight
let _activeLinkType     = null;  // legend link type highlight
let _savedViewport      = null;  // viewport before any highlight, for restore

function _saveViewport() {
    if (!cy || _savedViewport) return;  // only save once per highlight session
    _savedViewport = { zoom: cy.zoom(), pan: { ...cy.pan() } };
}

function _restoreViewport() {
    if (!cy || !_savedViewport) return;
    cy.animate({ zoom: _savedViewport.zoom, pan: _savedViewport.pan, duration: 350, easing: 'ease-in-out-cubic' });
    _savedViewport = null;
}

/** Clear every highlight type and restore the original viewport. */
function clearAllHighlights() {
    if (!cy) return;
    cy.nodes().removeClass('dimmed room-highlighted');
    cy.edges().removeClass('dimmed highlighted');
    clearHighlight();          // clears port-panel edge state
    _activeRoomId     = null;
    _activeDeviceType = null;
    _activeLinkType   = null;
    document.querySelectorAll('.legend-room-item, .legend-type-item').forEach(el =>
        el.classList.remove('legend-room-active')
    );
    _restoreViewport();
}

function highlightRoom(roomId) {
    clearAllHighlights();
    _saveViewport();

    const matchFn = roomId === 'unassigned'
        ? n => !n.data('roomId')
        : n => String(n.data('roomId')) === String(roomId);

    const inRoom  = cy.nodes('[type="device"]').filter(n => matchFn(n));
    const outRoom = cy.nodes('[type="device"]').filter(n => !matchFn(n));

    outRoom.addClass('dimmed');
    inRoom.addClass('room-highlighted');
    cy.edges().forEach(e => {
        if (!inRoom.has(e.source()) && !inRoom.has(e.target())) e.addClass('dimmed');
    });

    if (inRoom.length) {
        cy.animate({ fit: { eles: inRoom, padding: 80 }, duration: 350, easing: 'ease-in-out-cubic' });
    }

    _activeRoomId = roomId;
    document.querySelectorAll('.legend-room-item').forEach(el =>
        el.classList.toggle('legend-room-active', String(el.dataset.roomId) === String(roomId))
    );
}

function clearRoomHighlight() {
    clearAllHighlights();
}

function handleRoomHighlight(roomId) {
    if (_activeRoomId !== null && String(_activeRoomId) === String(roomId)) {
        clearAllHighlights();
    } else {
        highlightRoom(roomId);
    }
}

function highlightDeviceType(deviceType) {
    clearAllHighlights();
    _saveViewport();

    const inType  = cy.nodes(`[type="device"][deviceType="${deviceType}"]`);
    const outType = cy.nodes(`[type="device"]`).not(inType);

    outType.addClass('dimmed');
    inType.addClass('room-highlighted');
    cy.edges().forEach(e => {
        if (!inType.has(e.source()) && !inType.has(e.target())) e.addClass('dimmed');
    });

    if (inType.length) {
        cy.animate({ fit: { eles: inType, padding: 80 }, duration: 350, easing: 'ease-in-out-cubic' });
    }

    _activeDeviceType = deviceType;
    document.querySelectorAll('.legend-type-item[data-device-type]').forEach(el =>
        el.classList.toggle('legend-room-active', el.dataset.deviceType === deviceType)
    );
}

function handleDeviceTypeHighlight(deviceType) {
    if (_activeDeviceType === deviceType) {
        clearAllHighlights();
    } else {
        highlightDeviceType(deviceType);
    }
}

function highlightLinkType(linkType) {
    clearAllHighlights();
    _saveViewport();

    const matchEdges = cy.edges(`[linkType="${linkType}"]`);
    const otherEdges = cy.edges().not(matchEdges);
    const matchNodes = matchEdges.connectedNodes();
    const otherNodes = cy.nodes('[type="device"]').not(matchNodes);

    otherEdges.addClass('dimmed');
    otherNodes.addClass('dimmed');
    matchNodes.addClass('room-highlighted');

    if (matchEdges.length) {
        cy.animate({ fit: { eles: matchEdges.union(matchNodes), padding: 80 }, duration: 350, easing: 'ease-in-out-cubic' });
    }

    _activeLinkType = linkType;
    document.querySelectorAll('.legend-type-item[data-link-type]').forEach(el =>
        el.classList.toggle('legend-room-active', el.dataset.linkType === linkType)
    );
}

function handleLinkTypeHighlight(linkType) {
    if (_activeLinkType === linkType) {
        clearAllHighlights();
    } else {
        highlightLinkType(linkType);
    }
}

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
            clearAllHighlights();
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
    // Capture current positions from the live graph before destroying it.
    // This ensures nodes that were placed (dragged or staggered) don't lose
    // their position when the graph is rebuilt after a room change etc.
    if (cy) savePositions();
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

