/**
 * Parser für die politischen Geschäfte von parlament.winterthur.ch.
 *
 * Die Funktionen sind rein (HTML rein, Daten raus) und damit ohne Netzzugriff
 * testbar. Der Abruf liegt in `scripts/scrape-inquiries.mjs`.
 *
 * Eigenheiten der Quelle, die hier abgebildet sind:
 *  - Die Trefferliste liefert den **gesamten** Bestand in einem einzigen
 *    `data-entities`-JSON; es gibt keine Paginierung und das `_token` des
 *    Suchformulars wird nicht geprüft.
 *  - Die Liste verlinkt ein Geschäft als `/_rte/information/<id>`; dieselbe ID
 *    ist unter `/politbusiness/<id>` erreichbar.
 *  - Auf der Detailseite **wiederholen sich Feldnamen** (z.B. zweimal
 *    «Beschlussdatum Stadtparlament» für zwei Beratungsstufen). Diese Abfolge
 *    ist der Verlauf des Geschäfts und wird als `stages` vollständig behalten.
 *  - Nur zwei Zusatzsektionen: «Dokumente» (statische Tabelle) und «Sitzungen»
 *    (`data-entities`).
 */

import { createHash } from 'node:crypto';

import {
  BASE_URL,
  decodeEntities,
  extractAllDataEntities,
  extractLabeledFieldPairs,
  parseDate,
  toText,
} from './icms.mjs';

/** Pfad der Geschäftsübersicht. */
export const INQUIRY_LIST_PATH = '/politbusiness';

/** Präfix aller Felder des Suchformulars. */
const FORM = 'politische_geschaefte_suchformular';

/** Startdatum der Suche — früh genug für den gesamten Bestand (ab 2000). */
export const EARLIEST_START_DATE = '17.9.1800';

/** Wert des Statusfilters für abgeschlossene Geschäfte. */
export const CLOSED_STATUS_ID = 'erledigt';

/** Statustext, der ein Geschäft als abgeschlossen ausweist. */
export const CLOSED_STATUS = 'Erledigt';

/** Tabellen-IDs der Quelle. */
const LIST_TABLE_ID = 'icmsTable-geschaefteList';
const SESSION_TABLE_ID = 'icmsTableSitzungen';

/** Schema der abgelegten Datensätze. Eine Erhöhung erzwingt einen Vollabgleich. */
export const SCHEMA_VERSION = 1;

/**
 * URL der Trefferliste.
 * @param {{status?: string}} [options] `status` = Wert des Filters `statusId`
 * @returns {string}
 */
export function inquiryListUrl({ status = '' } = {}) {
  const params = new URLSearchParams([
    [`${FORM}[keyword]`, ''],
    [`${FORM}[nummer]`, ''],
    [`${FORM}[vomStart]`, EARLIEST_START_DATE],
    [`${FORM}[vomEnd]`, ''],
    [`${FORM}[statusId]`, status],
    [`${FORM}[searchBtn]`, ''],
  ]);
  return `${new URL(INQUIRY_LIST_PATH, BASE_URL).href}?${params}`;
}

/** Öffentliche Adresse eines Geschäfts. */
export function inquiryUrl(id) {
  return new URL(`${INQUIRY_LIST_PATH}/${id}`, BASE_URL).href;
}

/** Öffentliche Adresse einer Person (gleiche ID wie in `data/members.json`). */
export function personUrl(id) {
  return new URL(`/behoerdenmitglieder/${id}`, BASE_URL).href;
}

/** Öffentliche Adresse einer Sitzung. */
export function sessionUrl(id) {
  return new URL(`/sitzung/${id}`, BASE_URL).href;
}

/** Vergleichsform für Bezeichner: ohne Umlaute, klein, mit Bindestrichen. */
export function slugify(value) {
  return toText(value)
    .replace(/ä/gi, 'ae')
    .replace(/ö/gi, 'oe')
    .replace(/ü/gi, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Kleingeschriebener Feldname ohne Doppelpunkt. */
function labelKey(label) {
  return toText(label).replace(/[:*]/g, '').trim().toLowerCase();
}

/** Absolute URL aus einem (evtl. escapeten) href-Wert. */
function absoluteUrl(href) {
  if (!href) return null;
  try {
    return new URL(decodeEntities(href), BASE_URL).href;
  } catch {
    return null;
  }
}

/* ─── Trefferliste ─────────────────────────────────────────────────── */

/** Jahr aus ISO-Datum, ersatzweise aus der Geschäftsnummer (`2021.82`). */
export function inquiryYear(submittedDate, number) {
  const fromDate = /^(\d{4})-/.exec(submittedDate ?? '');
  if (fromDate) return Number(fromDate[1]);
  const fromNumber = /^(\d{4})\./.exec(toText(number));
  return fromNumber ? Number(fromNumber[1]) : null;
}

/**
 * Liest die Trefferliste (`/politbusiness?…`).
 *
 * Die Seite liefert alle Geschäfte als `data-entities`-JSON der Tabelle
 * `icmsTable-geschaefteList`.
 * @param {string} html Seitenquelltext
 * @returns {Array<{id: string, url: string, number: string|null, numberSort: string|null,
 *   title: string|null, type: string|null, submittedDate: string|null, year: number|null}>}
 */
export function parseInquiryList(html) {
  const blocks = extractAllDataEntities(html, LIST_TABLE_ID);
  const rows = [];
  const seen = new Set();

  for (const entities of blocks) {
    for (const entity of entities) {
      const titleHtml = String(entity.title ?? entity._title ?? '');
      const id = /\/(?:_rte\/information|politbusiness)\/(\d+)/.exec(titleHtml)?.[1];
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const number = toText(entity._nummer ?? entity.nummer ?? '') || null;
      const submittedDate = parseDate(entity['_geschaeftsdatum-sort'] ?? entity._geschaeftsdatum ?? '');

      rows.push({
        id,
        url: inquiryUrl(id),
        number,
        numberSort: toText(entity['_nummer-sort'] ?? '') || null,
        title: toText(titleHtml) || null,
        type: toText(entity._kategorieId ?? entity.kategorieId ?? '') || null,
        submittedDate,
        year: inquiryYear(submittedDate, number),
      });
    }
  }

  return rows;
}

/**
 * IDs aller Geschäfte einer gefilterten Trefferliste (z.B. `statusId=erledigt`).
 * @param {string} html
 * @returns {Set<string>}
 */
export function parseInquiryIds(html) {
  return new Set(parseInquiryList(html).map((row) => row.id));
}

/* ─── Detailseite ──────────────────────────────────────────────────── */

/** Markierung, ab der die Zusatzsektionen («Zugehörige Objekte») beginnen. */
const ACCORDION_MARKER = 'icms-accordion-container';

/**
 * Der Bereich der Detailseite mit den Angaben zum Geschäft. Die Quelle legt ihn
 * als `<div class="icms-desclist-container"><dl>…</dl></div>` an; fehlt der
 * Container, wird alles vor den Zusatzsektionen verwendet.
 */
function detailScope(html) {
  const source = String(html ?? '');
  const containers = [
    ...source.matchAll(/<div\b[^>]*class="[^"]*icms-desclist-container[^"]*"[^>]*>([\s\S]*?)<\/div>/gi),
  ].map((match) => match[1]);
  if (containers.length) return containers.join('\n');

  const head = source.split(ACCORDION_MARKER)[0];
  const lists = [...head.matchAll(/<dl\b[^>]*>[\s\S]*?<\/dl>/gi)].map((match) => match[0]);
  return lists.length ? lists.join('\n') : head;
}

/** Label/Wert-Paare des Geschäfts in Quellreihenfolge, inklusive Wiederholungen. */
export function parseFieldPairs(html) {
  return extractLabeledFieldPairs(detailScope(html));
}

/** Enthält der Wert ausschliesslich ein Datum? */
function isDateOnly(value) {
  const text = toText(value).trim();
  return (
    /^\d{1,2}\.\d{1,2}\.\d{4}$/.test(text) ||
    /^\d{4}-\d{2}-\d{2}$/.test(text) ||
    /^\d{1,2}\.\s*[A-Za-zÄÖÜäöü]+\.?\s+\d{4}$/.test(text)
  );
}

/**
 * Verlauf des Geschäfts: alle Label/Wert-Paare in Quellreihenfolge. Reine
 * Datumswerte werden zusätzlich als ISO-Datum abgelegt.
 * @param {string} html
 * @returns {Array<{label: string, value: string, date?: string}>}
 */
export function parseStages(html) {
  return parseFieldPairs(html).map(({ label, value }) => {
    const date = isDateOnly(value) ? parseDate(value) : null;
    return date ? { label, value, date } : { label, value };
  });
}

/** Trennt an Kommas ausserhalb von Klammern (Namen enthalten Rollen in Klammern). */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const char of String(text ?? '')) {
    if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * Verfasser und Beteiligte. Die Quelle schreibt «Nachname Vorname (Rolle)» und
 * trennt mit Komma; nur wenige Personen sind als `/_rte/person/<id>` verlinkt.
 * @param {string} html
 * @returns {Array<{name: string, lastName: string|null, firstName: string|null,
 *   role: string|null, roleId: string|null, personId: string|null, personUrl: string|null}>}
 */
export function parseAuthors(html) {
  const pair = parseFieldPairs(html).find((field) => labelKey(field.label).startsWith('verfasser'));
  if (!pair) return [];

  const personIds = new Map();
  for (const match of pair.html.matchAll(/<a\b[^>]*href="[^"]*\/_rte\/person\/(\d+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const name = toText(match[2]);
    if (name && !personIds.has(name)) personIds.set(name, match[1]);
  }

  return splitTopLevel(pair.value)
    .map((part) => {
      const match = /^([\s\S]*?)\s*\(([^)]*)\)\s*$/.exec(part);
      const name = toText(match ? match[1] : part).replace(/\s+/g, ' ').trim();
      if (!name) return null;

      const role = match ? toText(match[2]).trim() || null : null;
      // «Erstunterzeichner/-in» → `erstunterzeichner`; die Geschlechtsform ist
      // für Auswertungen unerheblich.
      const roleId = role ? slugify(role.replace(/\/-?in\.?$/i, '')) || null : null;
      const tokens = name.split(' ').filter(Boolean);
      const personId = personIds.get(name) ?? null;

      return {
        name,
        // Die Quelle schreibt «Nachname Vorname»; mehrteilige Nachnamen
        // («Frei Glowatz Katharina») kommen vor, mehrteilige Vornamen nicht.
        lastName: tokens.length > 1 ? tokens.slice(0, -1).join(' ') : name,
        firstName: tokens.length > 1 ? tokens[tokens.length - 1] : null,
        role,
        roleId,
        personId,
        personUrl: personId ? personUrl(personId) : null,
      };
    })
    .filter(Boolean);
}

/** Abschnitte der Zusatzsektionen («Dokumente», «Sitzungen»). */
function accordionSections(html) {
  const source = String(html ?? '');
  const marks = [...source.matchAll(/class="icms-accordion-title"[^>]*>\s*<a\b[^>]*>([\s\S]*?)<\/a>/gi)];
  return marks.map((match, index) => ({
    title: toText(match[1]),
    html: source.slice(match.index, index + 1 < marks.length ? marks[index + 1].index : source.length),
  }));
}

function findSection(html, title) {
  const wanted = slugify(title);
  return accordionSections(html).find((section) => slugify(section.title) === wanted) ?? null;
}

/**
 * Dokumente eines Geschäfts. Die Tabelle führt neben der sichtbaren Spalte
 * versteckte Spalten mit Name und ISO-Datum mit; beide werden bevorzugt genutzt.
 * @param {string} html
 * @returns {Array<{name: string|null, url: string|null, date: string|null,
 *   category: string|null, fileType: string|null, fileSize: string|null}>}
 */
export function parseDocuments(html) {
  const section = findSection(html, 'Dokumente');
  if (!section) return [];

  const body = /<tbody\b[^>]*>([\s\S]*?)<\/tbody>/i.exec(section.html);
  if (!body) return [];

  const documents = [];
  for (const row of body[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((cell) => cell[1]);
    if (!cells.length) continue;

    const first = toText(cells[0]);
    const link = /<a\b[^>]*href="([^"]+)"/i.exec(cells[0]);
    const title = /<a\b[^>]*title="([^"]*)"/i.exec(cells[0]);
    const name = toText(cells[3] ?? '') || toText(title?.[1] ?? '') || first.split('\n')[0].replace(/\s*\(.*$/, '');
    const fileInfo = /\(([A-Za-z0-9]{2,6}),\s*([^)]+)\)/.exec(first);

    documents.push({
      name: name || null,
      url: absoluteUrl(link?.[1]),
      date: parseDate(cells[4] ?? '') || parseDate(/Dokumentdatum:\s*([^\n]+)/i.exec(first)?.[1] ?? ''),
      category: /Kategorie:\s*(.+)/i.exec(first)?.[1]?.trim() || null,
      fileType: fileInfo ? fileInfo[1].toUpperCase() : null,
      fileSize: fileInfo ? fileInfo[2].trim() : null,
    });
  }

  return documents;
}

/**
 * Sitzungen, an denen das Geschäft traktandiert war.
 *
 * Der Sortierwert `_datum-sort` ist in der Quelle obfuskiert; das Datum wird
 * deshalb aus dem angezeigten Wert gelesen.
 * @param {string} html
 * @returns {Array<{id: string|null, name: string|null, date: string|null, url: string|null}>}
 */
export function parseSessions(html) {
  const source = String(html ?? '');
  // Ohne die Tabelle würde `extractAllDataEntities` auf beliebige Tabellen
  // der Seite zurückfallen — deshalb die ausdrückliche Prüfung.
  if (!new RegExp(`id="${SESSION_TABLE_ID}"`, 'i').test(source)) return [];

  const sessions = [];
  for (const entities of extractAllDataEntities(source, SESSION_TABLE_ID)) {
    for (const entity of entities) {
      const nameHtml = String(entity.name ?? entity._name ?? '');
      const id = /\/(?:_rte\/anlass|sitzung)\/(\d+)/.exec(nameHtml)?.[1] ?? null;
      const name = toText(nameHtml) || null;
      if (!id && !name) continue;
      sessions.push({ id, name, date: parseDate(entity._datum ?? entity.datum ?? ''), url: id ? sessionUrl(id) : null });
    }
  }
  return sessions;
}

/**
 * Abstimmungsresultat («55:0», «27:25 (3 Enthaltungen)», «einstimmig»).
 * @param {string} value
 * @returns {{raw: string, yes: number|null, no: number|null, abstentions: number|null, unanimous: boolean}|null}
 */
export function parseVoteResult(value) {
  const raw = toText(value).trim();
  if (!raw) return null;

  const result = { raw, yes: null, no: null, abstentions: null, unanimous: /einstimmig/i.test(raw) };

  const pair = /(\d+)\s*:\s*(\d+)/.exec(raw);
  if (pair) {
    result.yes = Number(pair[1]);
    result.no = Number(pair[2]);
  } else {
    // «29 Stimmen» nennt nur die Zustimmenden (z.B. vorläufige Unterstützung).
    const single = /^(\d+)\s*Stimmen/i.exec(raw);
    if (single) result.yes = Number(single[1]);
  }

  const abstentions = /(\d+)\s*Enthaltung/i.exec(raw);
  if (abstentions) result.abstentions = Number(abstentions[1]);

  return result;
}

/** Felder eines Beratungsschritts: «Beschlussdatum Stadtparlament» usw. */
const DECISION_FIELD = /^(Beschlussdatum|Beschlussart|Beschluss|Abstimmungsresultat)\s+(.+)$/i;

/**
 * Beratungsschritte aus dem Verlauf. Jedes «Beschlussdatum <Gremium>» eröffnet
 * einen Schritt; die folgenden Angaben desselben Gremiums gehören dazu.
 * @param {Array<{label: string, value: string, date?: string}>} stages
 * @returns {Array<{body: string, date: string|null, decision: string|null, vote: object|null}>}
 */
export function buildDecisions(stages) {
  const decisions = [];
  const open = new Map();

  for (const stage of stages ?? []) {
    const match = DECISION_FIELD.exec(stage.label);
    if (!match) continue;

    const kind = match[1].toLowerCase();
    const body = match[2].trim();

    let current = open.get(body);
    if (kind === 'beschlussdatum' || !current) {
      current = { body, date: null, decision: null, vote: null };
      decisions.push(current);
      open.set(body, current);
    }

    if (kind === 'beschlussdatum') current.date = stage.date ?? parseDate(stage.value);
    else if (kind === 'abstimmungsresultat') current.vote = parseVoteResult(stage.value);
    else current.decision = stage.value;
  }

  return decisions;
}

/** Feldnamen der benannten Einzeldaten. */
const DATE_FIELDS = [
  ['submitted', 'eingangsdatum'],
  ['deadline', 'frist für antrag / beantwortung bis'],
  ['answeredByCouncil', 'beantwortung durch stadtrat vom'],
  ['motion', 'antrag vom'],
  ['report', 'antrag und bericht vom'],
  ['assigned', 'zuweisung am'],
];

/** Erster Wert eines Feldes im Verlauf. */
function firstValue(stages, label) {
  const wanted = labelKey(label);
  return stages.find((stage) => labelKey(stage.label) === wanted)?.value ?? null;
}

/** Titel der Detailseite (letzte `<h1>`; davor stehen Kopfbereich-Titel). */
export function parseTitle(html) {
  const headings = [...String(html ?? '').matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) => toText(match[1]));
  return headings.filter(Boolean).pop() ?? null;
}

/** Tage zwischen zwei ISO-Daten. */
function daysBetween(from, to) {
  if (!from || !to) return null;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return Math.round((end - start) / 86400000);
}

/**
 * Ermittelt das Abschlussdatum eines Geschäfts samt Herkunft.
 *
 * Vor etwa 2017 nennt die Quelle bei den meisten Geschäften kein Beschlussdatum.
 * Für erledigte Geschäfte wird deshalb ersatzweise das jüngste Datum eines
 * Beschlussdokuments und zuletzt das jüngste Sitzungsdatum herangezogen.
 * Überweisungsbeschlüsse bleiben aussen vor, weil sie nur eine Zwischenstufe sind.
 * @param {{finalDecision?: string|null, closed?: boolean, documents?: Array<object>, sessions?: Array<object>}} input
 * @returns {{concluded: string|null, concludedSource: 'decision'|'document'|'session'|null}}
 */
export function resolveConclusion({ finalDecision = null, closed = false, documents = [], sessions = [] } = {}) {
  if (finalDecision) return { concluded: finalDecision, concludedSource: 'decision' };
  if (!closed) return { concluded: null, concludedSource: null };

  const documentDate = documents
    .filter((entry) => entry?.date && /beschluss/i.test(entry.category ?? '') && !/überweisung/i.test(entry.category ?? ''))
    .map((entry) => entry.date)
    .sort()
    .pop();
  if (documentDate) return { concluded: documentDate, concludedSource: 'document' };

  const sessionDate = sessions
    .filter((entry) => entry?.date)
    .map((entry) => entry.date)
    .sort()
    .pop();
  if (sessionDate) return { concluded: sessionDate, concludedSource: 'session' };

  return { concluded: null, concludedSource: null };
}

/** Inhaltsstempel: ändert sich nur bei inhaltlichen Änderungen. */
export function contentHash(record) {
  const { fetchedAt, contentHash: _ignored, ...content } = record;
  return createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 16);
}

/**
 * Baut den gespeicherten Datensatz eines Geschäfts.
 *
 * Die Trefferliste liefert Nummer, Titel, Art und Eingangsdatum bereits mit;
 * Angaben der Detailseite haben Vorrang, die Liste dient als Rückfall.
 * @param {{row: object, html: string, fetchedAt?: string}} input
 * @returns {object}
 */
export function buildRecord({ row, html, fetchedAt }) {
  const stages = parseStages(html);
  const decisions = buildDecisions(stages);

  const number = firstValue(stages, 'Nummer') || row?.number || null;
  const type = firstValue(stages, 'Geschäftsart') || row?.type || null;
  const status = firstValue(stages, 'Status');
  const submittedDate = parseDate(firstValue(stages, 'Eingangsdatum') ?? '') || row?.submittedDate || null;
  const title = row?.title || parseTitle(html);

  const dates = Object.fromEntries(DATE_FIELDS.map(([key, label]) => [key, parseDate(firstValue(stages, label) ?? '')]));
  dates.submitted = submittedDate;
  // Letzter Parlamentsbeschluss; ersatzweise der letzte Beschluss überhaupt.
  const parliamentDates = decisions.filter((entry) => /stadtparlament/i.test(entry.body) && entry.date).map((e) => e.date);
  const anyDates = decisions.filter((entry) => entry.date).map((entry) => entry.date);
  dates.finalDecision = (parliamentDates.length ? parliamentDates : anyDates).sort().pop() ?? null;

  const closed = slugify(status ?? '') === slugify(CLOSED_STATUS);
  const documents = parseDocuments(html);
  const sessions = parseSessions(html);
  const { concluded, concludedSource } = resolveConclusion({
    finalDecision: dates.finalDecision,
    closed,
    documents,
    sessions,
  });
  dates.concluded = concluded;

  const record = {
    id: String(row?.id ?? ''),
    url: inquiryUrl(row?.id),
    number,
    numberSort: row?.numberSort ?? null,
    year: inquiryYear(submittedDate, number),
    title: title || null,
    type,
    typeId: type ? slugify(type) : null,
    status: status || null,
    statusId: status ? slugify(status) : null,
    closed,
    submittedDate,
    authors: parseAuthors(html),
    stages,
    decisions,
    dates,
    concludedSource,
    durationDays: daysBetween(dates.submitted, dates.concluded),
    applicant: firstValue(stages, 'Antragsteller'),
    committee: firstValue(stages, 'Geschäft in Vorberatung bei'),
    remarks: firstValue(stages, 'Bemerkungen'),
    documents,
    sessions,
    fetchedAt: fetchedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  };

  record.contentHash = contentHash(record);
  return record;
}

/* ─── Abgleich ─────────────────────────────────────────────────────── */

/**
 * Bestimmt, welche Geschäfte abgerufen werden müssen.
 *
 * Abgerufen wird, was neu ist, was noch nicht erledigt ist, was wieder geöffnet
 * wurde, was sich in den Listenangaben geändert hat und was der Index führt,
 * ohne dass ein Datensatz vorliegt (fehlender oder beschädigter Shard).
 * `full` holt alles.
 * @param {{listRows: Array<object>, closedIds?: Set<string>|null, index?: object|null,
 *   storedIds?: Set<string>|null, full?: boolean}} input
 * @returns {{targets: Array<{row: object, reason: string}>, reasons: object, removed: string[]}}
 */
export function selectWorkSet({ listRows, closedIds = null, index = null, storedIds = null, full = false }) {
  const known = new Map((index?.inquiries ?? []).map((entry) => [entry.id, entry]));
  const listIds = new Set(listRows.map((row) => row.id));
  const reasons = { all: 0, new: 0, open: 0, reopened: 0, changed: 0, missing: 0 };
  const targets = [];

  const stale = full || !index || index.schemaVersion !== SCHEMA_VERSION;

  for (const row of listRows) {
    const entry = known.get(row.id);
    let reason = null;

    if (stale) reason = 'all';
    else if (!entry) reason = 'new';
    else if (storedIds && !storedIds.has(row.id)) reason = 'missing';
    else if (!entry.closed) reason = 'open';
    else if (closedIds && !closedIds.has(row.id)) reason = 'reopened';
    else if (entry.number !== row.number || entry.submittedDate !== row.submittedDate || entry.type !== row.type) {
      reason = 'changed';
    }

    if (reason) {
      targets.push({ row, reason });
      reasons[reason]++;
    }
  }

  return { targets, reasons, removed: [...known.keys()].filter((id) => !listIds.has(id)) };
}

/* ─── Ablage ───────────────────────────────────────────────────────── */

/** Dateiname des Jahres-Shards; Geschäfte ohne Jahr landen in `unbekannt.json`. */
export function shardName(year) {
  return `${year ?? 'unbekannt'}.json`;
}

/** Stabile Sortierung: nach Eingangsdatum, dann Nummer, dann ID. */
export function sortRecords(records) {
  return [...records].sort(
    (a, b) =>
      String(a.submittedDate ?? '').localeCompare(String(b.submittedDate ?? '')) ||
      String(a.numberSort ?? a.number ?? '').localeCompare(String(b.numberSort ?? b.number ?? '')) ||
      String(a.id).localeCompare(String(b.id)),
  );
}

/**
 * Gruppiert die Datensätze nach Jahr.
 * @param {Array<object>} records
 * @returns {Map<string, Array<object>>} Dateiname → Datensätze
 */
export function shardRecords(records) {
  const shards = new Map();
  for (const record of sortRecords(records)) {
    const file = shardName(record.year);
    if (!shards.has(file)) shards.set(file, []);
    shards.get(file).push(record);
  }
  return new Map([...shards.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

/** Häufigkeit je Ausprägung, alphabetisch sortiert. */
function countBy(records, pick) {
  const counts = {};
  for (const record of records) {
    const key = String(pick(record) ?? 'unbekannt');
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])));
}

/**
 * Baut den Index: schlanke Registry aller Geschäfte samt Kennzahlen.
 * @param {Array<object>} records
 * @param {object} meta zusätzliche Kopfangaben (generatedAt, source, lastFullSync …)
 * @returns {object}
 */
export function buildIndex(records, meta = {}) {
  const sorted = sortRecords(records);
  const shards = shardRecords(sorted);

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedBy: 'scripts/scrape-inquiries.mjs',
    ...meta,
    lastSubmittedDate: sorted.map((record) => record.submittedDate).filter(Boolean).sort().pop() ?? null,
    counts: {
      total: sorted.length,
      closed: sorted.filter((record) => record.closed).length,
      open: sorted.filter((record) => !record.closed).length,
      byYear: countBy(sorted, (record) => record.year),
      byType: countBy(sorted, (record) => record.type),
      byStatus: countBy(sorted, (record) => record.status),
    },
    years: [...shards.entries()].map(([file, entries]) => ({
      year: entries[0].year ?? null,
      file,
      count: entries.length,
      open: entries.filter((record) => !record.closed).length,
    })),
    inquiries: sorted.map((record) => ({
      id: record.id,
      number: record.number,
      year: record.year,
      type: record.type,
      status: record.status,
      submittedDate: record.submittedDate,
      closed: record.closed,
      contentHash: record.contentHash,
    })),
  };
}

/**
 * Serialisiert eine Sammlung als JSON mit **einer Zeile je Eintrag**. Das hält
 * die Dateien kompakt (~1 kB/Geschäft) und die Git-Diffs klein, weil eine
 * Änderung nur die betroffene Zeile berührt.
 * @param {object} header Kopfangaben
 * @param {string} key Name der Sammlung
 * @param {Array<object>} items
 * @returns {string}
 */
export function serializeCollection(header, key, items) {
  const head = Object.entries(header).map(([name, value]) => `  ${JSON.stringify(name)}: ${JSON.stringify(value)}`);
  const lines = items.map((item) => `    ${JSON.stringify(item)}`);
  return `{\n${[...head, `  ${JSON.stringify(key)}: [\n${lines.join(',\n')}\n  ]`].join(',\n')}\n}\n`;
}

/** Serialisiert den Index (`inquiries` als Registry). */
export function serializeIndex(index) {
  const { inquiries, ...header } = index;
  return serializeCollection(header, 'inquiries', inquiries);
}

/** Serialisiert einen Jahres-Shard. */
export function serializeShard({ year, records, generatedAt }) {
  return serializeCollection(
    {
      schemaVersion: SCHEMA_VERSION,
      generatedBy: 'scripts/scrape-inquiries.mjs',
      generatedAt,
      year: year ?? null,
      count: records.length,
    },
    'inquiries',
    records,
  );
}
