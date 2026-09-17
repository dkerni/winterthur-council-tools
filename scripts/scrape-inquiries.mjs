#!/usr/bin/env node
/**
 * Scraper für die politischen Geschäfte des Stadtparlaments Winterthur.
 *
 * Ablauf:
 *   1. Trefferliste ab 1800 holen — sie liefert den gesamten Bestand in einem
 *      einzigen Request (ID, Nummer, Titel, Geschäftsart, Eingangsdatum)
 *   2. Trefferliste mit `statusId=erledigt` holen — daraus ergibt sich ohne
 *      Detailabruf, welche Geschäfte abgeschlossen sind
 *   3. Arbeitsmenge bestimmen: neu, noch nicht erledigt, wieder geöffnet oder
 *      in den Listenangaben geändert
 *   4. Detailseiten dieser Geschäfte abrufen und auswerten
 *   5. `data/inquiries/index.json` und die Jahres-Shards schreiben
 *
 * Der erste Lauf erfasst alle Geschäfte (rund 3200 Abrufe, 20–25 Minuten);
 * danach sind es pro Woche nur noch die neuen und die offenen Geschäfte.
 *
 * Aufruf:
 *   node scripts/scrape-inquiries.mjs [--full] [--dry-run] [--verbose]
 *                                     [--limit=N] [--year=YYYY] [--id=<id>] [--force]
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { fetchPage } from './lib/icms.mjs';
import {
  CLOSED_STATUS_ID,
  SCHEMA_VERSION,
  buildIndex,
  buildRecord,
  inquiryListUrl,
  parseInquiryIds,
  parseInquiryList,
  selectWorkSet,
  serializeIndex,
  serializeShard,
  shardRecords,
} from './lib/inquiries.mjs';

const DATA_DIR = 'data/inquiries';
const INDEX_FILE = `${DATA_DIR}/index.json`;
const SHARD_PATTERN = /^(\d{4}|unbekannt)\.json$/;

/** Bricht ab, wenn die Liste deutlich kleiner ist als der gespeicherte Bestand. */
const MIN_LIST_RATIO = 0.9;

const args = process.argv.slice(2);
const options = {
  full: args.includes('--full'),
  dryRun: args.includes('--dry-run'),
  verbose: args.includes('--verbose'),
  force: args.includes('--force'),
  limit: Number(args.find((arg) => arg.startsWith('--limit='))?.split('=')[1]) || null,
  year: args.find((arg) => arg.startsWith('--year='))?.split('=')[1] ?? null,
  id: args.find((arg) => arg.startsWith('--id='))?.split('=')[1] ?? null,
};

const warnings = [];
const log = (message) => console.log(message);
const verbose = (message) => {
  if (options.verbose) console.log(message);
};
const warn = (message) => {
  warnings.push(message);
  console.warn(`  ⚠ ${message}`);
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

/** Alle bereits gespeicherten Datensätze, nach ID. */
async function readStoredRecords() {
  const records = new Map();
  if (!existsSync(repoPath(DATA_DIR))) return records;

  for (const file of await readdir(repoPath(DATA_DIR))) {
    if (!SHARD_PATTERN.test(file)) continue;
    const shard = await readJson(`${DATA_DIR}/${file}`);
    for (const record of shard?.inquiries ?? []) {
      if (record?.id) records.set(String(record.id), record);
    }
  }
  return records;
}

/** Datensatz eines Geschäfts von der Detailseite. */
async function fetchRecord(row) {
  const html = await fetchPage(row.url, { log: verbose });
  return buildRecord({ row, html });
}

/**
 * Schreibt eine Datei nur, wenn sich ihr Inhalt ändert.
 * @returns {Promise<boolean>} true, wenn geschrieben wurde
 */
async function writeIfChanged(relPath, content) {
  let previous = null;
  try {
    previous = await readFile(repoPath(relPath), 'utf8');
  } catch {
    previous = null;
  }
  if (previous === content) return false;
  if (options.dryRun) return true;

  await mkdir(repoPath(DATA_DIR), { recursive: true });
  await writeFile(repoPath(relPath), content, 'utf8');
  return true;
}

/** Shards schreiben; unveränderte Jahre bleiben unberührt. */
async function writeShards(records, generatedAt) {
  const shards = shardRecords(records);
  const written = [];

  for (const [file, entries] of shards) {
    const previous = await readJson(`${DATA_DIR}/${file}`);
    // Nur der Inhalt zählt — der Zeitstempel im Kopf darf keine Diffs erzeugen.
    if (previous && JSON.stringify(previous.inquiries) === JSON.stringify(entries)) continue;

    const content = serializeShard({ year: entries[0].year ?? null, records: entries, generatedAt });
    if (await writeIfChanged(`${DATA_DIR}/${file}`, content)) written.push(file);
  }

  if (existsSync(repoPath(DATA_DIR))) {
    for (const file of await readdir(repoPath(DATA_DIR))) {
      if (!SHARD_PATTERN.test(file) || shards.has(file)) continue;
      log(`  ${file} entfernt (keine Geschäfte mehr)`);
      if (!options.dryRun) await rm(repoPath(`${DATA_DIR}/${file}`), { force: true });
      written.push(file);
    }
  }

  return written;
}

/** Arbeitsmenge auf `--year`, `--id` und `--limit` einschränken. */
function applyFilters(targets) {
  let selected = targets;
  if (options.id) selected = selected.filter(({ row }) => row.id === options.id);
  if (options.year) selected = selected.filter(({ row }) => String(row.year) === options.year);
  if (options.limit) selected = selected.slice(0, options.limit);
  return selected;
}

async function main() {
  const listUrl = inquiryListUrl();
  log(`Trefferliste abrufen: ${listUrl}`);
  const listRows = parseInquiryList(await fetchPage(listUrl, { log: verbose }));
  log(`  ${listRows.length} Geschäfte in der Liste`);

  if (!listRows.length) {
    throw new Error('Die Trefferliste ist leer — Quelle prüfen (Struktur geändert?).');
  }

  const index = await readJson(INDEX_FILE);
  const previousTotal = index?.counts?.total ?? 0;
  if (previousTotal && listRows.length < previousTotal * MIN_LIST_RATIO && !options.force) {
    throw new Error(
      `Die Liste hat nur ${listRows.length} Einträge, gespeichert sind ${previousTotal}. ` +
        'Das deutet auf eine Störung der Quelle hin — Abbruch (mit --force überschreibbar).',
    );
  }

  log('Erledigte Geschäfte abrufen (Statusfilter)');
  const closedIds = parseInquiryIds(await fetchPage(inquiryListUrl({ status: CLOSED_STATUS_ID }), { log: verbose }));
  log(`  ${closedIds.size} Geschäfte sind erledigt, ${listRows.length - closedIds.size} offen`);

  const stored = await readStoredRecords();
  const { targets, reasons, removed } = selectWorkSetSafely(listRows, closedIds, index, new Set(stored.keys()));
  const selected = applyFilters(targets);

  log(
    `Abzurufen: ${selected.length} Geschäfte ` +
      `(neu ${reasons.new}, offen ${reasons.open}, wieder offen ${reasons.reopened}, ` +
      `geändert ${reasons.changed}, fehlend ${reasons.missing}, Vollabgleich ${reasons.all})`,
  );
  if (selected.length !== targets.length) log(`  durch Filter eingeschränkt von ${targets.length}`);
  if (removed.length) log(`  ${removed.length} Geschäfte sind an der Quelle nicht mehr vorhanden`);

  let done = 0;
  let failed = 0;
  for (const { row, reason } of selected) {
    verbose(`  → ${row.number ?? row.id} (${reason}) ${row.url}`);
    try {
      const record = await fetchRecord(row);
      const previous = stored.get(row.id);
      // Unveränderte Geschäfte behalten ihren alten Datensatz samt `fetchedAt`,
      // damit der wöchentliche Lauf keine leeren Diffs erzeugt.
      stored.set(row.id, previous && previous.contentHash === record.contentHash ? previous : record);
    } catch (error) {
      failed++;
      warn(`${row.url}: ${error.message}`);
    }
    done++;
    if (done % 100 === 0) log(`  ${done}/${selected.length} abgerufen`);
  }

  if (selected.length && failed === selected.length) {
    throw new Error('Kein einziger Abruf war erfolgreich — es wird nichts geschrieben.');
  }

  for (const id of removed) stored.delete(id);

  const records = [...stored.values()];
  const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const writtenShards = await writeShards(records, generatedAt);

  const nextIndex = buildIndex(records, {
    generatedAt,
    source: listUrl,
    lastFullSync: reasons.all ? generatedAt : (index?.lastFullSync ?? null),
    dataQuality: { warnings: warnings.length, failedFetches: failed },
  });

  const indexChanged = !sameIndexContent(index, nextIndex);
  if (!writtenShards.length && !indexChanged) {
    log('Keine Änderungen — nichts zu schreiben.');
    return;
  }

  await writeIfChanged(INDEX_FILE, serializeIndex(nextIndex));

  log(
    options.dryRun
      ? `Trockenlauf — ${writtenShards.length} Shards und der Index würden geschrieben.`
      : `${INDEX_FILE} und ${writtenShards.length} Shards geschrieben.`,
  );
  log(
    `  Bestand: ${nextIndex.counts.total} Geschäfte ` +
      `(${nextIndex.counts.closed} erledigt, ${nextIndex.counts.open} offen), ` +
      `${nextIndex.years.length} Jahre`,
  );
  if (warnings.length) log(`  ${warnings.length} Warnungen`);
}

/** Arbeitsmenge bestimmen (eigene Funktion, damit `main` lesbar bleibt). */
function selectWorkSetSafely(listRows, closedIds, index, storedIds) {
  if (index && index.schemaVersion !== SCHEMA_VERSION) {
    log(`  Schema ${index.schemaVersion} → ${SCHEMA_VERSION}: Vollabgleich nötig`);
  }
  return selectWorkSet({ listRows, closedIds, index, storedIds, full: options.full });
}

/** Vergleicht zwei Indizes ohne die Zeitstempel. */
function sameIndexContent(previous, next) {
  if (!previous) return false;
  const strip = ({ generatedAt, lastFullSync, ...rest }) => rest;
  return JSON.stringify(strip(previous)) === JSON.stringify(strip(next));
}

main().catch((error) => {
  console.error(`Fehler: ${error.message}`);
  process.exitCode = 1;
});
