#!/usr/bin/env node
/**
 * Baut `data/inquiry-facts.json` — die Auswertungsbasis der Seite «Vorstösse».
 *
 * Quellen sind die Jahres-Shards unter `data/inquiries/`, das Personen-
 * verzeichnis `data/people.json` und `data/party-meta.json`. Es wird nicht
 * aufs Netz zugegriffen; das Skript läuft nach `scrape-inquiries` und
 * `scrape-people`.
 *
 * Aufruf:
 *   node scripts/build-inquiry-facts.mjs [--dry-run] [--verbose]
 */

import { existsSync } from 'node:fs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { buildFacts, serializeFacts } from './lib/inquiry-facts.mjs';

const INQUIRY_DIR = 'data/inquiries';
const PEOPLE_FILE = 'data/people.json';
const META_FILE = 'data/party-meta.json';
const OUTPUT_FILE = 'data/inquiry-facts.json';
const SHARD_PATTERN = /^(\d{4}|unbekannt)\.json$/;

const args = process.argv.slice(2);
const options = {
  dryRun: args.includes('--dry-run'),
  verbose: args.includes('--verbose'),
};

const log = (message) => console.log(message);

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

/** Alle gespeicherten Geschäfte aus den Jahres-Shards. */
async function readInquiries() {
  if (!existsSync(repoPath(INQUIRY_DIR))) return [];
  const records = [];
  for (const file of await readdir(repoPath(INQUIRY_DIR))) {
    if (!SHARD_PATTERN.test(file)) continue;
    const shard = await readJson(`${INQUIRY_DIR}/${file}`);
    for (const record of shard?.inquiries ?? []) if (record?.id) records.push(record);
  }
  return records;
}

async function main() {
  const [inquiries, peopleFile, meta] = await Promise.all([readInquiries(), readJson(PEOPLE_FILE), readJson(META_FILE)]);

  if (!inquiries.length) {
    console.error(`✖ Keine Geschäfte in ${INQUIRY_DIR} — zuerst scrape-inquiries laufen lassen.`);
    process.exitCode = 1;
    return;
  }
  if (!peopleFile?.people?.length) {
    console.error(`✖ ${PEOPLE_FILE} fehlt — zuerst scrape-people laufen lassen.`);
    process.exitCode = 1;
    return;
  }
  if (!meta?.parties?.length) {
    console.error(`✖ ${META_FILE} fehlt oder enthält keine Parteien.`);
    process.exitCode = 1;
    return;
  }

  const database = buildFacts({ inquiries, people: peopleFile.people, meta });
  const quality = database.dataQuality;

  log(`  ${quality.inquiries} Geschäfte, ${quality.authorMentions} Verfassernennungen`);
  log(`  Zuordnung: ${Object.entries(quality.matchedBy).map(([key, value]) => `${key} ${value}`).join(', ')}`);
  if (quality.unresolved.length) {
    log(`  ⚠ ${quality.unresolved.length} Nennungen ohne Treffer`);
    for (const entry of quality.unresolved.slice(0, 20)) log(`    ${entry.name} (${entry.inquiryId})`);
  }

  if (options.verbose) {
    for (const year of database.coverage) {
      log(`  ${year.year}: ${year.total} Geschäfte, ${year.motions} Vorstösse, ${year.withAuthors} mit Verfasser`);
    }
  }

  const content = serializeFacts(database);
  const previous = await readJson(OUTPUT_FILE);
  const { generatedAt: _next, ...nextRest } = database;
  const { generatedAt: _prev, ...prevRest } = previous ?? {};
  if (previous && JSON.stringify(prevRest) === JSON.stringify(nextRest)) {
    log('✓ Keine Änderungen — nichts zu schreiben.');
    return;
  }

  if (options.dryRun) {
    log(`✓ Probelauf — ${OUTPUT_FILE} würde geschrieben (${Math.round(content.length / 1024)} kB).`);
    return;
  }
  await writeFile(repoPath(OUTPUT_FILE), content, 'utf8');
  log(`✓ ${OUTPUT_FILE} geschrieben (${Math.round(content.length / 1024)} kB).`);
}

main().catch((error) => {
  console.error(`✖ ${error.message}`);
  process.exitCode = 1;
});
