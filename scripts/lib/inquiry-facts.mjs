/**
 * Faktentabelle für die historischen Auswertungen — reine Aufbaulogik.
 *
 * Aus den Jahres-Shards unter `data/inquiries/` und dem Personenverzeichnis
 * `data/people.json` entsteht eine kompakte Tabelle mit einer Zeile je Geschäft.
 * Das Frontend lädt nur diese Datei (rund 400 kB statt 6 MB) und rechnet alle
 * Auswertungen daraus — Filter und Umschalter wirken damit ohne weitere Abrufe.
 *
 * Kein Netzzugriff; vollständig testbar.
 */

import { normalizeName } from './normalize.mjs';
import { looseKey, personKey, seatsByYear } from './people.mjs';

/** Schema der Faktentabelle. */
export const SCHEMA_VERSION = 1;

/**
 * Geschäftsarten, die von Ratsmitgliedern eingereicht werden.
 *
 * Nur diese nennen Verfasserinnen und Verfasser; Verwaltungsgeschäfte (Wahlen,
 * Kreditantrag, Bericht, Budget …) bleiben bei den Partei-Auswertungen aussen vor.
 */
export const MOTION_TYPE_IDS = [
  'motion',
  'dringliche-motion',
  'budget-motion',
  'postulat',
  'dringliches-postulat',
  'budget-postulat',
  'interpellation',
  'dringliche-interpellation',
  'schriftliche-anfrage',
  'beschlussantrag',
  'parlamentarische-initiative',
];

/** Rollen der Verfasserangaben, kompakt kodiert. */
export const ROLE_FIRST = 1;
export const ROLE_CO = 2;
export const ROLE_OTHER = 3;

/** Gruppen der Beschlussarten des Stadtparlaments, in Anzeigereihenfolge. */
export const OUTCOME_GROUPS = [
  { id: 'angenommen', label: 'Angenommen' },
  { id: 'kenntnisnahme', label: 'Zustimmend zur Kenntnis genommen' },
  { id: 'abgeschrieben', label: 'Abgeschrieben' },
  { id: 'zurueckgewiesen', label: 'Zurückgewiesen' },
  { id: 'abgelehnt', label: 'Abgelehnt' },
  { id: 'zurueckgezogen', label: 'Zurückgezogen' },
  { id: 'andere', label: 'Übrige' },
];

/**
 * Beschlussart → Gruppe. Schlüssel ist die Vergleichsform des Quelltexts, damit
 * Schreibweisen («Zustimmung mit Änderung(en)») nicht ins Gewicht fallen.
 */
const OUTCOME_BY_DECISION = new Map(
  Object.entries({
    'Zustimmung': 'angenommen',
    'Zustimmung mit Änderung(en)': 'angenommen',
    'Überweisung': 'angenommen',
    'Erheblicherklärung': 'angenommen',
    'Vorläufige Unterstützung': 'angenommen',
    'Zustimmende Kenntnisnahme': 'kenntnisnahme',
    'Abschreibung': 'abgeschrieben',
    'Rückweisung': 'zurueckgewiesen',
    'Bestellung Ergänzungsbericht': 'zurueckgewiesen',
    'Ablehnung': 'abgelehnt',
    'Ablehnende Kenntnisnahme': 'abgelehnt',
    'Kenntnisnahme Rückzug': 'zurueckgezogen',
  }).map(([label, group]) => [normalizeName(label), group]),
);

/** Gruppe einer Beschlussart; unbekannte Werte landen bei «Übrige». */
export function outcomeGroup(decision) {
  const key = normalizeName(decision ?? '');
  if (!key) return null;
  return OUTCOME_BY_DECISION.get(key) ?? 'andere';
}

/** Letzter Beschluss des Stadtparlaments mit Beschlussart. */
export function parliamentDecision(record) {
  const entries = (record?.decisions ?? []).filter(
    (entry) => /stadtparlament/i.test(entry.body ?? '') && entry.decision,
  );
  return entries.length ? entries[entries.length - 1] : null;
}

/** Kompakte Rollenkennzahl einer Verfasserangabe. */
export function roleCode(author) {
  const role = String(author?.roleId ?? '');
  if (role.startsWith('erstunterzeichner')) return ROLE_FIRST;
  if (role.startsWith('mitunterzeichner')) return ROLE_CO;
  return ROLE_OTHER;
}

/**
 * Nachschlagewerk über die Personen: nach ID, nach Namensschlüssel und —
 * nur wo eindeutig — nach alphabetisch sortierten Namensbestandteilen.
 */
export function buildPersonIndex(people) {
  const byId = new Map();
  const byName = new Map();
  const looseCounts = new Map();

  for (const person of people ?? []) {
    if (person.id) byId.set(String(person.id), person);
    const key = personKey(person.name);
    if (key && !byName.has(key)) byName.set(key, person);
    const loose = looseKey(person.name);
    if (loose) looseCounts.set(loose, [...(looseCounts.get(loose) ?? []), person]);
  }

  const byLooseName = new Map();
  for (const [key, matches] of looseCounts) {
    if (matches.length === 1) byLooseName.set(key, matches[0]);
  }

  return { byId, byName, byLooseName };
}

/**
 * Löst eine Verfasserangabe auf eine Person auf.
 * @returns {{person: object|null, matchedBy: 'id'|'name'|'namensteile'|null}}
 */
export function resolveAuthor(author, index) {
  const id = author?.personId ? String(author.personId) : null;
  if (id && index.byId.has(id)) return { person: index.byId.get(id), matchedBy: 'id' };

  const exact = index.byName.get(personKey(author?.name));
  if (exact) return { person: exact, matchedBy: 'name' };

  const loose = index.byLooseName.get(looseKey(author?.name));
  if (loose) return { person: loose, matchedBy: 'namensteile' };

  return { person: null, matchedBy: null };
}

/**
 * Faktenzeile eines Geschäfts. Leere Felder entfallen, damit die Datei klein bleibt.
 * @param {object} record
 * @param {{index: object, unresolved?: Array, matchStats?: object}} context
 */
export function buildFact(record, { index, unresolved = [], matchStats = {} } = {}) {
  const decision = parliamentDecision(record);
  const fact = { i: String(record.id), y: record.year ?? null, t: record.typeId ?? null };

  if (record.statusId) fact.s = record.statusId;
  if (Number.isFinite(record.durationDays)) fact.d = record.durationDays;
  if (decision) {
    fact.o = outcomeGroup(decision.decision);
    fact.b = decision.decision;
  }

  const authors = [];
  for (const author of record.authors ?? []) {
    const { person, matchedBy } = resolveAuthor(author, index);
    if (!person) {
      unresolved.push({ inquiryId: String(record.id), name: author?.name ?? '' });
      continue;
    }
    matchStats[matchedBy] = (matchStats[matchedBy] ?? 0) + 1;
    authors.push([person.id, person.partyId ?? null, roleCode(author)]);
  }

  if (authors.length) {
    fact.a = authors;
    const first = authors.find((entry) => entry[2] === ROLE_FIRST) ?? authors[0];
    if (first[1]) fact.p = first[1];
  }

  return fact;
}

/** Abdeckung der Verfasserangaben je Jahr — Grundlage des Transparenzkastens. */
export function coverageByYear(facts) {
  const years = new Map();
  for (const fact of facts) {
    if (!fact.y) continue;
    const entry = years.get(fact.y) ?? { year: fact.y, total: 0, motions: 0, withAuthors: 0, withDuration: 0, withOutcome: 0 };
    entry.total++;
    if (MOTION_TYPE_IDS.includes(fact.t)) entry.motions++;
    if (fact.a?.length) entry.withAuthors++;
    if (Number.isFinite(fact.d)) entry.withDuration++;
    if (fact.o) entry.withOutcome++;
    years.set(fact.y, entry);
  }
  return [...years.values()].sort((a, b) => a.year - b.year);
}

/** Geschäftsarten mit Bezeichnung, Anzahl und Kennzeichnung als Vorstoss. */
export function collectTypes(records) {
  const types = new Map();
  for (const record of records) {
    if (!record.typeId) continue;
    const entry = types.get(record.typeId) ?? {
      id: record.typeId,
      label: record.type ?? record.typeId,
      motion: MOTION_TYPE_IDS.includes(record.typeId),
      count: 0,
    };
    entry.count++;
    types.set(record.typeId, entry);
  }
  return [...types.values()].sort((a, b) => b.count - a.count);
}

/** Personenangaben, die das Frontend für Bestenlisten braucht. */
function collectPeople(facts, index) {
  const used = new Set();
  for (const fact of facts) for (const author of fact.a ?? []) used.add(author[0]);

  const people = [];
  for (const id of used) {
    const person = index.byId.get(id);
    if (!person) continue;
    people.push({
      id,
      name: person.name,
      partyId: person.partyId ?? null,
      from: person.firstEntryDate ?? null,
      to: person.mandateEnd ?? null,
    });
  }
  return people.sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/**
 * Baut die Faktentabelle.
 * @param {{inquiries: Array<object>, people: Array<object>, meta: object,
 *   generatedAt?: string, seatsFrom?: number}} input
 */
export function buildFacts({ inquiries, people, meta, generatedAt, seatsFrom = 2000 } = {}) {
  const index = buildPersonIndex(people);
  const unresolved = [];
  const matchStats = {};

  const records = [...(inquiries ?? [])].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const facts = records.map((record) => buildFact(record, { index, unresolved, matchStats }));

  const years = facts.map((fact) => fact.y).filter(Boolean);
  const lastYear = years.length ? Math.max(...years) : seatsFrom;
  const seats = seatsByYear(people ?? [], { from: seatsFrom, to: lastYear });

  const parties = (meta?.parties ?? []).map((party) => ({
    id: party.id,
    abbr: party.abbr,
    name: party.name,
    color: party.color,
    order: party.order ?? 99,
    historical: Boolean(party.historical),
  }));

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: generatedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    generatedBy: 'scripts/build-inquiry-facts.mjs',
    description:
      'Kompakte Auswertungsbasis zu den politischen Geschäften. Ein Eintrag je Geschäft; ' +
      'die Feldnamen sind in "fields" beschrieben.',
    fields: {
      i: 'ID des Geschäfts (URL: https://parlament.winterthur.ch/politbusiness/<i>)',
      y: 'Jahr des Eingangs',
      t: 'Geschäftsart (siehe "types")',
      s: 'Status',
      d: 'Behandlungsdauer in Tagen',
      o: 'Gruppe der Beschlussart des Stadtparlaments (siehe "outcomeGroups")',
      b: 'Beschlussart des Stadtparlaments im Wortlaut',
      p: 'Partei der erstunterzeichnenden Person',
      a: 'Verfassende: [Personen-ID, Partei-ID, Rolle] — Rolle 1 = Erstunterzeichnung, 2 = Mitunterzeichnung, 3 = übrige',
    },
    motionTypeIds: MOTION_TYPE_IDS,
    outcomeGroups: OUTCOME_GROUPS,
    types: collectTypes(records),
    parties,
    people: collectPeople(facts, index),
    seats,
    coverage: coverageByYear(facts),
    dataQuality: {
      inquiries: facts.length,
      authorMentions: Object.values(matchStats).reduce((sum, value) => sum + value, 0),
      matchedBy: matchStats,
      unresolved,
      notes: [
        'Verfasserangaben führen nur Vorstösse; Verwaltungsgeschäfte bleiben ohne Partei.',
        'Vor 2002 enthält die Quelle praktisch keine Verfasserangaben.',
        'Die Quelle kennt keine Partei-Historie: Parteiwechsel werden rückwirkend der zuletzt erfassten Partei zugerechnet.',
        'Beschlussarten sind erst ab rund 2017 erfasst.',
        'Die Sitzzahlen je Jahr sind aus den Mandatsperioden abgeleitet und vor 2007 unvollständig.',
      ],
    },
    inquiries: facts,
  };
}

/** Serialisiert die Faktentabelle: ein Geschäft je Zeile. */
export function serializeFacts(database) {
  const { inquiries, ...header } = database;
  const lines = Object.entries(header).map(([key, value]) => `  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  lines.push(`  "inquiries": [\n${inquiries.map((fact) => `    ${JSON.stringify(fact)}`).join(',\n')}\n  ]`);
  return `{\n${lines.join(',\n')}\n}\n`;
}
