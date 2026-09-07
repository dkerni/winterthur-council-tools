/**
 * Parser für Sitzungen und Traktanden von parlament.winterthur.ch.
 *
 * Die Funktionen in dieser Datei sind rein (HTML rein, Daten raus) und damit
 * ohne Netzzugriff testbar. Der Abruf selbst liegt in
 * `scripts/scrape-agenda.mjs`.
 *
 * Das i-web-CMS liefert Listen bevorzugt als `data-entities`-JSON; ist das
 * nicht vorhanden (oder anders benannt), wird die gerenderte Tabelle geparst.
 * Beide Wege sind hier umgesetzt, damit kleine Änderungen an der Quelle den
 * Ablauf nicht sofort brechen.
 */

import {
  BASE_URL,
  decodeEntities,
  extractAllDataEntities,
  extractLabeledFields,
  pickField,
  toText,
} from './icms.mjs';

/** Pfad der Sitzungsübersicht. */
export const SESSION_LIST_PATH = '/sitzung';

/** Spalten der Traktandenliste (Reihenfolge wie im Excel). */
export const AGENDA_COLUMNS = [
  'Nr.',
  'Geschäft',
  'Geschäftart',
  'Bezeichnung',
  'Zuständig Fraktion',
  'Resultat Kommission',
  'Entscheid Fraktion',
  'Votum',
  'Bemerkungen',
];

/** Grösse des Textfensters um einen Sitzungslink (Zeichen). */
const MAX_CONTEXT = 400;

/** Vergleichsform eines Feldnamens (ohne Unterstriche, Umlaute, Satzzeichen). */
function normalizeKey(value) {
  return String(value ?? '')
    .replace(/ä/gi, 'ae')
    .replace(/ö/gi, 'oe')
    .replace(/ü/gi, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Liest ein Feld aus einem `data-entities`-Datensatz. Verglichen wird
 * unabhängig von Schreibweise, Unterstrichen und Umlauten; zusätzlich zählt
 * ein Treffer als Teilstring (z.B. `_geschaeftsart` für `geschaeftsart`).
 * @param {object} entity
 * @param {string[]} names Kandidaten in absteigender Priorität
 * @returns {string} roher (HTML-)Wert oder ''
 */
export function pickEntityField(entity, names) {
  if (!entity || typeof entity !== 'object') return '';
  const keys = Object.keys(entity);
  for (const name of names) {
    const wanted = normalizeKey(name);
    const exact = keys.find((key) => normalizeKey(key) === wanted);
    if (exact && entity[exact] != null && String(entity[exact]).trim() !== '') return String(entity[exact]);
  }
  for (const name of names) {
    const wanted = normalizeKey(name);
    const partial = keys.find((key) => normalizeKey(key).includes(wanted));
    if (partial && entity[partial] != null && String(entity[partial]).trim() !== '') return String(entity[partial]);
  }
  return '';
}

const MONTHS = new Map(
  [
    ['januar', 1],
    ['februar', 2],
    ['marz', 3],
    ['april', 4],
    ['mai', 5],
    ['juni', 6],
    ['juli', 7],
    ['august', 8],
    ['september', 9],
    ['oktober', 10],
    ['november', 11],
    ['dezember', 12],
  ].map(([name, number]) => [name, number]),
);

function iso(year, month, day) {
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/**
 * Findet alle Datumsangaben in einem Text (ISO, `21.09.2026`, `21. September 2026`).
 * @param {string} value
 * @returns {string[]} ISO-Daten in Reihenfolge des Auftretens, ohne Duplikate
 */
export function extractDates(value) {
  const text = toText(value);
  const found = [];

  for (const match of text.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) {
    found.push(iso(Number(match[1]), Number(match[2]), Number(match[3])));
  }
  for (const match of text.matchAll(/(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{2,4})/g)) {
    const year = Number(match[3]);
    found.push(iso(year < 100 ? 2000 + year : year, Number(match[2]), Number(match[1])));
  }
  for (const match of text.matchAll(/(\d{1,2})\.\s*([A-Za-zÄÖÜäöü]+)\s+(\d{4})/g)) {
    const month = MONTHS.get(normalizeKey(match[2]));
    if (month) found.push(iso(Number(match[3]), month, Number(match[1])));
  }

  return [...new Set(found.filter(Boolean))].sort();
}

/** Absolute URL zu einer Sitzung. */
export function sessionUrl(id) {
  return new URL(`/sitzung/${id}`, BASE_URL).href;
}

/**
 * Verweise auf eine Sitzung. Die Übersicht verlinkt Sitzungen als
 * `/_rte/anlass/<id>` (interner Referenzpfad des CMS); dieselbe Sitzung ist
 * unter `/sitzung/<id>` erreichbar. Beide Formen werden erkannt.
 */
const SESSION_HREF = /\/(?:_rte\/)?(?:anlass|sitzung)\/(\d+)/;

/**
 * Erste Sitzungsreferenz in einem Text (HTML-Fragment, Attribut, JSON-Wert).
 * @param {string} value
 * @returns {{id: string, sourceUrl: string}|null}
 */
function firstSessionRef(value) {
  const match = String(value ?? '').match(SESSION_HREF);
  if (!match) return null;
  try {
    return { id: match[1], sourceUrl: new URL(match[0], BASE_URL).href };
  } catch {
    return null;
  }
}

/** Feldnamen des Sitzungsorts in Quelle und Detailseite. */
const LOCATION_FIELDS = ['ort', 'sitzungsort', 'veranstaltungsort', 'lokalitaet', 'lokal', 'raum', 'saal'];

/**
 * Liest die Sitzungsübersicht (`/sitzung`).
 *
 * Die Seite liefert die Listen als `data-entities`-JSON («Nächste Sitzungen»
 * und «Letzte Sitzungen»); die Tabellenkörper bleiben leer, weil das CMS die
 * Zeilen erst im Browser rendert. Ausgewertet werden deshalb alle Tabellen —
 * zusätzlich (als Fallback) allfällige gerenderte Links.
 *
 * @param {string} html Quelltext der Übersichtsseite
 * @returns {Array<{id: string, url: string, sourceUrl: string, title: string, dates: string[], date: string|null, location: string|null}>}
 *   Sitzungen, aufsteigend nach Datum (Sitzungen ohne Datum am Schluss)
 */
export function parseSessionList(html) {
  const sessions = new Map();

  const addSession = (ref, title, dates, location) => {
    if (!ref) return;
    const existing = sessions.get(ref.id);
    const mergedDates = [...new Set([...(existing?.dates ?? []), ...dates])].sort();
    sessions.set(ref.id, {
      id: ref.id,
      url: sessionUrl(ref.id),
      sourceUrl: existing?.sourceUrl || ref.sourceUrl,
      title: existing?.title || title || `Sitzung ${ref.id}`,
      dates: mergedDates,
      date: mergedDates[0] ?? null,
      location: existing?.location || location || null,
    });
  };

  for (const entities of extractAllDataEntities(html)) {
    for (const entity of entities) {
      const values = Object.values(entity).map((value) => String(value ?? ''));
      const ref = firstSessionRef(values.join(' '));
      const title =
        toText(pickEntityField(entity, ['titel', 'bezeichnung', 'name', 'sitzung', 'gremium'])) || '';
      const dateSource = pickEntityField(entity, ['datum', 'sitzungsdatum', 'beginn', 'von', 'termin']);
      const dates = extractDates(dateSource || values.join(' '));
      addSession(ref, title, dates, singleLine(pickEntityField(entity, LOCATION_FIELDS)));
    }
  }

  // Fallback bzw. Ergänzung: gerenderte Links auf Sitzungsseiten. Als Kontext
  // für das Datum dient der Abschnitt zwischen dem vorherigen und dem nächsten
  // Sitzungslink — bei Doppelsitzungen stehen dort beide Daten.
  const links = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ match, ref: firstSessionRef(decodeEntities(match[1])) }))
    .filter((entry) => entry.ref);

  links.forEach(({ match, ref }, index) => {
    const previous = links[index - 1]?.match;
    const next = links[index + 1]?.match;
    const previousEnd = previous ? previous.index + previous[0].length : 0;
    const nextStart = next ? next.index : html.length;
    const linkEnd = match.index + match[0].length;

    // Zuerst der Abschnitt vor dem Link (übliche Darstellung: Datum, dann Link);
    // erst wenn dort kein Datum steht, der Abschnitt danach.
    const before = html.slice(Math.max(previousEnd, match.index - MAX_CONTEXT), linkEnd);
    const after = html.slice(linkEnd, Math.min(nextStart, linkEnd + MAX_CONTEXT));
    const dates = extractDates(before);
    addSession(ref, toText(match[2]), dates.length ? dates : extractDates(after), null);
  });

  return [...sessions.values()].sort((a, b) => {
    if (a.date && b.date) return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
    if (a.date) return -1;
    if (b.date) return 1;
    return a.id.localeCompare(b.id);
  });
}


/**
 * Wählt die nächste Sitzung: die früheste, die nicht in der Vergangenheit liegt.
 * Sitzungen ohne erkennbares Datum werden nur verwendet, wenn überhaupt keine
 * Sitzung ein Datum trägt — sonst würde eine undatierte vergangene Sitzung
 * eine datierte Liste verdrängen.
 * @param {Array<object>} sessions Ergebnis von `parseSessionList`
 * @param {Date} [now]
 * @returns {object|null}
 */
export function selectNextSession(sessions, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const upcoming = sessions.filter((session) => session.date && session.date >= today);
  if (upcoming.length) return upcoming[0];
  if (sessions.some((session) => session.date)) return null;
  return sessions.find((session) => !session.date) ?? null;
}

/** Höchstlänge einer Ortsangabe (schützt vor Fehlgriffen im Markup). */
const MAX_LOCATION_LENGTH = 120;

/**
 * Angaben, die nur die Sitzungsseite selbst führt — zurzeit der Sitzungsort.
 * Die Quelle stellt ihn als Label/Wert-Paar dar («Ort: Grosser Rathaussaal»).
 * @param {string} html Quelltext von `/sitzung/<id>`
 * @returns {{location: string|null}}
 */
export function parseSessionDetails(html) {
  const value = pickField(extractLabeledFields(String(html ?? '')), LOCATION_FIELDS) ?? '';
  const location = singleLine(value);
  return { location: location && location.length <= MAX_LOCATION_LENGTH ? location : null };
}

/* ─── Traktanden ───────────────────────────────────────────────────── */

const NUMBER_FIELDS = ['traktandumnummer', 'traktandumnr', 'nummer', 'nr', 'traktandum', 'position'];
const BUSINESS_FIELDS = ['geschaeftsnummer', 'geschaeftnr', 'geschaeft', 'geschaefte', 'gnr'];
const TYPE_FIELDS = ['geschaeftsart', 'geschaeftart', 'art', 'typ'];
const LABEL_FIELDS = ['bezeichnung', 'titel', 'betreff', 'thema', 'text'];

/** Erste absolute URL aus einem HTML-Fragment (Geschäftslink). */
function firstLink(html) {
  const match = String(html ?? '').match(/href\s*=\s*["']([^"']+)["']/i);
  if (!match) return null;
  const href = decodeEntities(match[1]);
  if (/^(mailto:|javascript:|#)/i.test(href)) return null;
  try {
    return new URL(href, BASE_URL).href;
  } catch {
    return null;
  }
}

/**
 * Zellwert für die Tabelle: eine Zeile. Die Quelle bricht Einträge um
 * (`<br>`, Absätze, Aufzählungen) — im Excel gehört das in eine Zelle.
 */
function singleLine(value) {
  return toText(value).replace(/\s+/g, ' ').trim();
}

function makeItem(number, businessHtml, type, label) {
  return {
    number: singleLine(number),
    business: singleLine(businessHtml),
    businessUrl: firstLink(businessHtml),
    type: singleLine(type),
    label: singleLine(label),
  };
}

function isUsableItem(item) {
  return Boolean(item.number || item.business || item.label);
}

/**
 * Liest die Traktanden einer Sitzungsseite.
 *
 * Die Sitzungsseite rendert die Traktanden serverseitig als Tabelle
 * (`<tr id="traktanden_…">`); das Blättern übernimmt erst im Browser das
 * Tabellen-Skript. Ein einzelner Abruf liefert deshalb alle Traktanden, auch
 * wenn die Liste im Browser mehrseitig erscheint. Liefert eine Seite dennoch
 * `data-entities`, wird dieses bevorzugt.
 *
 * @param {string} html Quelltext einer Seite von `/sitzung/<id>`
 * @returns {Array<{number: string, business: string, businessUrl: string|null, type: string, label: string}>}
 */
export function parseAgendaItems(html) {
  for (const entities of extractAllDataEntities(html)) {
    const fromEntities = entities
      .map((entity) =>
        makeItem(
          pickEntityField(entity, NUMBER_FIELDS),
          pickEntityField(entity, BUSINESS_FIELDS),
          pickEntityField(entity, TYPE_FIELDS),
          pickEntityField(entity, LABEL_FIELDS),
        ),
      )
      .filter(isUsableItem);
    if (fromEntities.length) return fromEntities;
  }

  return parseAgendaTables(html);
}

/** Traktanden-Zeilen der Sitzungsseite: `<tr id="traktanden_88649">`. */
const AGENDA_ROW_ID = /<tr\b[^>]*\bid\s*=\s*["']traktanden[_-]/i;

/**
 * Öffnende und schliessende Tabellen-Tags eines Fragments.
 * @param {string} html
 * @returns {Generator<{closing: boolean, name: string, start: number, end: number}>}
 */
function* tableTags(html) {
  for (const match of String(html).matchAll(/<(\/?)\s*(table|tr|td|th)\b[^>]*>/gi)) {
    yield {
      closing: match[1] === '/',
      name: match[2].toLowerCase(),
      start: match.index,
      end: match.index + match[0].length,
    };
  }
}

/**
 * Inhalt aller Tabellen einer Seite — auch der verschachtelten.
 *
 * Traktanden führen ihre Dokumente in einer Tabelle innerhalb der Zelle
 * «Bezeichnung». Eine nicht-gierige Suche (`<table>…</table>`) endet dort am
 * ersten `</table>` und verliert den Rest der äusseren Tabelle; deshalb werden
 * die Tags gezählt.
 *
 * @param {string} html
 * @returns {string[]} Inhalte, äussere Tabellen vor ihren inneren
 */
function collectTables(html) {
  const tables = [];
  let depth = 0;
  let start = -1;

  for (const tag of tableTags(html)) {
    if (tag.name !== 'table') continue;
    if (!tag.closing) {
      if (depth === 0) start = tag.end;
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0 && start >= 0) {
        const inner = html.slice(start, tag.start);
        tables.push(inner, ...collectTables(inner));
        start = -1;
      }
    }
  }

  // Nicht geschlossene Tabelle (abgeschnittenes HTML): Rest mitnehmen.
  if (depth > 0 && start >= 0) {
    const inner = html.slice(start);
    tables.push(inner, ...collectTables(inner));
  }

  return tables;
}

/**
 * Zeilen einer Tabelle. Zeilen verschachtelter Tabellen gehören zur Zelle, in
 * der sie stehen, und zählen hier nicht.
 * @param {string} tableHtml Inhalt einer Tabelle
 * @returns {string[]} Zeilen samt `<tr …>`-Tag
 */
function splitRows(tableHtml) {
  const rows = [];
  let nested = 0;
  let start = -1;

  for (const tag of tableTags(tableHtml)) {
    if (tag.name === 'table') {
      nested = tag.closing ? Math.max(0, nested - 1) : nested + 1;
      continue;
    }
    if (nested > 0 || tag.name !== 'tr') continue;
    if (!tag.closing) {
      // Fehlendes `</tr>` in der Quelle: Zeile endet beim nächsten `<tr>`.
      if (start >= 0) rows.push(tableHtml.slice(start, tag.start));
      start = tag.start;
    } else if (start >= 0) {
      rows.push(tableHtml.slice(start, tag.end));
      start = -1;
    }
  }
  if (start >= 0) rows.push(tableHtml.slice(start));

  return rows;
}

/**
 * Zellen einer Zeile. Verschachtelte Tabellen bleiben im Inhalt der Zelle, in
 * der sie stehen — ihre Zellen werden nicht als eigene Spalten gezählt.
 * @param {string} rowHtml Zeile samt `<tr …>`-Tag
 * @returns {string[]} Zellinhalte
 */
function splitCells(rowHtml) {
  const cells = [];
  let nested = 0;
  let start = -1;

  for (const tag of tableTags(rowHtml)) {
    if (tag.name === 'table') {
      nested = tag.closing ? Math.max(0, nested - 1) : nested + 1;
      continue;
    }
    if (nested > 0 || (tag.name !== 'td' && tag.name !== 'th')) continue;
    if (!tag.closing) {
      // Fehlendes `</td>`: Zelle endet beim nächsten `<td>`/`<th>`.
      if (start >= 0) cells.push(rowHtml.slice(start, tag.start));
      start = tag.end;
    } else if (start >= 0) {
      cells.push(rowHtml.slice(start, tag.start));
      start = -1;
    }
  }
  if (start >= 0) cells.push(rowHtml.slice(start));

  return cells;
}

/**
 * Entfernt verschachtelte Tabellen aus einem Zellinhalt. In der Zelle
 * «Bezeichnung» hängt die Quelle die Dokumentenliste des Geschäfts an; die
 * gehört weder in den Zelltext noch liefert sie den Geschäftslink.
 * @param {string} html
 * @returns {string}
 */
function withoutTables(html) {
  let result = '';
  let depth = 0;
  let cursor = 0;

  for (const tag of tableTags(html)) {
    if (tag.name !== 'table') continue;
    if (!tag.closing) {
      if (depth === 0) result += html.slice(cursor, tag.start);
      depth++;
    } else if (depth > 0) {
      depth--;
      if (depth === 0) cursor = tag.end;
    }
  }
  if (depth === 0) result += html.slice(cursor);

  return result;
}

/**
 * Fallback: gerenderte Tabellen der Sitzungsseite auswerten.
 *
 * Die Sitzungsseite enthält neben den Traktanden weitere Tabellen (Dokumente,
 * Kontakte). Sind Traktanden-Zeilen erkennbar, zählen nur deren Tabellen.
 */
function parseAgendaTables(html) {
  const items = [];

  const bodies = collectTables(html).map((body) => ({ body, rows: splitRows(body) }));
  const agendaBodies = bodies.filter((entry) => entry.rows.some((row) => AGENDA_ROW_ID.test(row)));

  for (const entry of agendaBodies.length ? agendaBodies : bodies) {
    const rows = entry.rows.map((row) => splitCells(row).map(withoutTables));
    if (rows.length < 2) continue;

    const header = rows[0].map((cell) => normalizeKey(toText(cell)));
    const used = new Set();
    // Erst exakte Überschriften zuordnen, dann Teiltreffer — sonst würde
    // «Geschäftsart» die Spalte «Geschäft» besetzen.
    const indexOf = (candidates) => {
      const names = candidates.map(normalizeKey);
      const find = (predicate) => header.findIndex((label, index) => label && !used.has(index) && predicate(label));
      const exact = find((label) => names.includes(label));
      const index = exact >= 0 ? exact : find((label) => names.some((name) => label.includes(name)));
      if (index >= 0) used.add(index);
      return index;
    };

    const numberIndex = indexOf(NUMBER_FIELDS);
    const businessIndex = indexOf(BUSINESS_FIELDS);
    const typeIndex = indexOf(TYPE_FIELDS);
    const labelIndex = indexOf(LABEL_FIELDS);
    if (numberIndex < 0 && businessIndex < 0) continue;

    for (const cells of rows.slice(1)) {
      if (!cells.length) continue;
      const item = makeItem(
        numberIndex >= 0 ? cells[numberIndex] : '',
        businessIndex >= 0 ? cells[businessIndex] : '',
        typeIndex >= 0 ? cells[typeIndex] : '',
        labelIndex >= 0 ? cells[labelIndex] : '',
      );
      if (isUsableItem(item)) items.push(item);
    }
  }

  return items;
}

/**
 * Sammelt Links auf weitere Traktandenseiten derselben Sitzung
 * (Blätterfunktion der Quelle).
 * @param {string} html Quelltext der Sitzungsseite
 * @param {string} pageUrl URL, zu der das HTML gehört
 * @returns {string[]} absolute URLs weiterer Seiten (ohne die eigene)
 */
export function findPaginationLinks(html, pageUrl) {
  const current = new URL(pageUrl, BASE_URL);
  const links = new Set();

  for (const match of String(html).matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    let target;
    try {
      target = new URL(decodeEntities(match[1]), current);
    } catch {
      continue;
    }
    if (target.pathname !== current.pathname) continue;
    if (!target.search) continue;
    // Nur Blätter-Parameter berücksichtigen (page, seite, offset, start …).
    const isPaging = [...target.searchParams.keys()].some((key) =>
      /(page|seite|offset|start|von|index)/i.test(key),
    );
    if (!isPaging) continue;
    target.hash = '';
    if (target.href !== current.href) links.add(target.href);
  }

  return [...links];
}

/**
 * Entfernt doppelte Traktanden (gleiche Seite mehrfach geladen, überlappende
 * Blätterbereiche) und behält die ursprüngliche Reihenfolge.
 * @param {Array<object>} items
 * @returns {Array<object>}
 */
export function dedupeAgendaItems(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = [item.number, item.business, item.businessUrl ?? '', item.label].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/** Sortierschlüssel eines Traktandums (numerisch, wo möglich). */
function numberKey(item) {
  const parts = String(item.number).match(/\d+/g);
  return parts ? parts.map(Number) : null;
}

/**
 * Sortiert Traktanden nach Nummer; Einträge ohne Nummer bleiben am Schluss in
 * ursprünglicher Reihenfolge.
 * @param {Array<object>} items
 * @returns {Array<object>}
 */
export function sortAgendaItems(items) {
  return items
    .map((item, index) => ({ item, index, key: numberKey(item) }))
    .sort((a, b) => {
      if (a.key && b.key) {
        const length = Math.max(a.key.length, b.key.length);
        for (let i = 0; i < length; i++) {
          const diff = (a.key[i] ?? -1) - (b.key[i] ?? -1);
          if (diff !== 0) return diff;
        }
        return a.index - b.index;
      }
      if (a.key) return -1;
      if (b.key) return 1;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

/**
 * Zeilen für das Excel: die vier gelesenen Spalten, die übrigen bleiben leer.
 * @param {Array<object>} items
 * @returns {Array<Array<string|{text: string, link: string|null}>>}
 */
export function toWorkbookRows(items) {
  return items.map((item) => [
    item.number,
    item.businessUrl ? { text: item.business || item.businessUrl, link: item.businessUrl } : item.business,
    item.type,
    item.label,
    '',
    '',
    '',
    '',
    '',
  ]);
}

/** ISO-Datum als Schweizer Datum (`2026-09-21` → `21.09.2026`). */
export function formatSwissDate(isoDate) {
  const [year, month, day] = String(isoDate ?? '').split('-');
  return year && month && day ? `${day}.${month}.${year}` : String(isoDate ?? '');
}

/** Aufzählung der Sitzungsdaten, z.B. «21.09.2026 und 05.10.2026». */
function listDates(session) {
  const dates = (session?.dates?.length ? session.dates : [session?.date]).filter(Boolean).map(formatSwissDate);
  if (!dates.length) return '';
  if (dates.length === 1) return dates[0];
  return `${dates.slice(0, -1).join(', ')} und ${dates[dates.length - 1]}`;
}

/**
 * Kopfzeilen der Arbeitsmappe: Titel, Datum und Ort der Sitzung sowie der Link
 * auf die Sitzungsseite. Fehlende Angaben werden weggelassen.
 * @param {{title?: string, url?: string, date?: string|null, dates?: string[], location?: string|null}} session
 * @returns {Array<{text: string, link?: string}>}
 */
export function agendaTitleLines(session) {
  const dates = listDates(session);
  const facts = [dates ? `Sitzung vom ${dates}` : 'Sitzung', session?.location ? `Ort: ${session.location}` : '']
    .filter(Boolean)
    .join('   ·   ');

  const lines = [{ text: session?.title ? `Traktandenliste – ${session.title}` : 'Traktandenliste' }, { text: facts }];
  if (session?.url) {
    let host = 'parlament.winterthur.ch';
    try {
      host = new URL(session.url).host;
    } catch {
      // Unbrauchbare Adresse: Standardhost im Text belassen.
    }
    lines.push({ text: `Sitzung auf ${host} öffnen`, link: session.url });
  }
  return lines;
}
