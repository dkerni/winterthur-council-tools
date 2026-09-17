/**
 * Tests für die Faktentabelle (`scripts/lib/inquiry-facts.mjs`).
 *
 * Ausführen: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MOTION_TYPE_IDS,
  ROLE_CO,
  ROLE_FIRST,
  ROLE_OTHER,
  buildFact,
  buildFacts,
  buildPersonIndex,
  collectTypes,
  coverageByYear,
  outcomeGroup,
  parliamentDecision,
  resolveAuthor,
  roleCode,
  serializeFacts,
} from '../lib/inquiry-facts.mjs';

const META = {
  parties: [
    { id: 'svp', abbr: 'SVP', name: 'SVP', color: '#1a7a3c', order: 1 },
    { id: 'sp', abbr: 'SP', name: 'SP', color: '#c0392b', order: 7 },
    { id: 'sd', abbr: 'SD', name: 'Schweizer Demokraten', color: '#8a6d3b', order: 10, historical: true },
  ],
};

const PEOPLE = [
  { id: '1', name: 'Muster Anna', partyId: 'sp', firstEntryDate: '2010-07-01', mandateEnd: null },
  { id: '2', name: 'Beispiel Beat', partyId: 'svp', firstEntryDate: '2006-07-01', mandateEnd: '2020-06-30' },
  { id: '3', name: 'Kern Clara', partyId: 'sd', firstEntryDate: '2012-07-01', mandateEnd: null },
];

function author(name, { role = 'Erstunterzeichner/-in', personId = null } = {}) {
  return { name, role, roleId: role.toLowerCase().replace(/\/-?in\.?$/, '').replace(/[^a-z]/g, ''), personId };
}

const RECORDS = [
  {
    id: '100',
    year: 2018,
    type: 'Interpellation',
    typeId: 'interpellation',
    statusId: 'erledigt',
    durationDays: 120,
    decisions: [
      { body: 'Vorberatung', date: '2018-03-01', decision: 'Zustimmung' },
      { body: 'Stadtparlament', date: '2018-06-01', decision: 'Zustimmende Kenntnisnahme' },
    ],
    authors: [author('Muster Anna'), author('Beispiel Beat', { role: 'Mitunterzeichner/-in', personId: '2' })],
  },
  {
    id: '101',
    year: 2019,
    type: 'Motion',
    typeId: 'motion',
    statusId: 'erledigt',
    durationDays: 400,
    decisions: [{ body: 'Stadtparlament', date: '2020-01-01', decision: 'Ablehnung' }],
    authors: [author('Kern Clara', { personId: '3' })],
  },
  {
    id: '102',
    year: 2019,
    type: 'Kreditantrag',
    typeId: 'kreditantrag',
    statusId: 'erledigt',
    decisions: [],
    authors: [],
  },
];

test('outcomeGroup fasst die Beschlussarten zusammen', () => {
  assert.equal(outcomeGroup('Zustimmung'), 'angenommen');
  assert.equal(outcomeGroup('Zustimmung mit Änderung(en)'), 'angenommen');
  assert.equal(outcomeGroup('Überweisung'), 'angenommen');
  assert.equal(outcomeGroup('Zustimmende Kenntnisnahme'), 'kenntnisnahme');
  assert.equal(outcomeGroup('Ablehnende Kenntnisnahme'), 'abgelehnt');
  assert.equal(outcomeGroup('Abschreibung'), 'abgeschrieben');
  assert.equal(outcomeGroup('Rückweisung'), 'zurueckgewiesen');
  assert.equal(outcomeGroup('Kenntnisnahme Rückzug'), 'zurueckgezogen');
  assert.equal(outcomeGroup('Etwas Neues'), 'andere');
  assert.equal(outcomeGroup(null), null);
});

test('parliamentDecision nimmt den letzten Beschluss des Stadtparlaments', () => {
  assert.equal(parliamentDecision(RECORDS[0]).decision, 'Zustimmende Kenntnisnahme');
  assert.equal(parliamentDecision(RECORDS[2]), null);
  assert.equal(parliamentDecision({ decisions: [{ body: 'Vorberatung', decision: 'Zustimmung' }] }), null);
});

test('roleCode unterscheidet Erst-, Mit- und übrige Unterzeichnende', () => {
  assert.equal(roleCode({ roleId: 'erstunterzeichner' }), ROLE_FIRST);
  assert.equal(roleCode({ roleId: 'mitunterzeichner' }), ROLE_CO);
  assert.equal(roleCode({ roleId: 'beteiligte r' }), ROLE_OTHER);
  assert.equal(roleCode({}), ROLE_OTHER);
});

test('resolveAuthor findet Personen über ID, Namen und Namensteile', () => {
  const index = buildPersonIndex(PEOPLE);
  assert.equal(resolveAuthor({ personId: '2' }, index).matchedBy, 'id');
  assert.equal(resolveAuthor({ name: 'Muster Anna' }, index).matchedBy, 'name');
  assert.equal(resolveAuthor({ name: 'Anna Muster' }, index).matchedBy, 'namensteile');
  assert.equal(resolveAuthor({ name: 'Unbekannt Uwe' }, index).person, null);
});

test('resolveAuthor zieht die ID dem Namen vor', () => {
  const index = buildPersonIndex(PEOPLE);
  const result = resolveAuthor({ personId: '1', name: 'Kern Clara' }, index);
  assert.equal(result.person.id, '1');
});

test('buildFact erzeugt eine kompakte Zeile ohne leere Felder', () => {
  const index = buildPersonIndex(PEOPLE);
  const fact = buildFact(RECORDS[0], { index });

  assert.deepEqual(fact, {
    i: '100',
    y: 2018,
    t: 'interpellation',
    s: 'erledigt',
    d: 120,
    o: 'kenntnisnahme',
    b: 'Zustimmende Kenntnisnahme',
    a: [
      ['1', 'sp', ROLE_FIRST],
      ['2', 'svp', ROLE_CO],
    ],
    p: 'sp',
  });
});

test('buildFact lässt Geschäfte ohne Verfasser ohne Parteiangabe', () => {
  const fact = buildFact(RECORDS[2], { index: buildPersonIndex(PEOPLE) });
  assert.equal(fact.a, undefined);
  assert.equal(fact.p, undefined);
  assert.equal(fact.o, undefined);
});

test('buildFact meldet nicht auflösbare Verfasser', () => {
  const unresolved = [];
  buildFact({ id: '9', year: 2020, typeId: 'motion', authors: [author('Niemand Nie')] }, {
    index: buildPersonIndex(PEOPLE),
    unresolved,
  });
  assert.deepEqual(unresolved, [{ inquiryId: '9', name: 'Niemand Nie' }]);
});

test('collectTypes kennzeichnet Vorstösse', () => {
  const types = collectTypes(RECORDS);
  assert.deepEqual(
    types.map((type) => [type.id, type.count, type.motion]),
    [
      ['interpellation', 1, true],
      ['motion', 1, true],
      ['kreditantrag', 1, false],
    ],
  );
});

test('MOTION_TYPE_IDS enthält nur Vorstossarten', () => {
  assert.ok(MOTION_TYPE_IDS.includes('schriftliche-anfrage'));
  assert.ok(MOTION_TYPE_IDS.includes('parlamentarische-initiative'));
  assert.ok(!MOTION_TYPE_IDS.includes('kreditantrag'));
  assert.ok(!MOTION_TYPE_IDS.includes('wahlen'));
});

test('coverageByYear zählt Geschäfte, Vorstösse und Abdeckung je Jahr', () => {
  const index = buildPersonIndex(PEOPLE);
  const facts = RECORDS.map((record) => buildFact(record, { index }));
  const coverage = coverageByYear(facts);

  assert.deepEqual(coverage[0], { year: 2018, total: 1, motions: 1, withAuthors: 1, withDuration: 1, withOutcome: 1 });
  assert.deepEqual(coverage[1], { year: 2019, total: 2, motions: 1, withAuthors: 1, withDuration: 1, withOutcome: 1 });
});

test('buildFacts liefert Kopfdaten, Personen, Sitze und Kennzahlen', () => {
  const db = buildFacts({
    inquiries: RECORDS,
    people: PEOPLE,
    meta: META,
    generatedAt: '2026-01-01T00:00:00Z',
    seatsFrom: 2018,
  });

  assert.equal(db.inquiries.length, 3);
  assert.equal(db.dataQuality.authorMentions, 3);
  assert.deepEqual(db.dataQuality.unresolved, []);
  assert.deepEqual(db.dataQuality.matchedBy, { name: 1, id: 2 });
  assert.deepEqual(
    db.people.map((person) => person.id).sort(),
    ['1', '2', '3'],
  );
  assert.deepEqual(
    db.parties.map((party) => party.id),
    ['svp', 'sp', 'sd'],
  );
  assert.deepEqual(
    db.seats.map((entry) => entry.year),
    [2018, 2019],
  );
  assert.equal(db.seats[0].byParty.sp, 1);
});

test('buildFacts sortiert die Geschäfte stabil nach ID', () => {
  const shuffled = [RECORDS[2], RECORDS[0], RECORDS[1]];
  const db = buildFacts({ inquiries: shuffled, people: PEOPLE, meta: META, generatedAt: 'x' });
  assert.deepEqual(
    db.inquiries.map((fact) => fact.i),
    ['100', '101', '102'],
  );
});

test('serializeFacts schreibt ein Geschäft je Zeile und bleibt gültiges JSON', () => {
  const db = buildFacts({ inquiries: RECORDS, people: PEOPLE, meta: META, generatedAt: 'x' });
  const text = serializeFacts(db);
  assert.equal(text.match(/^ {4}\{"i":/gm).length, 3);
  assert.equal(JSON.parse(text).inquiries.length, 3);
});
