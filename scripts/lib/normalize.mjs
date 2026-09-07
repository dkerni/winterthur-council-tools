/**
 * Normalisierung & Zuordnung — gemeinsam genutzt von Scraper, Validierung
 * und Bootstrap.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Absoluter Pfad relativ zur Repo-Wurzel. */
export function repoPath(...segments) {
  return resolve(HERE, '..', '..', ...segments);
}

/** Liest eine JSON-Datei aus dem Repo. */
export async function readJson(relPath) {
  return JSON.parse(await readFile(repoPath(relPath), 'utf8'));
}

/** Schreibt eine JSON-Datei ins Repo (2 Leerzeichen Einrückung, LF am Ende). */
export async function writeJson(relPath, value) {
  await writeFile(repoPath(relPath), JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/**
 * Vergleichsform eines Namens: Kleinbuchstaben, ohne Akzente, ohne Zusätze in
 * Klammern, ohne Satzzeichen.
 */
export function normalizeName(value) {
  return String(value ?? '')
    .replace(/\(.*?\)/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** URL-taugliche Kurzform (z.B. für Platzhalter-IDs). */
export function slugify(value) {
  return normalizeName(value).replace(/\s+/g, '-');
}

const INITIAL_PATTERN = /^[A-ZÄÖÜ]\.$/;

/**
 * Teilt «Vorname Nachname» in Vor- und Nachname.
 * Initialen (`P.`) bleiben beim Vornamen, alle übrigen Bestandteile
 * («Della Sega», «Romay Ogando») gehören zum Nachnamen.
 */
export function splitNameFirstLast(fullName) {
  const cleaned = String(fullName ?? '')
    .replace(/\(.*?\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return { firstName: '', lastName: '' };

  const tokens = cleaned.split(' ');
  if (tokens.length === 1) return { firstName: '', lastName: tokens[0] };

  const firstParts = [tokens[0]];
  let index = 1;
  while (index < tokens.length - 1 && INITIAL_PATTERN.test(tokens[index])) {
    firstParts.push(tokens[index]);
    index++;
  }
  return { firstName: firstParts.join(' '), lastName: tokens.slice(index).join(' ') };
}

/**
 * Teilt «Nachname Vorname» bzw. «Nachname, Vorname» (Format der Listenseite)
 * in Vor- und Nachname.
 */
export function splitNameLastFirst(value) {
  const cleaned = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return { firstName: '', lastName: '' };

  if (cleaned.includes(',')) {
    const [last, first = ''] = cleaned.split(',');
    return { firstName: first.trim(), lastName: last.trim() };
  }

  const tokens = cleaned.split(' ');
  if (tokens.length === 1) return { firstName: '', lastName: tokens[0] };
  return { firstName: tokens[tokens.length - 1], lastName: tokens.slice(0, -1).join(' ') };
}

function labelCandidates(entry) {
  return [entry.id, entry.abbr, entry.shortName, entry.name, ...(entry.aliases || [])].filter(Boolean);
}

function normalizeLabel(value) {
  return String(value ?? '')
    .replace(/\(.*?\)/g, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Kürzel aus einem Klammerzusatz, z.B. «Grünliberale Partei (GLP)» oder
 * «Alternative Linke (AL; früher: Alternative Liste)» → `AL`.
 * @returns {string[]} normalisierte Kandidaten
 */
function abbrCandidates(label) {
  const candidates = [];
  for (const match of String(label ?? '').matchAll(/\(([^)]+)\)/g)) {
    for (const part of match[1].split(/[;,]/)) {
      const normalized = normalizeLabel(part);
      if (normalized && normalized.length <= 12) candidates.push(normalized);
    }
  }
  return candidates;
}

/** Findet einen Eintrag, dessen Bezeichnungen exakt zum Suchbegriff passen. */
function findByLabel(entries, needle) {
  return entries.find((entry) => labelCandidates(entry).some((candidate) => normalizeLabel(candidate) === needle));
}

/** Gemeinsame Zuordnungslogik für Parteien und Fraktionen. */
function matchEntry(entries, label) {
  const needle = normalizeLabel(label);
  if (!needle) return null;

  const exact = findByLabel(entries, needle);
  if (exact) return exact;

  for (const abbr of abbrCandidates(label)) {
    const byAbbr = findByLabel(entries, abbr);
    if (byAbbr) return byAbbr;
  }

  return (
    entries.find((entry) =>
      labelCandidates(entry).some((candidate) => {
        const normalized = normalizeLabel(candidate);
        return normalized.length > 2 && (needle.includes(normalized) || normalized.includes(needle));
      }),
    ) || null
  );
}

/**
 * Ordnet einen Freitext («Sozialdemokratische Partei (SP)») einer Partei aus
 * `party-meta.json` zu.
 * @returns {object|null}
 */
export function matchParty(meta, label) {
  return matchEntry(meta.parties, label);
}

/** Ordnet einen Freitext einer Fraktion aus `party-meta.json` zu. */
export function matchFraction(meta, label) {
  return matchEntry(meta.fractions, label);
}

/**
 * Vergleicht zwei Namen unabhängig von der Reihenfolge der Bestandteile.
 * Initialen (`P.` → `p`) und Kurzformen (`Dani` → `Daniel`) gelten als
 * Übereinstimmung, wenn der kürzere Bestandteil ein Präfix des längeren ist.
 */
function namesLooselyEqual(left, right) {
  const tokens = (value) => normalizeName(value).split(' ').filter(Boolean).sort();
  const a = tokens(left);
  const b = tokens(right);
  if (!a.length || a.length !== b.length) return false;
  return a.every((token, index) => {
    const other = b[index];
    if (token === other) return true;
    const [short, long] = token.length <= other.length ? [token, other] : [other, token];
    return long.startsWith(short);
  });
}

/**
 * Sucht den Geschlechts-Override zu einem Mitglied.
 * Zuordnung über die Personen-ID, sonst über den normalisierten Namen
 * («Vorname Nachname» oder «Nachname Vorname»).
 * @returns {{gender: string, matchedBy: 'id'|'name'|'name-fuzzy'}|null}
 */
export function findGenderOverride(overrides, member) {
  const entries = overrides.overrides || [];

  if (member.id) {
    const byId = entries.find((entry) => entry.id && String(entry.id) === String(member.id));
    if (byId) return { gender: byId.gender, matchedBy: 'id' };
  }

  const rawKeys = [`${member.firstName} ${member.lastName}`, `${member.lastName} ${member.firstName}`, member.displayName].filter(
    Boolean,
  );
  const keys = new Set(rawKeys.map(normalizeName));

  const byName = entries.find((entry) => {
    if (!entry.name) return false;
    const normalized = normalizeName(entry.name);
    const swapped = normalized.split(' ').reverse().join(' ');
    return keys.has(normalized) || keys.has(swapped);
  });
  if (byName) return { gender: byName.gender, matchedBy: 'name' };

  // Fallback: Namensbestandteile in abweichender Reihenfolge oder Kurzform
  // (die Quelle führt z.B. «Bachmann Miguel Pedro» statt «Miguel P. Bachmann»).
  const fuzzy = entries.find((entry) => entry.name && rawKeys.some((key) => namesLooselyEqual(entry.name, key)));
  return fuzzy ? { gender: fuzzy.gender, matchedBy: 'name-fuzzy' } : null;
}

/** Stabile Sortierung nach Partei-Reihenfolge, dann Nachname, Vorname. */
export function compareMembers(meta) {
  const order = new Map(meta.parties.map((party) => [party.id, party.order]));
  return (a, b) => {
    const orderDiff = (order.get(a.partyId) ?? 99) - (order.get(b.partyId) ?? 99);
    if (orderDiff !== 0) return orderDiff;
    const lastDiff = String(a.lastName).localeCompare(String(b.lastName), 'de');
    if (lastDiff !== 0) return lastDiff;
    return String(a.firstName).localeCompare(String(b.firstName), 'de');
  };
}
