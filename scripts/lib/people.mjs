/**
 * Personenverzeichnis des Stadtparlaments — reine Parser- und Aufbaulogik.
 *
 * Quelle ist die Seite `/stadtparlament/27428`. Sie liefert in **einem**
 * `data-entities`-Blob der Tabelle `icmsTable-personList` sämtliche jemals
 * erfassten Personen — aktive wie ausgeschiedene. Der Status-Filter der Seite
 * (Alle / Aktiv / Inaktiv) wirkt rein clientseitig; ein einziger Abruf genügt.
 *
 * Die Zuordnung zu einer Partei läuft über die **Partei-ID der Quelle**
 * (`/_rte/partei/<id>`, in `party-meta.json` als `sourceIds` hinterlegt), nicht
 * über den Parteinamen: Parteien wurden umbenannt (CVP → Die Mitte, Alternative
 * Liste → Alternative Linke), die ID blieb stabil.
 *
 * Dieses Modul greift nicht aufs Netz zu und ist vollständig testbar.
 */

import { BASE_URL, extractAllDataEntities, toText } from './icms.mjs';
import { normalizeName, splitNameLastFirst } from './normalize.mjs';

/** Pfad des Personenverzeichnisses. */
export const PEOPLE_LIST_PATH = '/stadtparlament/27428';

/** Tabelle mit den Personendaten. */
export const PEOPLE_TABLE_ID = 'icmsTable-personList';

/** Die Quelle führt laufende Mandate mit diesem Enddatum. */
export const OPEN_MANDATE_DATE = '9999-12-31';

/** Schema der abgelegten Personendaten. */
export const SCHEMA_VERSION = 1;

/** URL des Personenverzeichnisses. */
export function peopleListUrl() {
  return `${BASE_URL}${PEOPLE_LIST_PATH}`;
}

/** URL einer Personenseite. */
export function personUrl(id) {
  return id ? `${BASE_URL}/behoerdenmitglieder/${id}` : null;
}

/**
 * Vergleichsschlüssel eines Personennamens.
 *
 * Beide Quellen schreiben «Nachname Vorname»; der Schlüssel ist deshalb
 * reihenfolgeabhängig und damit eindeutiger als ein Token-Vergleich.
 */
export function personKey(name) {
  return normalizeName(name);
}

/**
 * Schlüssel aus alphabetisch sortierten Namensbestandteilen — Rückfall, falls
 * eine Quelle «Vorname Nachname» schreibt.
 */
export function looseKey(name) {
  return normalizeName(name).split(' ').filter(Boolean).sort().join(' ');
}

/** Ordnet die Quell-Partei-IDs aus `party-meta.json` den Partei-IDs zu. */
export function partyIdsBySource(meta) {
  const map = new Map();
  for (const party of meta?.parties ?? []) {
    for (const sourceId of party.sourceIds ?? []) map.set(String(sourceId), party.id);
  }
  return map;
}

/** Erster Treffer eines Attributs in einem HTML-Schnipsel. */
function refId(html, kind) {
  return new RegExp(`/_rte/${kind}/(\\d+)`).exec(String(html ?? ''))?.[1] ?? null;
}

/** Datum aus einem Sortierfeld; das Sentinel für laufende Mandate wird zu `null`. */
function mandateDate(value) {
  const text = String(value ?? '').trim();
  if (!text || text === OPEN_MANDATE_DATE) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

/**
 * Rohzeilen des Personenverzeichnisses.
 *
 * `extractAllDataEntities` liefert die Tabelle je nach Aufbau als Liste von
 * Zeilen oder als ein Objekt, dessen Werte die Zeilen sind — beides wird hier
 * auf eine Liste gebracht.
 * @param {string} html
 * @returns {Array<object>}
 */
export function parsePeopleRows(html) {
  const source = String(html ?? '');
  // Ohne die Tabelle würde `extractAllDataEntities` auf beliebige Tabellen der
  // Seite zurückfallen — deshalb die ausdrückliche Prüfung.
  if (!new RegExp(`id\\s*=\\s*["']${PEOPLE_TABLE_ID}["']`, 'i').test(source)) return [];

  const [block] = extractAllDataEntities(source, PEOPLE_TABLE_ID);
  if (!block) return [];

  // Die Quelle liefert die Zeilen teils als Liste, teils als Objekt mit
  // fortlaufenden Schlüsseln.
  const rows = Array.isArray(block) && block.length === 1 && block[0] && !('_nameVorname' in block[0]) ? Object.values(block[0]) : block;
  return Object.values(rows).filter((row) => row && typeof row === 'object');
}

/**
 * Baut einen Personendatensatz aus einer Rohzeile.
 * @param {object} row
 * @param {{partyBySource: Map<string, string>}} context
 * @returns {object|null}
 */
export function buildPerson(row, { partyBySource = new Map() } = {}) {
  const id = refId(row?._nameVorname, 'person');
  const name = toText(row?._nameVorname ?? '');
  if (!id || !name) return null;

  const { firstName, lastName } = splitNameLastFirst(name);
  const sourcePartyId = refId(row?._partei, 'partei');
  const firstEntryDate = mandateDate(row?.['_mandatPersonFirstDatumVon-sort']);
  const mandateStart = mandateDate(row?.['_mandatPersonDatumVon-sort']);
  const mandateEnd = mandateDate(row?.['_mandatPersonDatumBis-sort']);

  return {
    id,
    name,
    lastName,
    firstName,
    partyId: sourcePartyId ? partyBySource.get(sourcePartyId) ?? null : null,
    partySource: sourcePartyId ? { id: sourcePartyId, name: toText(row?._partei ?? '') } : null,
    partyFrom: sourcePartyId && partyBySource.has(sourcePartyId) ? 'quelle' : null,
    district: toText(row?.wahlkreis ?? '') || null,
    firstEntryDate: firstEntryDate ?? mandateStart,
    mandateStart: mandateStart ?? firstEntryDate,
    mandateEnd,
    active: !mandateEnd,
    url: personUrl(id),
  };
}

/**
 * Wendet manuelle Korrekturen aus `data/people-overrides.json` an.
 *
 * Zuordnung über die Personen-ID, ersatzweise über den normalisierten Namen.
 * @returns {{people: Array<object>, applied: number, unmatched: Array<object>}}
 */
export function applyPeopleOverrides(people, overrides) {
  const entries = overrides?.overrides ?? [];
  const byId = new Map(people.filter((person) => person.id).map((person) => [person.id, person]));
  const byName = new Map(people.map((person) => [personKey(person.name), person]));

  let applied = 0;
  const unmatched = [];
  for (const entry of entries) {
    const person = (entry.personId && byId.get(String(entry.personId))) || byName.get(personKey(entry.name));
    if (!person) {
      unmatched.push(entry);
      continue;
    }
    if (entry.partyId) {
      person.partyId = entry.partyId;
      person.partyFrom = 'korrektur';
      if (entry.note) person.partyNote = entry.note;
    }
    applied++;
  }

  return { people, applied, unmatched };
}

/** Sortierung: Nachname, dann Vorname. */
export function sortPeople(people) {
  return [...people].sort(
    (a, b) => a.lastName.localeCompare(b.lastName, 'de') || a.firstName.localeCompare(b.firstName, 'de'),
  );
}

/**
 * Näherungsweise Besetzung des Rats je Jahr und Partei.
 *
 * Grundlage ist die Spanne vom **ersten** Eintritt bis zum erfassten Austritt.
 * Unterbrüche sind in der Quelle nicht abgebildet und werden mitgezählt; wer
 * vor 2003 ausschied, fehlt im Verzeichnis ganz. Die Werte sind deshalb nur
 * eine Näherung — `complete` weist aus, ob das Total plausibel ist.
 *
 * @param {Array<object>} people
 * @param {{from: number, to: number, seats?: number, tolerance?: number, month?: number, day?: number}} options
 * @returns {Array<{year: number, total: number, complete: boolean, byParty: object}>}
 */
export function seatsByYear(people, { from, to, seats = 60, tolerance = 0.1, month = 6, day = 30 } = {}) {
  const years = [];
  const pad = (value) => String(value).padStart(2, '0');

  for (let year = from; year <= to; year++) {
    const reference = `${year}-${pad(month)}-${pad(day)}`;
    const present = people.filter(
      (person) =>
        person.firstEntryDate &&
        person.firstEntryDate <= reference &&
        (!person.mandateEnd || person.mandateEnd >= reference),
    );

    const byParty = {};
    for (const person of present) {
      const key = person.partyId ?? 'unbekannt';
      byParty[key] = (byParty[key] ?? 0) + 1;
    }

    years.push({
      year,
      total: present.length,
      complete: Math.abs(present.length - seats) <= seats * tolerance,
      byParty,
    });
  }

  return years;
}

/**
 * Baut die Personendatenbank.
 * @param {{html: string, meta: object, overrides?: object, generatedAt?: string}} input
 */
export function buildPeopleDatabase({ html, meta, overrides = null, generatedAt } = {}) {
  const partyBySource = partyIdsBySource(meta);
  const rows = parsePeopleRows(html);

  const parsed = rows.map((row) => buildPerson(row, { partyBySource })).filter(Boolean);
  const unique = new Map();
  for (const person of parsed) unique.set(person.id, person);

  const { people, applied, unmatched } = applyPeopleOverrides([...unique.values()], overrides);
  const sorted = sortPeople(people);

  const withoutParty = sorted.filter((person) => !person.partyId);
  const dates = sorted.map((person) => person.firstEntryDate).filter(Boolean).sort();

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: generatedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    generatedBy: 'scripts/scrape-people.mjs',
    source: BASE_URL,
    sources: { peopleList: peopleListUrl() },
    dataQuality: {
      total: sorted.length,
      active: sorted.filter((person) => person.active).length,
      withoutParty: withoutParty.length,
      overridesApplied: applied,
      overridesUnmatched: unmatched.map((entry) => entry.name ?? entry.personId ?? '?'),
      note:
        'Die Quelle führt je Person nur die zuletzt erfasste Partei; Parteiwechsel sind nicht ' +
        'historisiert. Wer vor 2003 aus dem Rat ausschied, fehlt im Verzeichnis.',
    },
    earliestEntryDate: dates[0] ?? null,
    people: sorted,
  };
}

/** Serialisiert die Personendatenbank: ein Datensatz je Zeile. */
export function serializePeople(database) {
  const { people, ...header } = database;
  const lines = [];
  for (const [key, value] of Object.entries(header)) {
    lines.push(`  ${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  }
  lines.push(`  "people": [\n${people.map((person) => `    ${JSON.stringify(person)}`).join(',\n')}\n  ]`);
  return `{\n${lines.join(',\n')}\n}\n`;
}
