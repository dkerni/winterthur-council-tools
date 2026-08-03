/**
 * Tests für die Rechenlogik des Mehrheitsrechners
 * (`assets/js/majority.js`, ohne DOM-Abhängigkeit).
 *
 * Ausführen: npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAJORITY_TYPES,
  computeResult,
  minimalWinningCoalitions,
  outcomeLabel,
  requiredMajority,
} from '../../assets/js/majority.js';

/** Sitzverteilung der Legislatur 2026–2030 (60 Sitze). */
const PARTIES = [
  { id: 'svp', name: 'SVP', seats: 10 },
  { id: 'fdp', name: 'FDP', seats: 8 },
  { id: 'mitte', name: 'Die Mitte', seats: 5 },
  { id: 'glp', name: 'GLP', seats: 7 },
  { id: 'edu', name: 'EDU', seats: 1 },
  { id: 'evp', name: 'EVP', seats: 3 },
  { id: 'sp', name: 'SP', seats: 17 },
  { id: 'gruene', name: 'Grüne', seats: 6 },
  { id: 'al', name: 'AL', seats: 3 },
];

function votesFor(yesIds, noIds = []) {
  const votes = {};
  for (const id of yesIds) votes[id] = 'yes';
  for (const id of noIds) votes[id] = 'no';
  return votes;
}

test('60 Sitze insgesamt', () => {
  assert.equal(
    PARTIES.reduce((sum, p) => sum + p.seats, 0),
    60,
  );
});

test('SP + Grüne + AL erreichen 26 Stimmen und werden abgelehnt', () => {
  const result = computeResult({
    groups: PARTIES,
    votes: votesFor(['sp', 'gruene', 'al'], ['svp', 'fdp', 'mitte', 'glp', 'edu', 'evp']),
  });
  assert.equal(result.yes, 26);
  assert.equal(result.no, 34);
  assert.equal(result.base, 60);
  assert.equal(result.required, 31);
  assert.equal(result.outcome, 'rejected');
});

test('SP + Grüne + AL + GLP + Mitte erreichen 38 Stimmen und werden angenommen', () => {
  const result = computeResult({
    groups: PARTIES,
    votes: votesFor(['sp', 'gruene', 'al', 'glp', 'mitte'], ['svp', 'fdp', 'edu', 'evp']),
  });
  assert.equal(result.yes, 38);
  assert.equal(result.no, 22);
  assert.equal(result.outcome, 'accepted');
  assert.equal(result.margin, 7);
});

test('Absenzen senken die Stimmen der Gruppe und das erforderliche Mehr', () => {
  const result = computeResult({
    groups: PARTIES,
    votes: votesFor(['sp', 'gruene', 'al', 'glp'], ['svp', 'fdp', 'mitte', 'edu', 'evp']),
    absences: { svp: 4, fdp: 2 },
  });
  assert.equal(result.absent, 6);
  assert.equal(result.present, 54);
  assert.equal(result.yes, 33);
  assert.equal(result.no, 21);
  assert.equal(result.required, 28);
  assert.equal(result.outcome, 'accepted');
});

test('Absenzen werden auf die Sitzzahl begrenzt und nie negativ', () => {
  const result = computeResult({
    groups: PARTIES,
    votes: votesFor(['sp']),
    absences: { sp: 99, svp: -5 },
  });
  assert.equal(result.groups.find((g) => g.group.id === 'sp').present, 0);
  assert.equal(result.groups.find((g) => g.group.id === 'svp').present, 10);
});

test('Stimmengleichheit ergibt ein Patt', () => {
  const groups = [
    { id: 'a', name: 'A', seats: 30 },
    { id: 'b', name: 'B', seats: 30 },
  ];
  const result = computeResult({ groups, votes: { a: 'yes', b: 'no' } });
  assert.equal(result.outcome, 'tie');
  assert.match(outcomeLabel(result.outcome), /Patt/);
});

test('Enthaltungen zählen wahlweise zur Berechnungsbasis', () => {
  const groups = [
    { id: 'a', name: 'A', seats: 25 },
    { id: 'b', name: 'B', seats: 20 },
    { id: 'c', name: 'C', seats: 15 },
  ];
  const votes = { a: 'yes', b: 'no', c: 'abstain' };

  const withoutAbstentions = computeResult({ groups, votes });
  assert.equal(withoutAbstentions.base, 45);
  assert.equal(withoutAbstentions.required, 23);
  assert.equal(withoutAbstentions.outcome, 'accepted');

  const withAbstentions = computeResult({ groups, votes, abstentionsCount: true });
  assert.equal(withAbstentions.base, 60);
  assert.equal(withAbstentions.required, 31);
  assert.equal(withAbstentions.outcome, 'rejected');
});

test('«frei» zählt als anwesend, aber nicht zur Basis', () => {
  const result = computeResult({
    groups: PARTIES,
    votes: { sp: 'yes', svp: 'no', glp: 'free' },
  });
  assert.equal(result.yes, 17);
  assert.equal(result.no, 10);
  assert.equal(result.base, 27);
  assert.equal(result.free, 33);
  assert.equal(result.present, 60);
});

test('Absolutes Mehr verlangt 31 Stimmen — auch bei vielen Absenzen', () => {
  const result = computeResult({
    groups: PARTIES,
    votes: votesFor(['sp', 'gruene', 'al', 'glp'], ['svp']),
    absences: { fdp: 8, mitte: 5, edu: 1, evp: 3 },
    majorityType: 'absolute',
  });
  assert.equal(result.yes, 33);
  assert.equal(result.required, 31);
  assert.equal(result.outcome, 'accepted');

  const tooFew = computeResult({
    groups: PARTIES,
    votes: votesFor(['sp', 'gruene', 'al'], ['svp']),
    majorityType: 'absolute',
  });
  assert.equal(tooFew.yes, 26);
  assert.equal(tooFew.required, 31);
  assert.equal(tooFew.outcome, 'rejected');
});

test('Zweidrittelmehr rundet auf', () => {
  assert.equal(requiredMajority('two-thirds', 60, 60), 40);
  assert.equal(requiredMajority('two-thirds', 59, 60), 40);
  assert.equal(requiredMajority('simple', 59, 60), 30);
  assert.equal(requiredMajority('absolute', 10, 60), 31);
});

test('Ohne abgegebene Stimmen ist das Ergebnis unentschieden', () => {
  const result = computeResult({ groups: PARTIES, votes: {} });
  assert.equal(result.base, 0);
  assert.equal(result.outcome, 'undecided');
});

test('Alle Mehrheitsarten sind dokumentiert', () => {
  assert.deepEqual(
    MAJORITY_TYPES.map((type) => type.id),
    ['simple', 'absolute', 'two-thirds'],
  );
});

test('Minimale Gewinn-Koalitionen sind gewinnend und minimal', () => {
  const coalitions = minimalWinningCoalitions({ groups: PARTIES });
  assert.ok(coalitions.length > 0);

  const seatsById = new Map(PARTIES.map((p) => [p.id, p.seats]));
  for (const coalition of coalitions) {
    const total = coalition.groupIds.reduce((sum, id) => sum + seatsById.get(id), 0);
    assert.equal(total, coalition.votes);
    assert.ok(total >= 31, `${coalition.groupIds} erreicht nur ${total} Stimmen`);
    for (const id of coalition.groupIds) {
      assert.ok(total - seatsById.get(id) < 31, `${coalition.groupIds} ist ohne ${id} noch gewinnend`);
    }
  }

  // Die kleinste Koalition steht zuoberst.
  assert.equal(coalitions[0].groups.length, Math.min(...coalitions.map((c) => c.groups.length)));
});

test('SP + SVP + FDP ist eine minimale Gewinn-Koalition', () => {
  const coalitions = minimalWinningCoalitions({ groups: PARTIES });
  const found = coalitions.find(
    (c) => c.groupIds.length === 3 && ['sp', 'svp', 'fdp'].every((id) => c.groupIds.includes(id)),
  );
  assert.ok(found);
  assert.equal(found.votes, 35);
});

test('Koalitionen berücksichtigen Absenzen', () => {
  const coalitions = minimalWinningCoalitions({
    groups: PARTIES,
    absences: { sp: 17 }, // SP komplett abwesend
  });
  assert.ok(coalitions.every((c) => !c.groupIds.includes('sp')));
  // 43 anwesende Stimmen ⇒ erforderliches Mehr 22
  assert.ok(coalitions.every((c) => c.votes >= 22));
});
