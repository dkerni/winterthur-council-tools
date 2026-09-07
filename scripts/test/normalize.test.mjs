/**
 * Tests für die Zuordnungs- und Normalisierungslogik
 * (`scripts/lib/normalize.mjs`).
 *
 * Ausführen: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { findGenderOverride, matchFraction, matchParty, readJson } from '../lib/normalize.mjs';

const meta = await readJson('data/party-meta.json');

test('Parteien werden auch bei abweichender Schreibweise der Quelle zugeordnet', () => {
  assert.equal(matchParty(meta, 'Sozialdemokratische Partei (SP)').id, 'sp');
  assert.equal(matchParty(meta, 'Alternative Liste (AL)').id, 'al');
  // Aktuelle Schreibweise der Quelle seit der Umbenennung der AL.
  assert.equal(matchParty(meta, 'Alternative Linke (AL; früher: Alternative Liste)').id, 'al');
  assert.equal(matchParty(meta, ''), null);
});

test('Fraktionen werden über das Kürzel in Klammern zugeordnet', () => {
  assert.equal(matchFraction(meta, 'Schweizerische Volkspartei-Fraktion (SVP)').id, 'svp');
  assert.equal(
    matchFraction(meta, 'Evangelische Volkspartei / Eidgenössisch-Demokratische Union-Fraktion (EVP/EDU)').id,
    'evp-edu',
  );
  assert.equal(matchFraction(meta, 'Grüne/AL-Fraktion').id, 'gruene-al');
  assert.equal(matchFraction(meta, ''), null);
});

test('Geschlechts-Overrides greifen auch bei abweichender Namensform', () => {
  const overrides = {
    overrides: [
      { name: 'Miguel P. Bachmann', gender: 'm' },
      { name: 'Dani Romay Ogando', gender: 'm' },
      { id: '281225', name: 'Egal Wer', gender: 'w' },
    ],
  };

  const exact = findGenderOverride(overrides, {
    firstName: 'Dani',
    lastName: 'Romay Ogando',
    displayName: 'Dani Romay Ogando',
  });
  assert.equal(exact.gender, 'm');
  assert.equal(exact.matchedBy, 'name');

  // Die Quelle führt Namen als «Nachname Vorname(n)» und schreibt Vornamen aus.
  const fuzzy = findGenderOverride(overrides, {
    firstName: 'Pedro',
    lastName: 'Bachmann Miguel',
    displayName: 'Pedro Bachmann Miguel',
  });
  assert.equal(fuzzy.gender, 'm');
  assert.equal(fuzzy.matchedBy, 'name-fuzzy');

  const byId = findGenderOverride(overrides, { id: '281225', firstName: 'A', lastName: 'B' });
  assert.equal(byId.matchedBy, 'id');

  assert.equal(findGenderOverride(overrides, { firstName: 'Nina', lastName: 'Unbekannt' }), null);
});
