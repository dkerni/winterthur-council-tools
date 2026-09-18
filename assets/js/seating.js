/**
 * Sitzplan Parlamentssaal.
 *
 * Zeigt die 60 Ratssitze als Halbrund, erlaubt das Tauschen der Sitze per
 * Drag & Drop sowie Export/Import als JSON. Während eines Drags erscheint in der
 * Saalmitte ein "Pool", in dem Sitze temporär zwischengelagert werden können —
 * so lassen sich Umstellungen bauen, die über einen reinen Tausch hinausgehen.
 * Die vorderen Reihen (Präsidium/Büro und Stadtrat) werden als feste Sitze
 * dargestellt. Die Koordinaten stammen aus `data/seating.json` (ursprünglich aus
 * dem Sitzplan-PDF), die Partei-Farben aus `data/party-meta.json`.
 */

import { fetchJson } from './paths.js';
import { loadPartyMeta, findParty, partiesInOrder, councilNote } from './parties.js';
import { escapeHtml } from './layout.js';

let config = null; // Inhalt von data/seating.json
let meta = null; // Inhalt von data/party-meta.json

let seatPositions = {}; // id → { px, py }
let seatOccupants = {}; // id → { name, party, isFp } | null (freier Sitz)
let initialOccupants = {}; // id → { name, party, isFp }
let poolOccupants = []; // zwischengelagerte Personen (Reihenfolge = Anzeige)

/** Aktive Drag-Quelle: { type: 'seat', id } | { type: 'pool', index } | null. */
let dragSource = null;
/** Zähler für dragenter/dragleave am Pool (Kind-Elemente lösen sonst Flackern aus). */
let poolDragDepth = 0;

/** Anteil der Bühnenhöhe, unterhalb dessen der Tooltip nach unten klappt. */
const TOOLTIP_BELOW_RATIO = 0.25;

/**
 * Touch-Geräte: HTML5-Drag-&-Drop funktioniert dort nicht zuverlässig und
 * blockiert zudem das Scrollen. Der Sitzplan wird deshalb nur angezeigt.
 */
const TOUCH_QUERY = window.matchMedia('(hover: none) and (pointer: coarse)');

function dragEnabled() {
  return !TOUCH_QUERY.matches;
}

/** Pseudo-Sitz-ID, unter der Pool-Einträge exportiert/importiert werden. */
const POOL_ENTRY_ID = 'pool';

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
/** Pult des Präsidiums/Büros: umschliesst die Präsidiumssitze (Fallback: fixe Box). */
function podGeometry() {
  const m = config.coordinateMapping;
  const points = (config.presidiumSeats || []).map((seat) => toStage(seat.px, seat.py));
  if (points.length < 2) {
    const width = m.stageWidth * 0.24;
    return { x: (m.stageWidth - width) / 2, y: 8, width, height: 30 };
  }

  // Halber Pultabstand als seitlicher Rand, damit die Box wie im PDF
  // an den äusseren Pultkanten endet.
  const padX = Math.abs(points[1].sx - points[0].sx) / 2;
  const padY = 24; // halbe Sitzhöhe plus etwas Luft
  const left = Math.min(...points.map((p) => p.sx)) - padX;
  const right = Math.max(...points.map((p) => p.sx)) + padX;
  const top = Math.max(0, Math.min(...points.map((p) => p.sy)) - padY);
  const bottom = Math.max(...points.map((p) => p.sy)) + padY;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function buildSvgBackground() {
  const m = config.coordinateMapping;
  const svg = document.getElementById('hemicycle-svg');
  svg.setAttribute('viewBox', `0 0 ${m.stageWidth} ${m.stageHeight}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // Symmetrieachse des Saals: Mittelgang, Präsidium und Ringe liegen exakt mittig.
  const CX = m.stageWidth / 2;
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

  const pod = podGeometry();
  svgHtml += `
    <rect x="${pod.x}" y="${pod.y}" width="${pod.width}" height="${pod.height}"
          rx="4" fill="#e8e8d8" stroke="#b0b0a0" stroke-width="1"/>
  `;

  svg.innerHTML = svgHtml;
}

/* ─── Zustand & Rendering ─────────────────────────────────────────── */
function initState() {
  seatPositions = {};
  seatOccupants = {};
  initialOccupants = {};
  poolOccupants = [];
  for (const seat of config.seats) {
    seatPositions[seat.id] = { px: seat.px, py: seat.py };
    seatOccupants[seat.id] = { name: seat.name, party: seat.party, isFp: seat.isFp };
    initialOccupants[seat.id] = { name: seat.name, party: seat.party, isFp: seat.isFp };
  }
}

function colorFor(partyLabel) {
  const party = findParty(meta, partyLabel);
  return party ? party.color : 'rgb(102 102 102 / 0.5)';
}

function abbrFor(partyLabel) {
  const party = findParty(meta, partyLabel);
  return party ? party.abbr : partyLabel;
}

function renderSeats() {
  const layer = document.getElementById('seats-layer');
  layer.innerHTML = '';

  for (const seat of config.presidiumSeats || []) {
    const { sx, sy } = toStage(seat.px, seat.py);
    const el = createSeatEl(seat.id, seat.name, seat.party, false, false, sx, sy, {
      role: seat.role,
      badge: seat.party ? null : seat.roleAbbr,
    });
    el.classList.add('static-seat');
    layer.appendChild(el);
  }

  for (const seat of config.frontSeats) {
    const { sx, sy } = toStage(seat.px, seat.py);
    const el = createSeatEl(seat.id, seat.name, seat.party, false, false, sx, sy);
    el.classList.add('static-seat');
    layer.appendChild(el);
  }

  for (const seat of config.seats) {
    const { sx, sy } = toStage(seat.px, seat.py);
    const occupant = seatOccupants[seat.id];
    const el = occupant
      ? createSeatEl(seat.id, occupant.name, occupant.party, occupant.isFp, true, sx, sy, {
          dropTarget: true,
        })
      : createSeatEl(seat.id, '', null, false, false, sx, sy, { dropTarget: true, empty: true });
    layer.appendChild(el);
  }
}

/** Sitze und Pool gemeinsam neu zeichnen. */
function renderAll() {
  renderSeats();
  renderPool();
}

function createSeatEl(
  id,
  name,
  party,
  isFp,
  draggable,
  sx,
  sy,
  { role = '', badge = null, empty = false, dropTarget = false } = {},
) {
  const m = config.coordinateMapping;
  const canDrag = draggable && dragEnabled();
  const el = document.createElement('div');
  el.className = 'seat' + (canDrag ? ' draggable' : '') + (empty ? ' empty-seat' : '');
  el.dataset.id = id;
  el.draggable = canDrag;

  el.style.left = (sx / m.stageWidth) * 100 + '%';
  el.style.top = (sy / m.stageHeight) * 100 + '%';
  el.style.background = empty ? 'transparent' : colorFor(party);

  // Sitze am oberen Bühnenrand bekommen den Tooltip unterhalb,
  // sonst würde er ausserhalb des Diagramms abgeschnitten.
  if (sy < m.stageHeight * TOOLTIP_BELOW_RATIO) el.classList.add('tip-below');

  if (empty) {
    el.innerHTML = `<span class="party-badge empty-badge">frei</span>`;
  } else {
    const badgeLabel = badge || abbrFor(party);
    const subtitle = [role, party].filter(Boolean).join(' · ');

    el.innerHTML = `
      <span class="party-badge">${escapeHtml(badgeLabel)}</span>
      ${isFp ? '<span class="faction-star">★</span>' : ''}
      <div class="seat-tooltip">${escapeHtml(name)}<br><em>${escapeHtml(subtitle)}</em>${
        isFp ? ' · Fraktionspräs.' : ''
      }</div>
    `;
  }

  if (canDrag) {
    el.addEventListener('dragstart', onSeatDragStart);
    el.addEventListener('dragend', onDragEnd);
  }

  if (dropTarget && dragEnabled()) {
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', onDrop);
  }

  return el;
}

/* ─── Pool (temporäre Ablage in der Saalmitte) ────────────────────── */
function renderPool() {
  const itemsEl = document.getElementById('pool-items');
  const hintEl = document.getElementById('pool-hint');
  if (!itemsEl) return;

  itemsEl.innerHTML = '';
  const canDrag = dragEnabled();
  poolOccupants.forEach((occupant, index) => {
    const el = document.createElement('div');
    el.className = 'pool-seat';
    el.draggable = canDrag;
    el.dataset.index = String(index);
    el.style.background = colorFor(occupant.party);
    el.innerHTML = `
      <span class="party-badge">${escapeHtml(abbrFor(occupant.party))}</span>
      ${occupant.isFp ? '<span class="faction-star">★</span>' : ''}
      <div class="seat-tooltip">${escapeHtml(occupant.name)}<br><em>${escapeHtml(
        occupant.party || '',
      )}</em>${occupant.isFp ? ' · Fraktionspräs.' : ''}</div>
    `;
    if (canDrag) {
      el.addEventListener('dragstart', onPoolDragStart);
      el.addEventListener('dragend', onDragEnd);
    }
    itemsEl.appendChild(el);
  });

  if (hintEl) {
    hintEl.textContent = poolOccupants.length
      ? `${poolOccupants.length} ${poolOccupants.length === 1 ? 'Person' : 'Personen'} zwischengelagert`
      : 'Sitz hier ablegen';
  }
  updatePoolVisibility();
}

/** Pool einblenden, solange gezogen wird oder noch Einträge darin liegen. */
function updatePoolVisibility() {
  const pool = document.getElementById('seat-pool');
  if (!pool) return;
  pool.classList.toggle('visible', Boolean(dragSource) || poolOccupants.length > 0);
  pool.classList.toggle('has-items', poolOccupants.length > 0);
}

/* Die Pool-Listener bleiben ohne aktive Drag-Quelle wirkungslos — auf
   Touch-Geräten wird nie ein Drag gestartet (siehe `dragEnabled`). */
function bindPool() {
  const pool = document.getElementById('seat-pool');
  if (!pool) return;

  pool.addEventListener('dragenter', (e) => {
    if (!isPoolDropAllowed()) return;
    e.preventDefault();
    poolDragDepth++;
    pool.classList.add('drag-over');
  });

  pool.addEventListener('dragover', (e) => {
    if (!isPoolDropAllowed()) {
      e.dataTransfer.dropEffect = 'none';
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  });

  pool.addEventListener('dragleave', () => {
    poolDragDepth = Math.max(0, poolDragDepth - 1);
    if (poolDragDepth === 0) pool.classList.remove('drag-over');
  });

  pool.addEventListener('drop', onPoolDrop);
}

/** Nur besetzte Sitze dürfen in den Pool — Pool→Pool wäre ein No-Op. */
function isPoolDropAllowed() {
  return Boolean(dragSource) && dragSource.type === 'seat' && Boolean(seatOccupants[dragSource.id]);
}

/** Echte Ratssitz-ID? (`in` würde auch Prototyp-Keys wie "constructor" treffen.) */
function isSeatId(id) {
  return Object.prototype.hasOwnProperty.call(seatOccupants, id);
}

/* ─── Drag & Drop ─────────────────────────────────────────────────── */
function onSeatDragStart(e) {
  const id = e.currentTarget.dataset.id;
  dragSource = { type: 'seat', id };
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', id);
  updatePoolVisibility();
  setStatus('Sitz wird verschoben — Ablage im Pool möglich …');
}

function onPoolDragStart(e) {
  const index = Number(e.currentTarget.dataset.index);
  dragSource = { type: 'pool', index };
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', `pool:${index}`);
  updatePoolVisibility();
  setStatus('Person aus dem Pool auf einen Sitz ziehen …');
}

function onDragEnd() {
  finishDrag();
}

/** Drag-Zustand und alle visuellen Hervorhebungen zurücksetzen. */
function finishDrag() {
  dragSource = null;
  poolDragDepth = 0;
  document
    .querySelectorAll('.drag-over, .dragging')
    .forEach((el) => el.classList.remove('drag-over', 'dragging'));
  updatePoolVisibility();
}

function onDragOver(e) {
  if (!dragSource) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const target = e.currentTarget;
  const isSelf = dragSource.type === 'seat' && target.dataset.id === dragSource.id;
  if (!isSelf) target.classList.add('drag-over');
}

function onDragLeave(e) {
  e.currentTarget.classList.remove('drag-over');
}

function onDrop(e) {
  e.preventDefault();
  const targetId = e.currentTarget.dataset.id;
  e.currentTarget.classList.remove('drag-over');

  const source = dragSource;
  finishDrag();
  if (!source || !isSeatId(targetId)) return;

  if (source.type === 'seat') {
    if (source.id === targetId || !isSeatId(source.id)) return;
    const tmp = seatOccupants[source.id];
    seatOccupants[source.id] = seatOccupants[targetId];
    seatOccupants[targetId] = tmp;
    renderAll();
    setStatus('Sitzplan aktualisiert.');
    return;
  }

  const occupant = poolOccupants[source.index];
  if (!occupant) return;
  const previous = seatOccupants[targetId];
  // Besetzter Zielsitz: die bisherige Person wandert an die Pool-Stelle zurück.
  if (previous) poolOccupants[source.index] = previous;
  else poolOccupants.splice(source.index, 1);
  seatOccupants[targetId] = occupant;
  renderAll();
  setStatus(
    previous
      ? `${occupant.name} ↔ ${previous.name} getauscht (Pool).`
      : `${occupant.name} platziert.`,
  );
}

function onPoolDrop(e) {
  e.preventDefault();
  const source = dragSource;
  finishDrag();
  if (!source || source.type !== 'seat') return;

  const occupant = seatOccupants[source.id];
  if (!occupant) return;
  poolOccupants.push(occupant);
  seatOccupants[source.id] = null;
  renderAll();
  setStatus(`${occupant.name} in den Pool gelegt.`);
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

/** Hinweis einblenden, solange Drag & Drop (Touch-Gerät) nicht verfügbar ist. */
function updateTouchNote() {
  const el = document.getElementById('seating-touch-note');
  if (el) el.hidden = dragEnabled();
  document.body.classList.toggle('seating-no-drag', !dragEnabled());
}

/** Wechselt der Eingabemodus (z. B. Geräte-Emulation), neu aufbauen. */
function bindPointerModeWatcher() {
  const onChange = () => {
    updateTouchNote();
    renderAll();
  };
  if (typeof TOUCH_QUERY.addEventListener === 'function') TOUCH_QUERY.addEventListener('change', onChange);
  else if (typeof TOUCH_QUERY.addListener === 'function') TOUCH_QUERY.addListener(onChange);
}

/* ─── Toolbar ─────────────────────────────────────────────────────── */
/** Import-Eintrag → Belegung; `isFp` stammt weiterhin aus der Basisdatenbank. */
function occupantFromEntry(entry) {
  const original = config.seats.find((s) => s.name === entry.occupant);
  return {
    name: entry.occupant,
    party: entry.party,
    isFp: original ? original.isFp : false,
  };
}

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
    poolOccupants = [];
    renderAll();
    setStatus('Sitzplan zurückgesetzt.');
  });

  document.getElementById('btn-export').addEventListener('click', () => {
    const data = config.seats.map((seat) => {
      const occupant = seatOccupants[seat.id];
      const position = seatPositions[seat.id];
      return {
        seatId: seat.id,
        occupant: occupant ? occupant.name : '',
        party: occupant ? occupant.party : '',
        positionPx: position.px,
        positionPy: position.py,
      };
    });
    // Pool-Einträge mitexportieren, damit beim Re-Import nichts verloren geht.
    for (const occupant of poolOccupants) {
      data.push({ seatId: POOL_ENTRY_ID, occupant: occupant.name, party: occupant.party });
    }
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
        const importedPool = [];
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
          if (entry.seatId === POOL_ENTRY_ID) {
            if (!entry.occupant) {
              skipped++;
              continue;
            }
            importedPool.push(occupantFromEntry(entry));
            updated++;
            continue;
          }
          if (!isSeatId(entry.seatId)) {
            skipped++;
            continue;
          }
          seatOccupants[entry.seatId] = entry.occupant ? occupantFromEntry(entry) : null;
          updated++;
        }
        poolOccupants = importedPool;
        renderAll();
        setStatus(
          `JSON importiert (${updated} Einträge übernommen${skipped ? ', ' + skipped + ' übersprungen' : ''}).`,
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
    updateTouchNote();
    renderAll();
    bindPool();
    bindPointerModeWatcher();
    bindToolbar();
  } catch (err) {
    if (statusEl) {
      statusEl.hidden = false;
      statusEl.textContent = `Der Sitzplan konnte nicht geladen werden: ${err.message}`;
    }
  }
}

init();
