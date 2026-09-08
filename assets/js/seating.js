/**
 * Sitzplan Parlamentssaal.
 *
 * Zeigt die 60 Ratssitze als Halbrund, erlaubt das Tauschen der Sitze per
 * Drag & Drop sowie Export/Import als JSON. Die Koordinaten stammen aus
 * `data/seating.json` (ursprünglich aus dem Sitzplan-PDF), die Partei-Farben
 * aus `data/party-meta.json`.
 */

import { fetchJson } from './paths.js';
import { loadPartyMeta, findParty, partiesInOrder, councilNote } from './parties.js';
import { escapeHtml } from './layout.js';

let config = null; // Inhalt von data/seating.json
let meta = null; // Inhalt von data/party-meta.json

let seatPositions = {}; // id → { px, py }
let seatOccupants = {}; // id → { name, party, isFp }
let initialOccupants = {}; // id → { name, party, isFp }
let dragSourceId = null;

/** Anteil der Bühnenhöhe, unterhalb dessen der Tooltip nach unten klappt. */
const TOOLTIP_BELOW_RATIO = 0.25;

/* ─── Koordinaten-Mapping ─────────────────────────────────────────────
   Hochformat-PDF → Anzeige:  dx = pdfHeight - py,  dy = px
   Anschliessend linear auf die virtuelle Bühne (stageWidth/Height) normiert. */
function toStage(px, py) {
  const m = config.coordinateMapping;
  const dx = m.pdfHeight - py;
  const dy = px;
  return {
    sx: ((dx - m.dxMin) / (m.dxMax - m.dxMin)) * m.stageWidth,
    sy: ((dy - m.dyMin) / (m.dyMax - m.dyMin)) * m.stageHeight,
  };
}

/* ─── SVG-Hintergrund ─────────────────────────────────────────────── */
function buildSvgBackground() {
  const m = config.coordinateMapping;
  const svg = document.getElementById('hemicycle-svg');
  svg.setAttribute('viewBox', `0 0 ${m.stageWidth} ${m.stageHeight}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const CX = ((380 - m.dxMin) / (m.dxMax - m.dxMin)) * m.stageWidth;
  const CY = -30; // virtueller Mittelpunkt oberhalb der Bühne

  const rings = [570, 530, 490, 450, 410, 370, 330];

  let svgHtml = `
    <defs>
      <linearGradient id="floorGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#f8f8f2"/>
        <stop offset="100%" stop-color="#ededde"/>
      </linearGradient>
    </defs>
    <rect width="${m.stageWidth}" height="${m.stageHeight}" fill="url(#floorGrad)" rx="4"/>
  `;

  for (const r of rings) {
    const startAngle = (205 * Math.PI) / 180;
    const endAngle = (335 * Math.PI) / 180;
    const x1 = CX + r * Math.cos(startAngle);
    const y1 = CY + r * Math.sin(startAngle);
    const x2 = CX + r * Math.cos(endAngle);
    const y2 = CY + r * Math.sin(endAngle);
    svgHtml += `<path d="M${x1},${y1} A${r},${r} 0 0,1 ${x2},${y2}"
                  fill="none" stroke="#d0d0c0" stroke-width="1" stroke-dasharray="4,6"/>`;
  }

  const podX = CX - 91;
  const podW = 240;
  const podY = 8;
  const podH = 30;
  svgHtml += `
    <rect x="${podX}" y="${podY}" width="${podW}" height="${podH}"
          rx="4" fill="#e8e8d8" stroke="#b0b0a0" stroke-width="1"/>
    <text x="${CX}" y="${podY + 19}" text-anchor="middle"
          font-size="11" fill="#888" font-family="Arial, sans-serif">Präsidium/Büro</text>
  `;

  svg.innerHTML = svgHtml;
}

/* ─── Zustand & Rendering ─────────────────────────────────────────── */
function initState() {
  seatPositions = {};
  seatOccupants = {};
  initialOccupants = {};
  for (const seat of config.seats) {
    seatPositions[seat.id] = { px: seat.px, py: seat.py };
    seatOccupants[seat.id] = { name: seat.name, party: seat.party, isFp: seat.isFp };
    initialOccupants[seat.id] = { name: seat.name, party: seat.party, isFp: seat.isFp };
  }
}

function colorFor(partyLabel) {
  const party = findParty(meta, partyLabel);
  return party ? party.color : '#666';
}

function abbrFor(partyLabel) {
  const party = findParty(meta, partyLabel);
  return party ? party.abbr : partyLabel;
}

function renderSeats() {
  const layer = document.getElementById('seats-layer');
  layer.innerHTML = '';

  for (const seat of config.frontSeats) {
    const { sx, sy } = toStage(seat.px, seat.py);
    const el = createSeatEl(seat.id, seat.name, seat.party, false, false, sx, sy);
    el.classList.add('static-seat');
    layer.appendChild(el);
  }

  for (const seat of config.seats) {
    const { sx, sy } = toStage(seat.px, seat.py);
    const occupant = seatOccupants[seat.id];
    const el = createSeatEl(seat.id, occupant.name, occupant.party, occupant.isFp, true, sx, sy);
    layer.appendChild(el);
  }
}

function createSeatEl(id, name, party, isFp, draggable, sx, sy) {
  const m = config.coordinateMapping;
  const el = document.createElement('div');
  el.className = 'seat' + (draggable ? ' draggable' : '');
  el.dataset.id = id;
  el.draggable = draggable;

  el.style.left = (sx / m.stageWidth) * 100 + '%';
  el.style.top = (sy / m.stageHeight) * 100 + '%';
  el.style.background = colorFor(party);

  // Sitze am oberen Bühnenrand bekommen den Tooltip unterhalb,
  // sonst würde er ausserhalb des Diagramms abgeschnitten.
  if (sy < m.stageHeight * TOOLTIP_BELOW_RATIO) el.classList.add('tip-below');

  el.innerHTML = `
    <span class="party-badge">${escapeHtml(abbrFor(party))}</span>
    ${isFp ? '<span class="faction-star">★</span>' : ''}
    <div class="seat-tooltip">${escapeHtml(name)}<br><em>${escapeHtml(party)}</em>${
      isFp ? ' · Fraktionspräs.' : ''
    }</div>
  `;

  if (draggable) {
    el.addEventListener('dragstart', onDragStart);
    el.addEventListener('dragend', onDragEnd);
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', onDrop);
  }

  return el;
}

/* ─── Drag & Drop ─────────────────────────────────────────────────── */
function onDragStart(e) {
  dragSourceId = e.currentTarget.dataset.id;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragSourceId);
  setStatus('Sitz wird verschoben …');
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.seat.drag-over').forEach((el) => el.classList.remove('drag-over'));
  dragSourceId = null;
}

function onDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const target = e.currentTarget;
  if (target.dataset.id !== dragSourceId && target.classList.contains('draggable')) {
    target.classList.add('drag-over');
  }
}

function onDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function onDrop(e) {
  e.preventDefault();
  const targetId = e.currentTarget.dataset.id;
  e.currentTarget.classList.remove('drag-over');

  if (!dragSourceId || dragSourceId === targetId) return;
  if (!seatOccupants[dragSourceId] || !seatOccupants[targetId]) return;

  const tmp = seatOccupants[dragSourceId];
  seatOccupants[dragSourceId] = seatOccupants[targetId];
  seatOccupants[targetId] = tmp;

  renderSeats();
  setStatus('Sitzplan aktualisiert.');
}

/* ─── Legende ─────────────────────────────────────────────────────── */
function buildLegend() {
  const legendEl = document.getElementById('legend');
  const items = partiesInOrder(meta)
    .map((party) => {
      const count = config.seats.filter((s) => findParty(meta, s.party)?.id === party.id).length;
      if (!count) return '';
      return `<div class="legend-item">
      <div class="legend-dot" style="background:${escapeHtml(party.color)}"></div>
      <span>${escapeHtml(party.abbr)} <span style="color:#999">(${count})</span></span>
    </div>`;
    })
    .join('');

  legendEl.innerHTML =
    items +
    `<div class="legend-item"><span style="color:#888">★ = Fraktionspräsident/in</span></div>`;
}

/** Hinweis zu Legislatur und Namens-Stichtag. */
function buildCouncilNote() {
  const el = document.getElementById('council-note');
  if (el) el.textContent = councilNote(meta);
}

/* ─── Toolbar ─────────────────────────────────────────────────────── */
function setStatus(msg, duration = 3000) {
  const el = document.getElementById('status-msg');
  el.textContent = msg;
  if (duration > 0) {
    setTimeout(() => {
      if (el.textContent === msg) el.textContent = '';
    }, duration);
  }
}

function bindToolbar() {
  document.getElementById('btn-reset').addEventListener('click', () => {
    for (const id of Object.keys(initialOccupants)) {
      seatOccupants[id] = { ...initialOccupants[id] };
    }
    renderSeats();
    setStatus('Sitzplan zurückgesetzt.');
  });

  document.getElementById('btn-export').addEventListener('click', () => {
    const data = config.seats.map((seat) => {
      const occupant = seatOccupants[seat.id];
      const position = seatPositions[seat.id];
      return {
        seatId: seat.id,
        occupant: occupant.name,
        party: occupant.party,
        positionPx: position.px,
        positionPy: position.py,
      };
    });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sitzplan_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus('JSON exportiert.');
  });

  document.getElementById('btn-import').addEventListener('click', () => {
    const input = document.getElementById('file-import');
    input.value = '';
    input.click();
  });

  document.getElementById('file-import').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!Array.isArray(data)) throw new Error('Array von Sitzplatz-Einträgen erwartet');
        let updated = 0;
        let skipped = 0;
        for (const entry of data) {
          if (
            !entry ||
            typeof entry.seatId !== 'string' ||
            typeof entry.occupant !== 'string' ||
            typeof entry.party !== 'string'
          ) {
            skipped++;
            continue;
          }
          if (!seatOccupants[entry.seatId]) {
            skipped++;
            continue;
          }
          const original = config.seats.find((s) => s.name === entry.occupant);
          seatOccupants[entry.seatId] = {
            name: entry.occupant,
            party: entry.party,
            isFp: original ? original.isFp : false,
          };
          updated++;
        }
        renderSeats();
        setStatus(
          `JSON importiert (${updated} Sitze aktualisiert${skipped ? ', ' + skipped + ' übersprungen' : ''}).`,
        );
      } catch (err) {
        setStatus('Fehler beim Import: ' + err.message);
      }
    };
    reader.readAsText(file);
  });
}

/* ─── Init ────────────────────────────────────────────────────────── */
async function init() {
  const statusEl = document.getElementById('seating-error');
  try {
    const [seating, partyMeta] = await Promise.all([
      fetchJson('data/seating.json'),
      loadPartyMeta(),
    ]);
    config = seating;
    meta = partyMeta;

    initState();
    buildSvgBackground();
    buildLegend();
    buildCouncilNote();
    renderSeats();
    bindToolbar();
  } catch (err) {
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = `Der Sitzplan konnte nicht geladen werden: ${err.message}`;
    }
  }
}

init();
