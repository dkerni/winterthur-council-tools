/**
 * Hilfsfunktionen für das i-web-CMS von parlament.winterthur.ch.
 *
 * Die Listenseiten rendern ihre Daten nicht nur als HTML, sondern liefern den
 * vollständigen Datensatz zusätzlich HTML-escaped als JSON im Attribut
 * `data-entities` einer `<table class="icms-dt">`. Das ist deutlich robuster zu
 * parsen als das gerenderte Markup und daher der bevorzugte Weg.
 *
 * Wichtig:
 *  - Ohne Browser-`User-Agent` liefert die Seite eine Fehlerseite
 *    («veraltete Browserversion»).
 *  - Die Seite ist ein öffentlicher Dienst: Requests laufen sequenziell mit
 *    Mindestabstand (Rate-Limit), inkl. Retry mit Backoff.
 */

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Safari/537.36';

export const BASE_URL = 'https://parlament.winterthur.ch';

const MIN_REQUEST_INTERVAL_MS = 350;
const REQUEST_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 4;

let lastRequestAt = 0;
let requestChain = Promise.resolve();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Lädt eine Seite als Text — sequenziell, mit Rate-Limit, Timeout und Retry.
 * @param {string} url absolute oder relative URL (relativ zu BASE_URL)
 * @param {{log?: (msg: string) => void}} [options]
 * @returns {Promise<string>} HTML-Quelltext
 */
export function fetchPage(url, options = {}) {
  const absolute = new URL(url, BASE_URL).href;
  // Alle Requests in einer Kette serialisieren, damit das Rate-Limit auch bei
  // parallelen Aufrufen greift.
  const task = requestChain.then(() => fetchWithRetry(absolute, options));
  requestChain = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

async function fetchWithRetry(url, { log } = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const wait = Math.max(0, lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now());
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'de-CH,de;q=0.9',
        },
      });

      if (res.status >= 500 || res.status === 429) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.ok) {
        // 4xx (ausser 429) sind nicht wiederholbar.
        const error = new Error(`HTTP ${res.status} für ${url}`);
        error.permanent = true;
        throw error;
      }

      const html = await res.text();
      if (html.length < 1000 && /veraltete?\s+browser/i.test(html)) {
        throw new Error('Browser-Weiche der Quellseite ausgelöst (User-Agent prüfen)');
      }
      return html;
    } catch (err) {
      lastError = err;
      if (err.permanent || attempt === MAX_ATTEMPTS) break;
      const backoff = 1000 * 2 ** (attempt - 1);
      if (log) log(`  ⚠ ${url}: ${err.message} — neuer Versuch in ${backoff} ms`);
      await sleep(backoff);
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(`Abruf fehlgeschlagen (${MAX_ATTEMPTS} Versuche): ${url} — ${lastError?.message}`);
}

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  eacute: 'é',
  egrave: 'è',
  ecirc: 'ê',
  agrave: 'à',
  ccedil: 'ç',
  ndash: '–',
  mdash: '—',
  laquo: '«',
  raquo: '»',
  shy: '',
};

/**
 * Dekodiert HTML-Entities (numerisch und die im CMS verwendeten benannten).
 * `&amp;` wird zuletzt aufgelöst, damit doppelt escapete Werte korrekt werden.
 */
export function decodeEntities(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : match,
    );
}

/**
 * Liest die `data-entities`-Attribute aller Tabellen einer Seite. Seiten mit
 * mehreren Listen (z.B. «Nächste» und «Letzte Sitzungen») liefern deshalb auch
 * mehrere Datensatz-Blöcke.
 * @param {string} html Seitenquelltext
 * @param {string} [tableId] optionale Tabellen-ID (z.B. `icmsTable-personList`)
 * @returns {Array<Array<object>>} je Tabelle ein Array von Datensätzen
 */
export function extractAllDataEntities(html, tableId) {
  const tables = [...html.matchAll(/<table\b[^>]*>/gi)].map((m) => m[0]);

  const candidates = tableId
    ? tables.filter((tag) => new RegExp(`id\\s*=\\s*["']${escapeRegExp(tableId)}["']`, 'i').test(tag))
    : tables;

  const blocks = [];
  for (const tag of candidates.length ? candidates : tables) {
    const match = tag.match(/data-entities\s*=\s*"([^"]*)"/i) || tag.match(/data-entities\s*=\s*'([^']*)'/i);
    if (!match) continue;
    try {
      const parsed = JSON.parse(decodeEntities(match[1]));
      if (Array.isArray(parsed)) blocks.push(parsed);
      // Das CMS verpackt Listen als `{"emptyColumns":[],"data":[…]}`.
      else if (parsed && Array.isArray(parsed.data)) blocks.push(parsed.data);
    } catch {
      // Nächste Tabelle probieren.
    }
  }
  return blocks;
}

/**
 * Liest das `data-entities`-Attribut der ersten passenden Tabelle.
 * @param {string} html Seitenquelltext
 * @param {string} [tableId] optionale Tabellen-ID (z.B. `icmsTable-personList`)
 * @returns {Array<object>} Datensätze (leer, wenn nichts gefunden wurde)
 */
export function extractDataEntities(html, tableId) {
  return extractAllDataEntities(html, tableId)[0] ?? [];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Entfernt Tags und normalisiert Whitespace. */
export function toText(html) {
  if (html == null) return '';
  return decodeEntities(
    String(html)
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|dd|dt|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Alle `href`-Werte eines HTML-Fragments. */
export function extractHrefs(html) {
  return [...String(html ?? '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => decodeEntities(m[1]));
}

/**
 * Zieht die numerische ID aus einer i-web-Referenz.
 * @param {string} html Fragment mit `<a href="/_rte/person/281225">…</a>`
 * @param {string} kind `person`, `partei`, `behoerde`, …
 * @returns {string|null}
 */
export function extractRefId(html, kind) {
  const pattern = new RegExp(`/_rte/${escapeRegExp(kind)}/(\\d+)`, 'i');
  const direct = String(html ?? '').match(pattern);
  if (direct) return direct[1];
  const fallback = String(html ?? '').match(/\/(?:behoerdenmitglieder|behoerden)\/(\d+)/i);
  return fallback ? fallback[1] : null;
}

/**
 * Sammelt Label/Wert-Paare einer Detailseite aus `<dt>/<dd>`- und
 * `<th>/<td>`-Strukturen.
 * @returns {Map<string, string>} Label (klein geschrieben) → Text
 */
export function extractLabeledFields(html) {
  const fields = new Map();
  const add = (label, value) => {
    const key = toText(label).replace(/[:*]/g, '').trim().toLowerCase();
    const text = toText(value);
    if (key && text && !fields.has(key)) fields.set(key, text);
  };

  for (const m of html.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi)) {
    add(m[1], m[2]);
  }
  for (const m of html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/gi)) {
    add(m[1], m[2]);
  }
  for (const m of html.matchAll(
    /<(?:span|div|strong|b)\b[^>]*class="[^"]*label[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|strong|b)>\s*<(?:span|div|p)\b[^>]*>([\s\S]*?)<\/(?:span|div|p)>/gi,
  )) {
    add(m[1], m[2]);
  }

  return fields;
}

/**
 * Sucht einen Feldwert über mehrere mögliche Labelschreibweisen.
 * @param {Map<string,string>} fields Ergebnis von `extractLabeledFields`
 * @param {string[]} labels mögliche Labels
 * @returns {string|null}
 */
export function pickField(fields, labels) {
  for (const label of labels) {
    const key = label.toLowerCase();
    if (fields.has(key)) return fields.get(key);
  }
  for (const [key, value] of fields) {
    if (labels.some((label) => key.startsWith(label.toLowerCase()))) return value;
  }
  return null;
}

/** Erste E-Mail-Adresse einer Seite (aus `mailto:`-Links). */
export function extractEmail(html) {
  const match = String(html ?? '').match(/mailto:([^"'?>\s]+)/i);
  return match ? decodeEntities(match[1]).trim() : null;
}

/**
 * Schweizer Datum (`31.12.2026`) oder ISO-Datum → ISO-Datum `YYYY-MM-DD`.
 * @returns {string|null}
 */
export function parseDate(value) {
  const text = toText(value);
  if (!text) return null;

  const swiss = text.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (swiss) {
    const [, d, m, y] = swiss;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  return null;
}

/** Vierstellige Jahreszahl aus einem Text (z.B. Geburtsjahr). */
export function parseYear(value) {
  const match = toText(value).match(/\b(1[89]\d{2}|20\d{2})\b/);
  return match ? Number(match[1]) : null;
}

/**
 * Adresse aus einem Textblock: erkennt `Strasse 1` + `8400 Winterthur`.
 * @returns {{street: string|null, zip: string|null, city: string|null}|null}
 */
export function parseAddress(text) {
  if (!text) return null;
  const lines = toText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\d{4})\s+(.+)$/);
    if (!match) continue;
    const previous = lines[i - 1] || '';
    const street = /\d/.test(previous) && previous.length < 60 ? previous : null;
    return { street, zip: match[1], city: match[2].trim() };
  }
  return null;
}
