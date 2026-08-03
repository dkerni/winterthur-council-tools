/**
 * Statistik-Seite — Aufbau der Oberfläche.
 */

import { loadDatabase, dataErrorMessage, formatDateTime } from './data.js';
import { councilNote } from './parties.js';
import { computeStats, statsRows, GENDER_LABELS } from './stats.js';
import { renderChart } from './charts.js';
import { toCsv, downloadCsv, datedFilename } from './csv.js';
import { escapeHtml } from './layout.js';

const MODES = [
  { id: 'total', label: 'Gesamt' },
  { id: 'party', label: 'Partei' },
  { id: 'fraction', label: 'Fraktion' },
];

const GENDER_COLORS = { m: '#4a6fa5', w: '#c1668b', d: '#7aa06a', unbekannt: '#bdbdb5' };

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
  const extremeHost = container.querySelector('#stats-extremes');
  const noteHost = container.querySelector('#stats-note');

  modeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      mode = button.dataset.mode;
      modeButtons.forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
      render();
    });
  });

  container.querySelector('#stats-csv').addEventListener('click', () => {
    downloadCsv(datedFilename('stadtparlament_winterthur_mitglieder'), toCsv(statsRows(db)));
  });

  renderQualityNote(noteHost, db);
  container.querySelector('#stats-council').textContent = councilNote(db.meta);

  function render() {
    const groupMode = mode === 'total' ? 'party' : mode;
    const stats = computeStats(db, groupMode);
    renderKpis(kpiHost, db, stats);
    renderExtremes(extremeHost, stats);
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
      <button type="button" class="btn" id="stats-csv">Rohdaten als CSV</button>
    </div>
    <p class="hint" id="stats-council"></p>
    <div id="stats-note"></div>
    <div class="kpi-grid" id="stats-kpi"></div>
    <div id="stats-extremes"></div>
    <div id="stats-table"></div>
    <div class="chart-grid" id="stats-charts"></div>`;
}

function renderQualityNote(host, db) {
  const missing = {
    Geburtsjahr: db.members.filter((member) => !member.birthYear).length,
    Beruf: db.members.filter((member) => !member.profession).length,
    Stadtkreis: db.members.filter((member) => !member.district).length,
    Eintrittsdatum: db.members.filter((member) => !member.firstEntryDate && !member.currentMandateStart).length,
  };
  const gaps = Object.entries(missing).filter(([, count]) => count > 0);
  const guessed = db.members.filter((member) => member.genderSource === 'heuristik').length;
  const unknownGender = db.members.filter((member) => !['m', 'w', 'd'].includes(member.gender)).length;

  const parts = [];
  if (gaps.length) {
    parts.push(
      `Unvollständige Felder: ${gaps.map(([field, count]) => `${field} (${count} von ${db.members.length})`).join(', ')}.`,
    );
  }
  parts.push(
    `Das Geschlecht wird nicht offiziell publiziert. Es stammt aus einer manuell gepflegten Liste; ` +
      `${unknownGender} Person(en) sind als «unbekannt» erfasst${guessen(guessed)}. Korrekturhinweise sind willkommen.`,
  );

  host.innerHTML = `<div class="notice stats-note">${parts.join(' ')}${
    db.generatedAt ? ` <span class="hint">Datenstand: ${escapeHtml(formatDateTime(db.generatedAt))}.</span>` : ''
  }</div>`;
}

function guessen(count) {
  return count ? `, ${count} wurden heuristisch bestimmt` : '';
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
      note: `${women} von ${total.count}; ${total.gender.counts.unbekannt} unbekannt`,
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
      note: total.inquiries.first ? `davon ${total.inquiries.first} erstunterzeichnet` : 'Noch nicht erfasst',
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

function memberName(member) {
  return `${member.firstName} ${member.lastName}`.trim();
}

function renderExtremes(host, stats) {
  const { age, tenure } = stats.total;
  const items = [];
  if (age.youngest && age.oldest) {
    items.push(
      `Jüngstes Mitglied: <strong>${escapeHtml(memberName(age.youngest))}</strong> (${
        new Date().getFullYear() - age.youngest.birthYear
      } Jahre)`,
      `Ältestes Mitglied: <strong>${escapeHtml(memberName(age.oldest))}</strong> (${
        new Date().getFullYear() - age.oldest.birthYear
      } Jahre)`,
    );
  }
  if (tenure.longest.length) {
    items.push(
      `Längste Amtsdauer: ${tenure.longest
        .slice(0, 3)
        .map((member) => `<strong>${escapeHtml(memberName(member))}</strong>`)
        .join(', ')}`,
    );
  }
  host.innerHTML = items.length
    ? `<div class="card"><h2>Auffälligkeiten</h2><ul class="fact-list">${items
        .map((item) => `<li>${item}</li>`)
        .join('')}</ul></div>`
    : '';
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
      <p class="subtitle">Ø-Werte in Jahren; «–» bedeutet, dass die Grunddaten fehlen.</p>
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
    boxes.push(
      { title: 'Stadtkreise', sub: 'Wohnort der Mitglieder', kind: 'districts' },
      { title: 'Häufigste Berufe', sub: 'Top 10 nach Nennungen', kind: 'professions' },
    );
  }

  host.innerHTML = boxes.map((box) => chartBox(box.title, box.sub)).join('');
  const wraps = [...host.querySelectorAll('.chart-canvas-wrap')];

  const total = stats.total;
  const specs = {
    seats: { type: 'bar', labels, values: groups.map((entry) => entry.group.seats), colors, stepSize: 5 },
    gender: {
      type: 'doughnut',
      labels: Object.keys(total.gender.counts).map((key) => GENDER_LABELS[key]),
      values: Object.values(total.gender.counts),
      colors: Object.keys(total.gender.counts).map((key) => GENDER_COLORS[key]),
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
    professions: {
      type: 'bar',
      horizontal: true,
      labels: total.professions.slice(0, 10).map((entry) => entry.name),
      values: total.professions.slice(0, 10).map((entry) => entry.count),
      colors: '#7b8a9a',
    },
  };

  boxes.forEach((box, index) => {
    renderChart(wraps[index], specs[box.kind]);
  });
}
