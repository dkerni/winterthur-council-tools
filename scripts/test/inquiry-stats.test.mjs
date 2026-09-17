/**
 * Tests für die Auswertungen der Seite «Vorstösse»
 * (`assets/js/inquiry-stats.js`, ohne DOM-Abhängigkeit).
 *
 * Ausführen: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FIRST_OUTCOME_YEAR,
  FIRST_SEAT_YEAR,
  ROLE_CO,
  ROLE_FIRST,
  businessByYear,
  coSignerMatrix,
  countByType,
  durationByParty,
  inPeriod,
  instrumentMix,
  median,
  motionsOnly,
  orderedParties,
  outcomeByParty,
  partiesOf,
  partyByYear,
  partyPerSeat,
  partyTotals,
  qualitySummary,
  seatYears,
  toShares,
  topPeople,
  typesByYear,
  yearRange,
} from '../../assets/js/inquiry-stats.js';

const PARTIES = [
  { id: 'svp', abbr: 'SVP', color: '#1a7a3c', order: 1 },
  { id: 'glp', abbr: 'GLP', color: '#b8c832', order: 4 },
  { id: 'sp', abbr: 'SP', color: '#c0392b', order: 7 },
];

const TYPES = [
  { id: 'interpellation', label: 'Interpellation', motion: true },
  { id: 'motion', label: 'Motion', motion: true },
  { id: 'postulat', label: 'Postulat', motion: true },
  { id: 'kreditantrag', label: 'Kreditantrag', motion: false },
];

const MOTION_TYPE_IDS = ['interpellation', 'motion', 'postulat'];

const OUTCOME_GROUPS = [
  { id: 'angenommen', label: 'Angenommen' },
  { id: 'abgelehnt', label: 'Abgelehnt' },
];

/** Kurzform: Geschäft mit Erstunterzeichnung und optionalen Mitunterzeichnungen. */
function fact(i, y, t, { first, co = [], d, o } = {}) {
  const entry = { i: String(i), y, t };
  if (d != null) entry.d = d;
  if (o) entry.o = o;
  if (first) {
    entry.a = [[`p${i}`, first, ROLE_FIRST], ...co.map((party, index) => [`c${i}${index}`, party, ROLE_CO])];
    entry.p = first;
  }
  return entry;
}

const FACTS = [
  fact(1, 2018, 'interpellation', { first: 'sp', co: ['sp', 'glp'], d: 100, o: 'angenommen' }),
  fact(2, 2018, 'motion', { first: 'svp', co: ['glp'], d: 300, o: 'abgelehnt' }),
  fact(3, 2019, 'interpellation', { first: 'sp', d: 200, o: 'angenommen' }),
  fact(4, 2019, 'postulat', { first: 'glp', co: ['sp'], d: 400, o: 'angenommen' }),
  fact(5, 2020, 'motion', { first: 'svp', d: 500, o: 'abgelehnt' }),
  fact(6, 2020, 'kreditantrag', {}),
  fact(7, 2020, 'kreditantrag', {}),
];

const SEATS = [
  { year: 2018, total: 60, complete: true, byParty: { svp: 20, sp: 30, glp: 10 } },
  { year: 2019, total: 60, complete: true, byParty: { svp: 20, sp: 30, glp: 10 } },
  { year: 2020, total: 30, complete: false, byParty: { svp: 10, sp: 15, glp: 5 } },
];

const PEOPLE = [
  { id: 'p1', name: 'Muster Anna', partyId: 'sp', from: '2010-07-01', to: null },
  { id: 'p3', name: 'Muster Anna', partyId: 'sp', from: '2010-07-01', to: null },
];

/* ─── Grundlagen ───────────────────────────────────────────────────── */

test('median liefert den mittleren Wert und rundet bei gerader Anzahl', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 3);
  assert.equal(median([]), null);
  assert.equal(median([null, undefined, 5]), 5);
});

test('inPeriod schliesst die Grenzen ein', () => {
  assert.equal(inPeriod(FACTS, { from: 2019, to: 2019 }).length, 2);
  assert.equal(inPeriod(FACTS, { from: 2018, to: 2020 }).length, 7);
  assert.equal(inPeriod(FACTS, {}).length, 7);
});

test('motionsOnly lässt Verwaltungsgeschäfte weg', () => {
  assert.equal(motionsOnly(FACTS, MOTION_TYPE_IDS).length, 5);
});

test('partiesOf unterscheidet Erstunterzeichnung und alle Unterzeichnenden', () => {
  assert.deepEqual(partiesOf(FACTS[0], 'first'), ['sp']);
  assert.deepEqual(partiesOf(FACTS[0], 'all').sort(), ['glp', 'sp']);
  assert.deepEqual(partiesOf(FACTS[5], 'first'), []);
});

test('orderedParties sortiert nach der Reihenfolge aus party-meta', () => {
  assert.deepEqual(
    orderedParties(PARTIES).map((party) => party.id),
    ['svp', 'glp', 'sp'],
  );
  assert.deepEqual(
    orderedParties(PARTIES, new Set(['sp', 'svp'])).map((party) => party.id),
    ['svp', 'sp'],
  );
});

test('yearRange schliesst Lücken', () => {
  assert.deepEqual(yearRange([{ y: 2010 }, { y: 2013 }]), [2010, 2011, 2012, 2013]);
  assert.deepEqual(yearRange([]), []);
});

test('toShares normalisiert je Kategorie auf 100', () => {
  const shares = toShares([
    { id: 'a', values: [1, 0] },
    { id: 'b', values: [3, 0] },
  ]);
  assert.deepEqual(shares[0].values, [25, 0]);
  assert.deepEqual(shares[1].values, [75, 0]);
});

/* ─── Überblick ────────────────────────────────────────────────────── */

test('businessByYear trennt Vorstösse von den übrigen Geschäften', () => {
  const result = businessByYear(FACTS, MOTION_TYPE_IDS);
  assert.deepEqual(result.years, [2018, 2019, 2020]);
  assert.deepEqual(result.series[0].values, [2, 2, 1]);
  assert.deepEqual(result.series[1].values, [0, 0, 2]);
});

test('countByType zählt absteigend', () => {
  const counts = countByType(FACTS, TYPES);
  assert.deepEqual(counts[0], { id: 'interpellation', label: 'Interpellation', count: 2 });
  assert.equal(counts.find((entry) => entry.id === 'kreditantrag').count, 2);
});

test('typesByYear fasst seltene Arten zusammen', () => {
  const result = typesByYear(motionsOnly(FACTS, MOTION_TYPE_IDS), TYPES, { top: 1 });
  assert.deepEqual(
    result.series.map((row) => row.id),
    ['interpellation', 'uebrige'],
  );
  assert.deepEqual(result.series[0].values, [1, 1, 0]);
  assert.deepEqual(result.series[1].values, [1, 1, 1]);
});

/* ─── Parteien ─────────────────────────────────────────────────────── */

test('partyByYear zählt Erstunterzeichnungen je Partei und Jahr', () => {
  const motions = motionsOnly(FACTS, MOTION_TYPE_IDS);
  const result = partyByYear(motions, { parties: PARTIES, mode: 'first' });

  assert.deepEqual(result.years, [2018, 2019, 2020]);
  assert.deepEqual(
    result.series.map((row) => row.id),
    ['svp', 'glp', 'sp'],
  );
  assert.deepEqual(result.series.find((row) => row.id === 'sp').values, [1, 1, 0]);
  assert.deepEqual(result.series.find((row) => row.id === 'svp').values, [1, 0, 1]);
});

test('partyByYear zählt im Modus «alle» jede Partei je Geschäft einmal', () => {
  const motions = motionsOnly(FACTS, MOTION_TYPE_IDS);
  const result = partyByYear(motions, { parties: PARTIES, mode: 'all' });
  // 2018: SP aus Geschäft 1 (Erst- und Mitunterzeichnung derselben Partei zählt einmal)
  assert.deepEqual(result.series.find((row) => row.id === 'sp').values, [1, 2, 0]);
  assert.deepEqual(result.series.find((row) => row.id === 'glp').values, [2, 1, 0]);
});

test('partyTotals summiert über den Zeitraum und behält die Parteireihenfolge', () => {
  const totals = partyTotals(motionsOnly(FACTS, MOTION_TYPE_IDS), { parties: PARTIES, mode: 'first' });
  assert.deepEqual(
    totals.map((entry) => [entry.id, entry.count]),
    [
      ['svp', 2],
      ['glp', 1],
      ['sp', 2],
    ],
  );
});

test('seatYears berücksichtigt nur vollständige Jahre', () => {
  const { totals, years } = seatYears(SEATS, { from: 2018, to: 2020 });
  assert.equal(years, 2);
  assert.equal(totals.get('sp'), 60);
  assert.equal(totals.get('glp'), 20);
});

test('partyPerSeat normalisiert auf die Sitzjahre und beginnt frühestens 2007', () => {
  const motions = motionsOnly(FACTS, MOTION_TYPE_IDS);
  const perSeat = partyPerSeat(motions, { parties: PARTIES, seats: SEATS, from: 2000, to: 2020, mode: 'first' });

  assert.ok(FIRST_SEAT_YEAR === 2007);
  const sp = perSeat.find((entry) => entry.id === 'sp');
  assert.equal(sp.seatYears, 60);
  assert.equal(sp.count, 2);
  assert.equal(sp.perSeat, 0.03);
});

test('instrumentMix liefert je Vorstossart eine Reihe über die Parteien', () => {
  const mix = instrumentMix(motionsOnly(FACTS, MOTION_TYPE_IDS), { parties: PARTIES, types: TYPES, mode: 'first' });
  assert.deepEqual(mix.partyIds, ['svp', 'glp', 'sp']);

  const interpellation = mix.series.find((row) => row.id === 'interpellation');
  assert.deepEqual(interpellation.values, [0, 0, 2]);
  const motion = mix.series.find((row) => row.id === 'motion');
  assert.deepEqual(motion.values, [2, 0, 0]);
});

test('coSignerMatrix zählt Mitunterzeichnungen je Parteipaar', () => {
  const matrix = coSignerMatrix(motionsOnly(FACTS, MOTION_TYPE_IDS), { parties: PARTIES });
  const index = Object.fromEntries(matrix.parties.map((party, position) => [party.id, position]));

  assert.equal(matrix.counts[index.sp][index.sp], 1);
  assert.equal(matrix.counts[index.sp][index.glp], 1);
  assert.equal(matrix.counts[index.svp][index.glp], 1);
  assert.equal(matrix.counts[index.glp][index.sp], 1);
  assert.deepEqual(matrix.shares[index.svp], [0, 100, 0]);
});

test('coSignerMatrix ignoriert Geschäfte ohne Mitunterzeichnung', () => {
  const matrix = coSignerMatrix([fact(9, 2021, 'motion', { first: 'sp' })], { parties: PARTIES });
  assert.deepEqual(matrix.parties, []);
});

test('outcomeByParty wertet erst ab 2017 aus', () => {
  const motions = motionsOnly(FACTS, MOTION_TYPE_IDS);
  const result = outcomeByParty(motions, {
    parties: PARTIES,
    outcomeGroups: OUTCOME_GROUPS,
    mode: 'first',
    from: 2000,
    to: 2020,
  });

  assert.ok(FIRST_OUTCOME_YEAR === 2017);
  assert.deepEqual(result.partyIds, ['svp', 'glp', 'sp']);
  assert.deepEqual(result.series.find((row) => row.id === 'angenommen').values, [0, 1, 2]);
  assert.deepEqual(result.series.find((row) => row.id === 'abgelehnt').values, [2, 0, 0]);
});

test('durationByParty bildet den Median je Partei', () => {
  const duration = durationByParty(motionsOnly(FACTS, MOTION_TYPE_IDS), { parties: PARTIES, mode: 'first' });
  assert.deepEqual(
    duration.map((entry) => [entry.id, entry.median, entry.count]),
    [
      ['svp', 400, 2],
      ['glp', 400, 1],
      ['sp', 150, 2],
    ],
  );
});

/* ─── Personen ─────────────────────────────────────────────────────── */

test('topPeople zählt Erstunterzeichnungen und ergänzt die Partei', () => {
  const people = topPeople(motionsOnly(FACTS, MOTION_TYPE_IDS), {
    people: PEOPLE,
    parties: PARTIES,
    mode: 'first',
    limit: 3,
  });

  assert.equal(people[0].count, 1);
  assert.equal(people.length, 3);
  const anna = people.find((entry) => entry.id === 'p1');
  assert.equal(anna.party, 'SP');
  assert.equal(anna.color, '#c0392b');
});

test('topPeople zählt im Modus «alle» auch Mitunterzeichnungen', () => {
  const motions = motionsOnly(FACTS, MOTION_TYPE_IDS);
  const first = topPeople(motions, { people: PEOPLE, parties: PARTIES, mode: 'first', limit: 50 });
  const all = topPeople(motions, { people: PEOPLE, parties: PARTIES, mode: 'all', limit: 50 });
  assert.equal(first.length, 5);
  assert.equal(all.length, 9);
});

/* ─── Datenqualität ────────────────────────────────────────────────── */

test('qualitySummary summiert die Abdeckung im Zeitraum', () => {
  const facts = {
    coverage: [
      { year: 2018, total: 10, motions: 8, withAuthors: 6, withDuration: 5, withOutcome: 4 },
      { year: 2019, total: 12, motions: 8, withAuthors: 8, withDuration: 7, withOutcome: 6 },
      { year: 2020, total: 5, motions: 4, withAuthors: 1, withDuration: 1, withOutcome: 0 },
    ],
  };
  const summary = qualitySummary(facts, { from: 2018, to: 2019 });

  assert.deepEqual(summary.years, [2018, 2019]);
  assert.equal(summary.total, 22);
  assert.equal(summary.motions, 16);
  assert.equal(summary.withAuthors, 14);
  assert.equal(summary.authorShare, 87.5);
});
