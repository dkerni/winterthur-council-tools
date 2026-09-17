/**
 * Seite «Vorstösse» — Aufbau der Oberfläche.
 *
 * Grundlage ist `data/inquiry-facts.json`: eine kompakte Zeile je Geschäft mit
 * Jahr, Geschäftsart, Beschluss und den verfassenden Personen samt Partei.
 * Damit lassen sich Zeitraum, Zählweise und Darstellung ohne weitere Abrufe
 * umschalten.
 *
 * Alle Auswertungen sind **nach Partei** gruppiert, nicht nach Fraktion.
 */

import { fetchJson } from './paths.js';
import { escapeHtml } from './layout.js';
import { formatDateTime } from './data.js';
import { renderChart, renderSeriesChart } from './charts.js';
import {
  FIRST_AUTHOR_YEAR,
  FIRST_OUTCOME_YEAR,
  FIRST_SEAT_YEAR,
  businessByYear,
  coSignerMatrix,
  countByType,
  durationByParty,
  inPeriod,
  instrumentMix,
  motionsOnly,
  outcomeByParty,
  partyByYear,
  partyPerSeat,
  partyTotals,
  qualitySummary,
  topPeople,
  toShares,
  typesByYear,
} from './inquiry-stats.js';

const FACTS_FILE = 'data/inquiry-facts.json';

/** Bedienzustand der Seite. */
const state = {
  facts: null,
  period: 'alle',
  mode: 'first',
  display: 'absolut',
};

/**
 * Baut die Oberfläche in den Container.
 * @param {HTMLElement} container
 */
export async function createInquiryStatistics(container) {
  try {
    state.facts = await fetchJson(FACTS_FILE);
  } catch (err) {
    container.innerHTML = `<div class="notice error">Die Auswertungsdaten konnten nicht geladen werden (${escapeHtml(
      err.message,
    )}). Bitte später erneut versuchen.</div>`;
    return;
  }

  container.innerHTML = skeleton(state.facts);
  bindControls(container);
  render(container);
}

/* ─── Zeiträume ────────────────────────────────────────────────────── */

/** Letztes Jahr mit Daten. */
function lastYear(facts) {
  return facts.coverage?.length ? facts.coverage[facts.coverage.length - 1].year : new Date().getFullYear();
}

/**
 * Beginn der aktuellen Legislatur. Die Amtsdauer beträgt vier Jahre ab 2002;
 * ein eben erst begonnener Abschnitt mit kaum Daten wird übersprungen.
 */
function legislatureStart(facts) {
  const end = lastYear(facts);
  let start = FIRST_AUTHOR_YEAR + Math.floor((end - FIRST_AUTHOR_YEAR) / 4) * 4;
  const motions = motionsOnly(inPeriod(facts.inquiries, { from: start, to: end }), facts.motionTypeIds);
  if (motions.length < 50 && start - 4 >= FIRST_AUTHOR_YEAR) start -= 4;
  return start;
}

/** Zeitfenster gemäss Auswahl. */
function periodRange(facts, period) {
  const end = lastYear(facts);
  if (period === 'jahrzehnt') return { from: end - 9, to: end };
  if (period === 'legislatur') return { from: legislatureStart(facts), to: end };
  return { from: FIRST_AUTHOR_YEAR, to: end };
}

/* ─── Gerüst und Bedienelemente ────────────────────────────────────── */

function segmented(name, label, options) {
  const buttons = options
    .map(
      (option) =>
        `<button type="button" role="radio" data-control="${name}" data-value="${option.value}" aria-checked="${
          option.active ? 'true' : 'false'
        }">${escapeHtml(option.label)}</button>`,
    )
    .join('');
  return `<div class="control-group">
      <span class="control-label" id="label-${name}">${escapeHtml(label)}</span>
      <div class="segmented" role="radiogroup" aria-labelledby="label-${name}">${buttons}</div>
    </div>`;
}

function skeleton(facts) {
  const end = lastYear(facts);
  const legislature = legislatureStart(facts);

  return `
    <div class="controls" id="vorstoesse-controls">
      ${segmented('period', 'Zeitraum', [
        { value: 'alle', label: `Ab ${FIRST_AUTHOR_YEAR}`, active: true },
        { value: 'jahrzehnt', label: `Letzte 10 Jahre` },
        { value: 'legislatur', label: `Ab ${legislature}` },
      ])}
      ${segmented('mode', 'Zählweise', [
        { value: 'first', label: 'Erstunterzeichnung', active: true },
        { value: 'all', label: 'Alle Unterzeichnenden' },
      ])}
      ${segmented('display', 'Darstellung', [
        { value: 'absolut', label: 'Absolut', active: true },
        { value: 'anteil', label: 'Anteil' },
      ])}
    </div>
    <p class="hint" id="vorstoesse-note"></p>
    <div class="kpi-grid" id="vorstoesse-kpi"></div>

    <section class="stats-section">
      <h2>Überblick</h2>
      <div class="chart-grid" id="vorstoesse-overview"></div>
    </section>

    <section class="stats-section">
      <h2>Parteien</h2>
      <div class="chart-grid" id="vorstoesse-parties"></div>
    </section>

    <section class="stats-section">
      <h2>Mitunterzeichnungen zwischen den Parteien</h2>
      <p class="chart-sub">Zeile: Partei der Erstunterzeichnung. Spalte: Partei der Mitunterzeichnenden.
        Die Werte sind Anteile je Zeile; die Diagonale zeigt die Unterstützung aus der eigenen Partei.</p>
      <div id="vorstoesse-matrix"></div>
    </section>

    <section class="stats-section">
      <h2>Aktivste Ratsmitglieder</h2>
      <div id="vorstoesse-people"></div>
    </section>

    <section class="stats-section">
      <h2>Datengrundlage</h2>
      <div id="vorstoesse-quality"></div>
    </section>
    <p class="hint" id="vorstoesse-stamp"></p>`;
}

function bindControls(container) {
  container.querySelector('#vorstoesse-controls').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-control]');
    if (!button) return;

    const { control, value } = button.dataset;
    if (state[control] === value) return;
    state[control] = value;

    for (const sibling of button.parentElement.querySelectorAll('button')) {
      sibling.setAttribute('aria-checked', String(sibling === button));
    }
    render(container);
  });
}

/* ─── Darstellung ──────────────────────────────────────────────────── */

const numberFormat = new Intl.NumberFormat('de-CH');
const fmt = (value) => numberFormat.format(value);

function chartBox(title, subtitle) {
  return `<div class="chart-box">
      <h3>${escapeHtml(title)}</h3>
      <p class="chart-sub">${escapeHtml(subtitle)}</p>
      <div class="chart-canvas-wrap"></div>
    </div>`;
}

/** Rendert eine Reihe von Diagrammen; `spec.series` wählt die Mehrfachdarstellung. */
function renderBoxes(host, boxes) {
  host.innerHTML = boxes.map((box) => chartBox(box.title, box.sub)).join('');
  const wraps = [...host.querySelectorAll('.chart-canvas-wrap')];
  boxes.forEach((box, index) => {
    if (box.spec.series) renderSeriesChart(wraps[index], box.spec);
    else renderChart(wraps[index], box.spec);
  });
}

/** Wandelt Reihen bei Bedarf in Anteile und liefert die passende Einheit. */
function shaped(series, force = false) {
  const asShare = force || state.display === 'anteil';
  return {
    series: asShare ? toShares(series) : series,
    unit: asShare ? '%' : '',
    max: asShare ? 100 : undefined,
  };
}

function render(container) {
  const facts = state.facts;
  const { from, to } = periodRange(facts, state.period);
  const window = inPeriod(facts.inquiries, { from, to });
  const motions = motionsOnly(window, facts.motionTypeIds);
  const options = { parties: facts.parties, types: facts.types, mode: state.mode };

  renderNote(container.querySelector('#vorstoesse-note'), from, to);
  renderKpis(container.querySelector('#vorstoesse-kpi'), { facts, window, motions, from, to });
  renderOverview(container.querySelector('#vorstoesse-overview'), { facts, window, motions });
  renderParties(container.querySelector('#vorstoesse-parties'), { facts, motions, options, from, to });
  renderMatrix(container.querySelector('#vorstoesse-matrix'), motions, facts.parties);
  renderPeople(container.querySelector('#vorstoesse-people'), motions, facts);
  renderQuality(container.querySelector('#vorstoesse-quality'), facts, { from, to });

  const stamp = container.querySelector('#vorstoesse-stamp');
  stamp.textContent = facts.generatedAt ? `Datenstand: ${formatDateTime(facts.generatedAt)}.` : '';
}

function renderNote(host, from, to) {
  const mode =
    state.mode === 'first'
      ? 'Gezählt wird die erstunterzeichnende Person je Vorstoss.'
      : 'Gezählt wird jede beteiligte Partei je Vorstoss einmal.';
  host.textContent = `Zeitraum ${from}–${to}. ${mode}`;
}

function renderKpis(host, { facts, window, motions, from, to }) {
  const years = Math.max(to - from + 1, 1);
  const withParty = motions.filter((fact) => (state.mode === 'first' ? fact.p : (fact.a ?? []).some((a) => a[1])));
  const totals = partyTotals(motions, { parties: facts.parties, mode: state.mode });
  const leader = totals.slice().sort((a, b) => b.count - a.count)[0];

  const tiles = [
    { value: fmt(window.length), label: 'Geschäfte im Zeitraum', note: `${from}–${to}` },
    { value: fmt(motions.length), label: 'Vorstösse', note: `${facts.motionTypeIds.length} Geschäftsarten` },
    { value: fmt(Math.round(motions.length / years)), label: 'Vorstösse pro Jahr', note: `Mittel über ${years} Jahre` },
    {
      value: `${motions.length ? Math.round((withParty.length / motions.length) * 100) : 0}%`,
      label: 'Mit Parteizuordnung',
      note: `${fmt(withParty.length)} von ${fmt(motions.length)}`,
    },
    {
      value: leader ? leader.label : '–',
      label: 'Meiste Vorstösse',
      note: leader ? `${fmt(leader.count)} Vorstösse` : 'Keine Zuordnung',
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

function renderOverview(host, { facts, window, motions }) {
  const business = businessByYear(window, facts.motionTypeIds);
  const types = countByType(motions, facts.types);
  const timeline = typesByYear(motions, facts.types);

  const businessShaped = shaped(business.series);
  const timelineShaped = shaped(timeline.series);

  renderBoxes(host, [
    {
      title: 'Geschäfte pro Jahr',
      sub: 'Vorstösse gegenüber Verwaltungsgeschäften',
      spec: { labels: business.years, ...businessShaped, stacked: true },
    },
    {
      title: 'Vorstossarten gesamt',
      sub: 'Anzahl über den ganzen Zeitraum',
      spec: {
        type: 'bar',
        horizontal: true,
        labels: types.map((entry) => entry.label),
        values: types.map((entry) => entry.count),
        colors: '#2f5d8a',
      },
    },
    {
      title: 'Vorstossarten im Zeitverlauf',
      sub: 'Verschiebung der genutzten Instrumente',
      spec: { labels: timeline.years, ...timelineShaped, stacked: true },
    },
  ]);
}

function renderParties(host, { facts, motions, options, from, to }) {
  const byYear = partyByYear(motions, options);
  const totals = partyTotals(motions, options);
  const perSeat = partyPerSeat(motions, { ...options, seats: facts.seats, from, to });
  const mix = instrumentMix(motions, options);
  const outcome = outcomeByParty(motions, { ...options, outcomeGroups: facts.outcomeGroups, from, to });
  const duration = durationByParty(motions, options);

  const byYearShaped = shaped(byYear.series);
  const mixShaped = shaped(mix.series, true);
  const outcomeShaped = shaped(outcome.series, true);

  const boxes = [
    {
      title: 'Vorstösse je Partei pro Jahr',
      sub: 'Gestapelt je Jahr',
      spec: { labels: byYear.years, ...byYearShaped, stacked: true },
    },
    {
      title: 'Vorstösse je Partei gesamt',
      sub: 'Summe über den Zeitraum',
      spec: {
        type: 'bar',
        horizontal: true,
        labels: totals.map((entry) => entry.label),
        values: totals.map((entry) => entry.count),
        colors: totals.map((entry) => entry.color),
      },
    },
    {
      title: 'Vorstösse je Ratsmitglied und Jahr',
      sub: `Näherung auf Basis der Mandatsdaten, ab ${FIRST_SEAT_YEAR}`,
      spec: {
        type: 'bar',
        horizontal: true,
        labels: perSeat.map((entry) => entry.label),
        values: perSeat.map((entry) => entry.perSeat),
        colors: perSeat.map((entry) => entry.color),
      },
    },
    {
      title: 'Instrumenten-Mix je Partei',
      sub: 'Anteile der Vorstossarten je Partei',
      spec: { labels: mix.categories, ...mixShaped, stacked: true },
    },
    {
      title: 'Beschlüsse des Stadtparlaments je Partei',
      sub: `Anteile der Beschlussarten, ab ${FIRST_OUTCOME_YEAR}`,
      spec: { labels: outcome.categories, ...outcomeShaped, stacked: true },
    },
    {
      title: 'Mediane Behandlungsdauer',
      sub: 'Tage von der Einreichung bis zum Abschluss',
      spec: {
        type: 'bar',
        horizontal: true,
        labels: duration.map((entry) => entry.label),
        values: duration.map((entry) => entry.median),
        colors: duration.map((entry) => entry.color),
        unit: 'Tage',
      },
    },
  ];

  renderBoxes(host, boxes);
}

/** Wärmebild der Mitunterzeichnungen als Tabelle. */
function renderMatrix(host, motions, parties) {
  const matrix = coSignerMatrix(motions, { parties });
  if (!matrix.parties.length) {
    host.innerHTML = '<p class="empty">Für diese Auswertung liegen keine Daten vor.</p>';
    return;
  }

  const head = matrix.parties
    .map((party) => `<th scope="col" class="num"><span style="color:${escapeHtml(party.color)}">${escapeHtml(
      party.abbr ?? party.id,
    )}</span></th>`)
    .join('');

  const rows = matrix.parties
    .map((party, row) => {
      const cells = matrix.shares[row]
        .map((share, column) => {
          const intensity = Math.min(share / 60, 1);
          const background = `rgba(47,93,138,${(0.06 + intensity * 0.74).toFixed(2)})`;
          const title = `${party.abbr}: ${matrix.counts[row][column]} Mitunterzeichnungen durch ${
            matrix.parties[column].abbr
          }`;
          return `<td class="heat-cell${intensity > 0.55 ? ' heat-strong' : ''}" style="background:${background}" title="${escapeHtml(
            title,
          )}">${share ? share.toFixed(0) : '·'}</td>`;
        })
        .join('');
      return `<tr><th scope="row"><span class="party-dot" style="background:${escapeHtml(
        party.color,
      )}"></span>${escapeHtml(party.abbr ?? party.id)}</th>${cells}</tr>`;
    })
    .join('');

  host.innerHTML = `<div class="table-scroll"><table class="dist-table heat-table">
      <thead><tr><th scope="col"></th>${head}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="hint">Angaben in Prozent der Mitunterzeichnungen einer Zeile. «·» bedeutet keine.</p>`;
}

function renderPeople(host, motions, facts) {
  const people = topPeople(motions, { people: facts.people, parties: facts.parties, mode: state.mode, limit: 25 });
  if (!people.length) {
    host.innerHTML = '<p class="empty">Für diese Auswertung liegen keine Daten vor.</p>';
    return;
  }

  const label = state.mode === 'first' ? 'Erstunterzeichnungen' : 'Unterzeichnungen';
  const max = people[0].count || 1;
  const rows = people
    .map(
      (person, index) => `<tr>
        <td class="num">${index + 1}</td>
        <td><a href="https://parlament.winterthur.ch/behoerdenmitglieder/${escapeHtml(
          person.id,
        )}" target="_blank" rel="noopener">${escapeHtml(person.name)}</a></td>
        <td><span class="party-dot" style="background:${escapeHtml(person.color)}"></span>${escapeHtml(
          person.party,
        )}</td>
        <td>${escapeHtml(person.from ? person.from.slice(0, 4) : '?')}–${escapeHtml(
          person.to ? person.to.slice(0, 4) : 'heute',
        )}</td>
        <td class="num">${fmt(person.count)}</td>
        <td style="width:30%"><span class="bar-cell" style="width:${Math.round(
          (person.count / max) * 100,
        )}%;background:${escapeHtml(person.color)}"></span></td>
      </tr>`,
    )
    .join('');

  host.innerHTML = `<div class="table-scroll"><table class="dist-table">
      <thead><tr>
        <th scope="col" class="num">#</th><th scope="col">Person</th><th scope="col">Partei</th>
        <th scope="col">Im Rat</th><th scope="col" class="num">${escapeHtml(label)}</th><th scope="col"></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
}

function renderQuality(host, facts, range) {
  const summary = qualitySummary(facts, range);
  const notes = (facts.dataQuality?.notes ?? []).map((note) => `<li>${escapeHtml(note)}</li>`).join('');

  const rows = summary.coverage
    .map((entry) => {
      const share = entry.motions ? Math.round((entry.withAuthors / entry.motions) * 100) : 0;
      return `<tr>
        <th scope="row">${entry.year}</th>
        <td class="num">${fmt(entry.total)}</td>
        <td class="num">${fmt(entry.motions)}</td>
        <td class="num">${fmt(entry.withAuthors)}</td>
        <td class="num">${share}%</td>
        <td class="num">${fmt(entry.withDuration)}</td>
        <td class="num">${fmt(entry.withOutcome)}</td>
      </tr>`;
    })
    .join('');

  host.innerHTML = `
    <div class="notice info">
      <p>Von ${fmt(summary.motions)} Vorstössen im Zeitraum nennen ${fmt(
        summary.withAuthors,
      )} (${summary.authorShare} %) mindestens eine verfassende Person.
      Für ${fmt(summary.withDuration)} Geschäfte ist eine Behandlungsdauer bekannt, für ${fmt(
        summary.withOutcome,
      )} ein Beschluss des Stadtparlaments.</p>
      <ul class="quality-notes">${notes}</ul>
    </div>
    <details class="quality-details">
      <summary>Abdeckung je Jahr</summary>
      <div class="table-scroll"><table class="dist-table">
        <thead><tr>
          <th scope="col">Jahr</th><th scope="col" class="num">Geschäfte</th><th scope="col" class="num">Vorstösse</th>
          <th scope="col" class="num">mit Verfasser</th><th scope="col" class="num">Anteil</th>
          <th scope="col" class="num">mit Dauer</th><th scope="col" class="num">mit Beschluss</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </details>`;
}
