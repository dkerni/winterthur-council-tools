/**
 * Bereich «Aktuelle Ratsstatistiken» der Statistik-Seite.
 *
 * Die Seite zeigt zuerst die Gesamtauswertung des Rats und darunter die
 * Auswertung je Fraktion; beide Blöcke werden gleichzeitig dargestellt.
 */

import { loadDatabase, dataErrorMessage, formatDateTime } from './data.js';
import { councilNote } from './parties.js';
import { computeStats, GENDER_LABELS } from './stats.js';
import { renderChart } from './charts.js';
import { escapeHtml } from './layout.js';

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

  container.innerHTML = skeleton();

  renderDataNote(container.querySelector('#stats-note'), db);
  container.querySelector('#stats-council').textContent = councilNote(db.meta);

  const stats = computeStats(db, 'fraction');
  renderKpis(container.querySelector('#stats-kpi'), db, stats);
  renderTotalCharts(container.querySelector('#stats-charts-total'), stats);
  renderFractionCharts(container.querySelector('#stats-charts-fraction'), stats);
}

function skeleton() {
  return `
    <p class="hint" id="stats-council"></p>
    <div id="stats-note"></div>
    <div class="kpi-grid" id="stats-kpi"></div>
    <section class="stats-section">
      <h2>Gesamt</h2>
      <div class="chart-grid" id="stats-charts-total"></div>
    </section>
    <section class="stats-section">
      <h2>Fraktion</h2>
      <div class="chart-grid" id="stats-charts-fraction"></div>
    </section>`;
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

function chartBox(title, subtitle) {
  return `<div class="chart-box">
      <h3>${escapeHtml(title)}</h3>
      <p class="chart-sub">${escapeHtml(subtitle)}</p>
      <div class="chart-canvas-wrap"></div>
    </div>`;
}

/** Rendert eine Reihe von Diagrammen in einen Container. */
function renderBoxes(host, boxes) {
  host.innerHTML = boxes.map((box) => chartBox(box.title, box.sub)).join('');
  const wraps = [...host.querySelectorAll('.chart-canvas-wrap')];
  boxes.forEach((box, index) => {
    renderChart(wraps[index], box.spec);
  });
}

/** Gesamtauswertung: Geschlecht, Alter, Amtsdauer, Stadtkreise. */
function renderTotalCharts(host, stats) {
  const total = stats.total;

  renderBoxes(host, [
    {
      title: 'Geschlecht (Frauenanteil)',
      sub: 'Verteilung im gesamten Rat',
      spec: {
        type: 'doughnut',
        labels: GENDER_KEYS.map((key) => GENDER_LABELS[key] || key),
        values: GENDER_KEYS.map((key) => total.gender.counts[key] || 0),
        colors: GENDER_KEYS.map((key) => GENDER_COLORS[key]),
      },
    },
    {
      title: 'Altersverteilung',
      sub: 'Anzahl Mitglieder je Altersgruppe',
      spec: {
        type: 'bar',
        labels: total.age.histogram.map((bucket) => bucket.label),
        values: total.age.histogram.map((bucket) => bucket.count),
        colors: '#6b7f9e',
      },
    },
    {
      title: 'Amtsdauer',
      sub: 'Anzahl Mitglieder je Dauer seit erstem Eintritt',
      spec: {
        type: 'bar',
        labels: total.tenure.histogram.map((bucket) => bucket.label),
        values: total.tenure.histogram.map((bucket) => bucket.count),
        colors: '#8a9a7b',
      },
    },
    {
      title: 'Stadtkreise',
      sub: 'Wohnort der Mitglieder',
      spec: {
        type: 'bar',
        labels: total.districts.map((entry) => entry.name),
        values: total.districts.map((entry) => entry.count),
        colors: '#9e8a6b',
      },
    },
  ]);
}

/** Auswertung je Fraktion: Sitze, Frauenanteil, Ø Alter, Ø Amtsdauer. */
function renderFractionCharts(host, stats) {
  const groups = stats.groups;
  const labels = groups.map((entry) => entry.group.shortName || entry.group.name);
  const colors = groups.map((entry) => entry.group.color);

  renderBoxes(host, [
    {
      title: 'Sitzverteilung',
      sub: 'Anzahl Sitze je Fraktion',
      spec: { type: 'bar', labels, values: groups.map((entry) => entry.group.seats), colors, stepSize: 5 },
    },
    {
      title: 'Geschlecht (Frauenanteil)',
      sub: 'in Prozent der Sitze je Fraktion',
      spec: {
        type: 'bar',
        labels,
        values: groups.map((entry) =>
          entry.stats.count ? Math.round((entry.stats.gender.counts.w / entry.stats.count) * 100) : 0,
        ),
        colors,
        unit: '%',
      },
    },
    {
      title: 'Altersverteilung',
      sub: 'Ø Alter je Fraktion in Jahren',
      spec: {
        type: 'bar',
        labels,
        values: groups.map((entry) => entry.stats.age.average || 0),
        colors,
        unit: 'Jahre',
      },
    },
    {
      title: 'Amtsdauer',
      sub: 'Ø Amtsdauer je Fraktion in Jahren',
      spec: {
        type: 'bar',
        labels,
        values: groups.map((entry) => entry.stats.tenure.average || 0),
        colors,
        unit: 'Jahre',
      },
    },
  ]);
}
