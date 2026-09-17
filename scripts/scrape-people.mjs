#!/usr/bin/env node
/**
 * Scraper für das Personenverzeichnis des Stadtparlaments Winterthur.
 *
 * Die Seite `/stadtparlament/27428` liefert in einem einzigen Request alle je
 * erfassten Personen — aktive wie ausgeschiedene. Ergebnis ist
 * `data/people.json`; manuelle Korrekturen kommen aus
 * `data/people-overrides.json`.
 *
 * Anders als `data/members.json` (nur die aktuelle Zusammensetzung, mit
 * Fraktion, Kommissionen und Geschlecht) ist `data/people.json` eine reine
 * Nachschlagetabelle für historische Auswertungen.
 *
 * Aufruf:
 *   node scripts/scrape-people.mjs [--dry-run] [--verbose]
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { fetchPage } from './lib/icms.mjs';
import { buildPeopleDatabase, peopleListUrl, seatsByYear, serializePeople } from './lib/people.mjs';

const OUTPUT_FILE = 'data/people.json';
const META_FILE = 'data/party-meta.json';
const OVERRIDES_FILE = 'data/people-overrides.json';

const args = process.argv.slice(2);
const options = {
  dryRun: args.includes('--dry-run'),
  verbose: args.includes('--verbose'),
};

const log = (message) => console.log(message);
const verbose = (message) => {
  if (options.verbose) console.log(message);
};

function repoPath(relPath) {
  return fileURLToPath(new URL(`../${relPath}`, import.meta.url));
}

async function readJson(relPath) {
  try {
    return JSON.parse(await readFile(repoPath(relPath), 'utf8'));
  } catch {
    return null;
  }
}

/** Schreibt nur, wenn sich der Inhalt ohne den Zeitstempel ändert. */
async function writeIfChanged(relPath, database) {
  const previous = await readJson(relPath);
  if (previous && JSON.stringify(previous.people) === JSON.stringify(database.people)) {
    const { generatedAt, ...rest } = database;
    const { generatedAt: _prev, ...prevRest } = previous;
    if (JSON.stringify(prevRest) === JSON.stringify(rest)) return false;
  }
  if (options.dryRun) return true;

  await writeFile(repoPath(relPath), serializePeople(database), 'utf8');
  return true;
}

async function main() {
  const meta = await readJson(META_FILE);
  if (!meta?.parties?.length) {
    console.error(`✖ ${META_FILE} fehlt oder enthält keine Parteien.`);
    process.exitCode = 1;
    return;
  }

  const overrides = await readJson(OVERRIDES_FILE);
  if (!overrides) log(`  ⚠ ${OVERRIDES_FILE} nicht gefunden — ohne manuelle Korrekturen.`);

  const knownParties = new Set(meta.parties.map((party) => party.id));
  for (const entry of overrides?.overrides ?? []) {
    if (entry.partyId && !knownParties.has(entry.partyId)) {
      console.error(`✖ ${OVERRIDES_FILE}: unbekannte Partei «${entry.partyId}» bei ${entry.name ?? entry.personId}.`);
      process.exitCode = 1;
      return;
    }
  }

  log(`→ Personenverzeichnis: ${peopleListUrl()}`);
  const html = await fetchPage(peopleListUrl(), { log: verbose });
  const database = buildPeopleDatabase({ html, meta, overrides });

  if (!database.people.length) {
    console.error('✖ Keine Personen gefunden — Seitenaufbau geändert?');
    process.exitCode = 1;
    return;
  }

  const quality = database.dataQuality;
  log(`  ${quality.total} Personen (${quality.active} aktiv, ${quality.total - quality.active} ausgeschieden)`);
  log(`  Korrekturen angewendet: ${quality.overridesApplied}`);
  if (quality.withoutParty) log(`  ⚠ ohne Partei: ${quality.withoutParty}`);
  for (const entry of quality.overridesUnmatched) log(`  ⚠ Korrektur ohne Treffer: ${entry}`);

  if (options.verbose) {
    const currentYear = new Date().getFullYear();
    for (const year of seatsByYear(database.people, { from: currentYear - 4, to: currentYear })) {
      log(`  ${year.year}: ${year.total} Sitze${year.complete ? '' : ' (unvollständig)'}`);
    }
  }

  const changed = await writeIfChanged(OUTPUT_FILE, database);
  if (!changed) {
    log('✓ Keine Änderungen — nichts zu schreiben.');
    return;
  }
  log(options.dryRun ? `✓ Probelauf — ${OUTPUT_FILE} würde geschrieben.` : `✓ ${OUTPUT_FILE} geschrieben.`);
}

main().catch((error) => {
  console.error(`✖ ${error.message}`);
  process.exitCode = 1;
});
