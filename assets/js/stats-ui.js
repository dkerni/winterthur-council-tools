/**
 * Statistik-Seite — Aufbau der Oberfläche.
 */

import { loadDatabase, dataErrorMessage, formatDateTime } from './data.js';
import { councilNote } from './parties.js';
import { computeStats, GENDER_LABELS } from './stats.js';
import { renderChart } from './charts.js';
import { escapeHtml } from './layout.js';

const MODES = [
  { id: 'total', label: 'Gesamt' },
  { id: 'party', label: 'Partei' },
  { id: 'fraction', label: 'Fraktion' },
];

const GENDER_COLORS = { m: '#4a6fa5', w: '#c1668b' };

/** Im Diagramm ausgewiesene Geschlechter — «divers» und «unbekannt» bleiben aussen vor. */
const GENDER_KEYS = ['m', 'w'];

/**
 * Baut die Statistik-Oberfläche in den Container.
 * @param {HTMLElement} container
 */
export async function createStatistics(container) {
  let db;
  try {
    db = await loadDatabase();
  } catch (err) {
    container.innerHTML = `<div class="notice error">${escapeHtml(dataErrorMessage(err))}</div>`;
    return;
  }

  let mode = 'total';
  container.innerHTML = skeleton();

  const modeButtons = [...container.querySelectorAll('[data-mode]')];
  const kpiHost = container.querySelector('#stats-kpi');
  const chartHost = container.querySelector('#stats-charts');
  const tableHost = container.querySelector('#stats-table');
  const noteHost = container.querySelector('#stats-note');

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      mode = button.dataset.mode;
      modeButtons.forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
      render();
    });
  });

  renderDataNote(noteHost, db);
  container.querySelector('#stats-council').textContent = councilNote(db.meta);

  function render() {
    const groupMode = mode === 'total' ? 'party' : mode;
    const stats = computeStats(db, groupMode);
    renderKpis(kpiHost, db, stats);
    renderTable(tableHost, stats, mode);
    renderCharts(chartHost, stats, mode);
  }

  render();
}

function skeleton() {
  return `
    <div class="toolbar">
      <div class="segmented" role="group" aria-label="Auswertung">
        ${MODES.map(
          (item) =>
            `<button type="button" data-mode="${item.id}" aria-pressed="${item.id === 'total'}">${item.label}</button>`,
        ).join('')}
      </div>
    </div>
    <p class="hint" id="stats-council"></p>
    <div id="stats-note"></div>
    <div class="kpi-grid" id="stats-kpi"></div>
    <div id="stats-table"></div>
    <div class="chart-grid" id="stats-charts"></div>`;
}

function renderDataNote(host, db) {
  host.innerHTML = db.generatedAt
    ? `<p class="hint stats-note">Datenstand: ${escapeHtml(formatDateTime(db.generatedAt))}.</p>`
    : '';
}

function renderKpis(host, db, stats) {
  const total = stats.total;
  const women = total.gender.counts.w;
  const share = total.count ? Math.round((women / total.count) * 100) : 0;

  const tiles = [
    { value: total.count, label: 'Mitglieder', note: `${db.parties.length} Parteien, ${db.fractions.length} Fraktionen` },
    {
      value: total.age.average != null ? `${total.age.average}` : '–',
      label: 'Ø Alter (Jahre)',
      note: total.age.known ? `Basis: ${total.age.known} Personen` : 'Keine Geburtsjahre erfasst',
    },
    {
      value: `${share}%`,
      label: 'Frauenanteil',
      note: `${women} von ${total.count}`,
    },
    {
      value: total.tenure.average != null ? `${total.tenure.average}` : '–',
      label: 'Ø Amtsdauer (Jahre)',
      note: total.tenure.known ? `Basis: ${total.tenure.known} Personen` : 'Keine Eintrittsdaten erfasst',
    },
    {
      value: total.districts.length || '–',
      label: 'Vertretene Stadtkreise',
      note: total.districtsKnown ? `Basis: ${total.districtsKnown} Personen` : 'Keine Stadtkreise erfasst',
    },
    {
      value: total.inquiries.total || '–',
      label: 'Erfasste Vorstösse',
      note: total.inquiries.total ? 'Summe über alle Mitglieder' : 'Noch nicht erfasst',
    },
  ];

  host.innerHTML = tiles
    .map(
      (tile) => `<div class="kpi">
        <div class="kpi-value">${escapeHtml(String(tile.value))}</div>
        <div class="kpi-label">${escapeHtml(tile.label)}</div>
        <div class="kpi-note">${escapeHtml(tile.note)}</div>
      </div>`,
    )
    .join('');
}

function renderTable(host, stats, mode) {
  if (mode === 'total') {
    host.innerHTML = '';
    return;
  }
  const label = mode === 'fraction' ? 'Fraktion' : 'Partei';
  const totalSeats = stats.groups.reduce((sum, entry) => sum + entry.group.seats, 0);

  const rows = stats.groups
    .map(({ group, stats: groupStats }) => {
      const women = groupStats.gender.counts.w;
      const womenShare = groupStats.count ? Math.round((women / groupStats.count) * 100) : 0;
      return `<tr>
        <td><span class="group-dot" style="background:${escapeHtml(group.color)}"></span> ${escapeHtml(
          group.shortName || group.name,
        )}</td>
        <td class="num">${group.seats}</td>
        <td class="num">${totalSeats ? Math.round((group.seats / totalSeats) * 100) : 0}%</td>
        <td class="num">${women} (${womenShare}%)</td>
        <td class="num">${groupStats.age.average ?? '–'}</td>
        <td class="num">${groupStats.tenure.average ?? '–'}</td>
      </tr>`;
    })
    .join('');

  host.innerHTML = `<div class="card">
      <h2>Kennzahlen je ${label}</h2>
      <div class="table-wrap">
        <table class="dist-table">
          <thead><tr>
            <th>${label}</th><th class="num">Sitze</th><th class="num">Anteil</th>
            <th class="num">Frauen</th><th class="num">Ø Alter</th><th class="num">Ø Amtsdauer</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function chartBox(title, subtitle) {
  return `<div class="chart-box">
      <h3>${escapeHtml(title)}</h3>
      <p class="chart-sub">${escapeHtml(subtitle)}</p>
      <div class="chart-canvas-wrap"></div>
    </div>`;
}

function renderCharts(host, stats, mode) {
  const groupLabel = stats.mode === 'fraction' ? 'Fraktion' : 'Partei';
  const groups = stats.groups;
  const labels = groups.map((entry) => entry.group.shortName || entry.group.name);
  const colors = groups.map((entry) => entry.group.color);

  const boxes = [
    { title: `Sitzverteilung nach ${groupLabel}`, sub: 'Anzahl Sitze im Rat', kind: 'seats' },
    { title: 'Geschlecht', sub: 'Verteilung im gesamten Rat', kind: 'gender' },
    { title: 'Altersverteilung', sub: 'Anzahl Mitglieder je Altersgruppe', kind: 'age' },
    { title: 'Amtsdauer', sub: 'Anzahl Mitglieder je Dauer seit erstem Eintritt', kind: 'tenure' },
  ];

  if (mode !== 'total') {
    boxes.push(
      { title: `Frauenanteil je ${groupLabel}`, sub: 'in Prozent der Sitze', kind: 'womenByGroup' },
      { title: `Ø Alter je ${groupLabel}`, sub: 'in Jahren', kind: 'ageByGroup' },
    );
  } else {
    boxes.push({ title: 'Stadtkreise', sub: 'Wohnort der Mitglieder', kind: 'districts' });
  }

  host.innerHTML = boxes.map((box) => chartBox(box.title, box.sub)).join('');
  const wraps = [...host.querySelectorAll('.chart-canvas-wrap')];

  const total = stats.total;
  const specs = {
    seats: { type: 'bar', labels, values: groups.map((entry) => entry.group.seats), colors, stepSize: 5 },
    gender: {
      type: 'doughnut',
      labels: GENDER_KEYS.map((key) => GENDER_LABELS[key] || key),
      values: GENDER_KEYS.map((key) => total.gender.counts[key] || 0),
      colors: GENDER_KEYS.map((key) => GENDER_COLORS[key]),
    },
    age: {
      type: 'bar',
      labels: total.age.histogram.map((bucket) => bucket.label),
      values: total.age.histogram.map((bucket) => bucket.count),
      colors: '#6b7f9e',
    },
    tenure: {
      type: 'bar',
      labels: total.tenure.histogram.map((bucket) => bucket.label),
      values: total.tenure.histogram.map((bucket) => bucket.count),
      colors: '#8a9a7b',
    },
    womenByGroup: {
      type: 'bar',
      labels,
      values: groups.map((entry) =>
        entry.stats.count ? Math.round((entry.stats.gender.counts.w / entry.stats.count) * 100) : 0,
      ),
      colors,
      unit: '%',
    },
    ageByGroup: {
      type: 'bar',
      labels,
      values: groups.map((entry) => entry.stats.age.average || 0),
      colors,
      unit: 'Jahre',
    },
    districts: {
      type: 'bar',
      labels: total.districts.map((entry) => entry.name),
      values: total.districts.map((entry) => entry.count),
      colors: '#9e8a6b',
    },
  };

  boxes.forEach((box, index) => {
    renderChart(wraps[index], specs[box.kind]);
  });
}
