/**
 * Tests für das Personenverzeichnis (`scripts/lib/people.mjs`).
 *
 * Ausführen: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPEN_MANDATE_DATE,
  applyPeopleOverrides,
  buildPeopleDatabase,
  buildPerson,
  looseKey,
  parsePeopleRows,
  partyIdsBySource,
  personKey,
  personUrl,
  seatsByYear,
  serializePeople,
} from '../lib/people.mjs';

const META = {
  parties: [
    { id: 'sp', abbr: 'SP', name: 'Sozialdemokratische Partei', order: 7, sourceIds: [5762] },
    { id: 'svp', abbr: 'SVP', name: 'Schweizerische Volkspartei', order: 1, sourceIds: [5759] },
    { id: 'mitte', abbr: 'Die Mitte', name: 'Die Mitte', order: 3, sourceIds: [5750, 5920] },
    { id: 'sd', abbr: 'SD', name: 'Schweizer Demokraten', order: 10, historical: true, sourceIds: [8263] },
  ],
};

/** Zeile des Verzeichnisses, wie sie im `data-entities`-Blob steht. */
function row({ id, name, partyId = null, partyName = '', from, start = from, end = OPEN_MANDATE_DATE, district = '' }) {
  return {
    _nameVorname: `<a href="/_rte/person/${id}">${name}</a>`,
    '_nameVorname-sort': 'xxx',
    _partei: partyId ? `<a href="/_rte/partei/${partyId}">${partyName}</a>` : '',
    wahlkreis: district,
    '_mandatPersonFirstDatumVon-sort': from,
    '_mandatPersonDatumVon-sort': start,
    '_mandatPersonDatumBis-sort': end,
  };
}

/** Seite mit eingebettetem Personen-Blob; die Quelle verschachtelt die Zeilen als Objekt. */
function page(rows, { nested = true } = {}) {
  const payload = nested ? [Object.fromEntries(rows.map((entry, index) => [index, entry]))] : rows;
  // Das CMS maskiert im Attribut alles, was das Tag beenden würde.
  const json = JSON.stringify(payload).replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<table id="icmsTable-personList" data-entities="${json}"></table>`;
}

const ROWS = [
  row({ id: '1', name: 'Muster Anna', partyId: '5762', partyName: 'Sozialdemokratische Partei (SP)', from: '2010-07-01' }),
  row({
    id: '2',
    name: 'Beispiel Beat',
    partyId: '5759',
    partyName: 'Schweizerische Volkspartei (SVP)',
    from: '2006-07-01',
    end: '2014-06-30',
  }),
  row({
    id: '3',
    name: 'Kern Clara',
    partyId: '5920',
    partyName: 'Christliche Volkspartei (CVP; heute: Die Mitte)',
    from: '2002-07-01',
    end: '2018-06-30',
    district: 'Töss',
  }),
  row({ id: '4', name: 'Ohne Partei', from: '2017-05-08', end: '2023-09-19' }),
];

test('partyIdsBySource bildet jede Quell-ID auf eine Partei ab', () => {
  const map = partyIdsBySource(META);
  assert.equal(map.get('5762'), 'sp');
  assert.equal(map.get('5920'), 'mitte');
  assert.equal(map.get('5750'), 'mitte');
  assert.equal(map.get('8263'), 'sd');
  assert.equal(map.size, 5);
});

test('parsePeopleRows entpackt den verschachtelten Blob', () => {
  const rows = parsePeopleRows(page(ROWS));
  assert.equal(rows.length, 4);
  assert.match(rows[0]._nameVorname, /Muster Anna/);
});

test('parsePeopleRows verarbeitet auch eine flache Liste', () => {
  assert.equal(parsePeopleRows(page(ROWS, { nested: false })).length, 4);
});

test('parsePeopleRows liefert nichts ohne die Personentabelle', () => {
  assert.deepEqual(parsePeopleRows('<table id="icmsTable-anderes" data-entities="[]"></table>'), []);
  assert.deepEqual(parsePeopleRows(''), []);
});

test('buildPerson trennt Nachname und Vorname und ordnet die Partei zu', () => {
  const person = buildPerson(ROWS[2], { partyBySource: partyIdsBySource(META) });
  assert.equal(person.id, '3');
  assert.equal(person.lastName, 'Kern');
  assert.equal(person.firstName, 'Clara');
  assert.equal(person.partyId, 'mitte');
  assert.equal(person.partySource.id, '5920');
  assert.equal(person.partyFrom, 'quelle');
  assert.equal(person.district, 'Töss');
  assert.equal(person.active, false);
  assert.equal(person.url, personUrl('3'));
});

test('buildPerson wertet das Sentinel 9999-12-31 als laufendes Mandat', () => {
  const person = buildPerson(ROWS[0], { partyBySource: partyIdsBySource(META) });
  assert.equal(person.mandateEnd, null);
  assert.equal(person.active, true);
});

test('buildPerson gibt ohne Personen-Link nichts zurück', () => {
  assert.equal(buildPerson({ _nameVorname: 'Ohne Link' }, {}), null);
});

test('applyPeopleOverrides ergänzt eine fehlende Partei über die Personen-ID', () => {
  const people = [{ id: '4', name: 'Ohne Partei', partyId: null }];
  const result = applyPeopleOverrides(people, {
    overrides: [{ personId: '4', name: 'Ohne Partei', partyId: 'glp', note: 'Test' }],
  });
  assert.equal(result.applied, 1);
  assert.equal(people[0].partyId, 'glp');
  assert.equal(people[0].partyFrom, 'korrektur');
  assert.equal(people[0].partyNote, 'Test');
});

test('applyPeopleOverrides meldet Korrekturen ohne Treffer', () => {
  const result = applyPeopleOverrides([{ id: '1', name: 'Muster Anna' }], {
    overrides: [{ name: 'Gibt Es Nicht', partyId: 'sp' }],
  });
  assert.equal(result.applied, 0);
  assert.equal(result.unmatched.length, 1);
});

test('personKey und looseKey vereinheitlichen Schreibweisen', () => {
  assert.equal(personKey('Glättli Urs'), 'glattli urs');
  assert.equal(looseKey('Urs Glättli'), looseKey('Glättli Urs'));
  assert.notEqual(personKey('Urs Glättli'), personKey('Glättli Urs'));
});

test('buildPeopleDatabase liefert sortierte Personen samt Kennzahlen', () => {
  const db = buildPeopleDatabase({
    html: page(ROWS),
    meta: META,
    overrides: { overrides: [{ personId: '4', partyId: 'sd' }] },
    generatedAt: '2026-01-01T00:00:00Z',
  });

  assert.equal(db.people.length, 4);
  assert.deepEqual(
    db.people.map((person) => person.lastName),
    ['Beispiel', 'Kern', 'Muster', 'Ohne'],
  );
  assert.equal(db.dataQuality.active, 1);
  assert.equal(db.dataQuality.withoutParty, 0);
  assert.equal(db.dataQuality.overridesApplied, 1);
  assert.equal(db.earliestEntryDate, '2002-07-01');
});

test('buildPeopleDatabase entfernt doppelte Personen-IDs', () => {
  const db = buildPeopleDatabase({ html: page([...ROWS, ROWS[0]]), meta: META, generatedAt: 'x' });
  assert.equal(db.people.length, 4);
});

test('seatsByYear zählt nur Personen mit laufendem Mandat', () => {
  const db = buildPeopleDatabase({ html: page(ROWS), meta: META, generatedAt: 'x' });
  const years = seatsByYear(db.people, { from: 2005, to: 2020, seats: 3, tolerance: 0 });

  const at = (year) => years.find((entry) => entry.year === year);
  assert.equal(at(2005).total, 1);
  assert.deepEqual(at(2005).byParty, { mitte: 1 });
  assert.equal(at(2012).total, 3);
  assert.equal(at(2012).complete, true);
  assert.equal(at(2020).total, 2);
  assert.equal(at(2020).complete, false);
});

test('serializePeople schreibt eine Person je Zeile und bleibt gültiges JSON', () => {
  const db = buildPeopleDatabase({ html: page(ROWS), meta: META, generatedAt: 'x' });
  const text = serializePeople(db);
  assert.equal(text.match(/^ {4}\{"id"/gm).length, 4);
  assert.deepEqual(JSON.parse(text).people.length, 4);
});
