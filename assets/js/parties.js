/**
 * Parteien & Fraktionen — Stammdaten aus `data/party-meta.json`.
 *
 * Einzige Quelle für Reihenfolge (rechts → links), Farben und Kurznamen.
 * Die Farben werden zusätzlich als CSS-Custom-Properties (`--party-<id>`)
 * gespiegelt, damit auch reines CSS damit arbeiten kann.
 */

import { fetchJson } from './access.js';

let metaPromise = null;

/**
 * Lädt `data/party-meta.json` (einmalig, Promise-Cache).
 * @returns {Promise<{parties: Array, fractions: Array}>}
 */
export function loadPartyMeta() {
  if (!metaPromise) {
    metaPromise = fetchJson('data/party-meta.json').catch((err) => {
      metaPromise = null;
      throw err;
    });
  }
  return metaPromise;
}

/** Normalisiert eine Bezeichnung für den Vergleich (Kleinschreibung, ohne Sonderzeichen). */
export function normalizeLabel(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matches(entry, label) {
  const needle = normalizeLabel(label);
  if (!needle) return false;
  const candidates = [entry.id, entry.abbr, entry.shortName, entry.name, ...(entry.aliases || [])];
  return candidates.some((c) => c && normalizeLabel(c) === needle);
}

/** Findet eine Partei anhand von ID, Kürzel, Name oder Alias. */
export function findParty(meta, label) {
  return meta.parties.find((p) => p.id === label) || meta.parties.find((p) => matches(p, label)) || null;
}

/** Findet eine Fraktion anhand von ID, Kurzname, Name oder Alias. */
export function findFraction(meta, label) {
  return meta.fractions.find((f) => f.id === label) || meta.fractions.find((f) => matches(f, label)) || null;
}

/** Farbe einer Partei (Fallback: Grau). */
export function partyColor(meta, label) {
  const party = findParty(meta, label);
  return party ? party.color : '#666';
}

/** Kurzbezeichnung einer Partei (Fallback: Eingabe unverändert). */
export function partyAbbr(meta, label) {
  const party = findParty(meta, label);
  return party ? party.abbr : String(label ?? '');
}

/**
 * Spiegelt die Partei-Farben als CSS-Custom-Properties `--party-<id>`
 * auf das übergebene Element (Default: `:root`).
 */
export function applyPartyCssVars(meta, target = document.documentElement) {
  for (const party of meta.parties) {
    target.style.setProperty(`--party-${party.id}`, party.color);
  }
}

/** Parteien in Sitzordnung (rechts → links). */
export function partiesInOrder(meta) {
  return [...meta.parties].sort((a, b) => a.order - b.order);
}

/** Fraktionen in Sitzordnung (rechts → links). */
export function fractionsInOrder(meta) {
  return [...meta.fractions].sort((a, b) => a.order - b.order);
}

/** Fallback, falls `party-meta.json` (noch) keinen `council`-Block enthält. */
const COUNCIL_FALLBACK = { legislature: null, seats: null, namesAsOf: null, seatsNote: '', nonVoting: [] };

/**
 * Rahmendaten des Rats (Legislatur, Namens-Stichtag, nicht stimmberechtigte
 * Mitglieder) aus `data/party-meta.json`.
 */
export function councilOf(meta) {
  const council = (meta && meta.council) || {};
  return { ...COUNCIL_FALLBACK, ...council, nonVoting: council.nonVoting || [] };
}

/** `YYYY-MM-DD` → `TT.MM.JJJJ` (leer bei fehlendem Wert). */
function formatDay(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  return match ? `${match[3]}.${match[2]}.${match[1]}` : '';
}

/**
 * Hinweis zur Gültigkeit der Sitzverteilung (Legislatur) und zum Stichtag der
 * Namen. `options.names` blendet den Namens-Stichtag ein, `options.seats` die
 * Sitzverteilung.
 * @returns {string} Klartext ohne HTML
 */
export function councilNote(meta, { seats = true, names = true } = {}) {
  const council = councilOf(meta);
  const parts = [];
  if (seats && council.legislature) {
    parts.push(`Sitzverteilung: Legislatur ${council.legislature}${council.seatsNote ? ` — ${council.seatsNote}` : ''}`);
  }
  if (names && council.namesAsOf) {
    parts.push(`Namen: Stichtag ${formatDay(council.namesAsOf)}`);
  }
  return parts.join(' · ');
}
