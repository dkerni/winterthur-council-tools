/**
 * Parteien & Fraktionen — Stammdaten aus `data/party-meta.json`.
 *
 * Einzige Quelle für Reihenfolge (rechts → links), Farben und Kurznamen.
 * Die Farben werden zusätzlich als CSS-Custom-Properties (`--party-<id>`)
 * gespiegelt, damit auch reines CSS damit arbeiten kann.
 */

import { siteUrl } from './paths.js';

let metaPromise = null;

/**
 * Lädt `data/party-meta.json` (einmalig, Promise-Cache).
 * @returns {Promise<{parties: Array, fractions: Array}>}
 */
export function loadPartyMeta() {
  if (!metaPromise) {
    metaPromise = fetch(siteUrl('data/party-meta.json'))
      .then((res) => {
        if (!res.ok) throw new Error(`party-meta.json: HTTP ${res.status}`);
        return res.json();
      })
      .catch((err) => {
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
