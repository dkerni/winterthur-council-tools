#!/usr/bin/env node
/**
 * Scraper für die Traktandenliste der nächsten Sitzung des Stadtparlaments.
 *
 * Ablauf:
 *   1. Sitzungsübersicht (`/sitzung`) holen und die nächste Sitzung bestimmen
 *      (Doppelsitzungen liegen in der Quelle als eine Sitzung mit zwei Daten vor)
 *   2. Sitzungsseite und allfällige Folgeseiten der Traktandenliste holen
 *   3. Traktanden (Nr., Geschäft inkl. Link, Geschäftart, Bezeichnung) auslesen
 *   4. `data/traktandenliste.xlsx` und `data/agenda.json` schreiben
 *
 * Ist die gefundene Sitzung bereits gespeichert und inhaltlich unverändert,
 * wird nichts geschrieben. Findet sich keine künftige Sitzung, hält
 * `data/agenda.json` den Zustand «keine Traktanden verfügbar» fest — die
 * Website zeigt das beim Download-Knopf an.
 *
 * Aufruf:
 *   node scripts/scrape-agenda.mjs [--dry-run] [--force] [--verbose]
 */

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  AGENDA_COLUMNS,
  SESSION_LIST_PATH,
  dedupeAgendaItems,
  findPaginationLinks,
  parseAgendaItems,
  parseSessionList,
  selectNextSession,
  sortAgendaItems,
  toWorkbookRows,
} from './lib/agenda.mjs';
import { BASE_URL, fetchPage } from './lib/icms.mjs';
import { createWorkbook } from './lib/xlsx.mjs';

const SCHEMA_VERSION = 1;
const AGENDA_JSON = 'data/agenda.json';
const WORKBOOK_FILE = 'data/traktandenliste.xlsx';
const MAX_PAGES = 25;
const COLUMN_WIDTHS = [6, 18, 22, 60, 20, 22, 20, 30, 30];

const args = process.argv.slice(2);
const options = {
  dryRun: args.includes('--dry-run'),
  force: args.includes('--force'),
  verbose: args.includes('--verbose'),
};

const log = (message) => console.log(message);
const verbose = (message) => {
  if (options.verbose) console.log(message);
};

function repoPath(relPath) {
  return fileURLToPath(new URL(`../${relPath}`, import.meta.url));
}

async function readAgendaJson() {
  try {
    return JSON.parse(await readFile(repoPath(AGENDA_JSON), 'utf8'));
  } catch {
    return null;
  }
}

/** Inhaltsstempel: ändert sich nur, wenn sich Sitzung oder Traktanden ändern. */
function contentHash(session, items) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        id: session?.id ?? null,
        dates: session?.dates ?? [],
        items: items.map((item) => [item.number, item.business, item.businessUrl, item.type, item.label]),
      }),
    )
    .digest('hex');
}

/** Dateiname für den Download, z.B. `traktandenliste_2026-09-21.xlsx`. */
function downloadName(session) {
  const date = session?.date;
  return date ? `traktandenliste_${date}.xlsx` : 'traktandenliste.xlsx';
}

/** Traktanden einer Sitzung inkl. Folgeseiten. */
async function fetchAgendaItems(session) {
  const queue = [session.url];
  const visited = new Set();
  const items = [];

  while (queue.length && visited.size < MAX_PAGES) {
    const pageUrl = queue.shift();
    if (visited.has(pageUrl)) continue;
    visited.add(pageUrl);

    verbose(`  → ${pageUrl}`);
    const html = await fetchPage(pageUrl, { log: verbose });
    const pageItems = parseAgendaItems(html);
    verbose(`    ${pageItems.length} Traktanden`);
    items.push(...pageItems);

    for (const link of findPaginationLinks(html, pageUrl)) {
      if (!visited.has(link) && !queue.includes(link)) queue.push(link);
    }
  }

  if (queue.length) {
    console.warn(`  ⚠ Mehr als ${MAX_PAGES} Seiten — weitere Seiten wurden nicht geladen.`);
  }

  return sortAgendaItems(dedupeAgendaItems(items));
}

async function writeOutputs(payload, workbook) {
  if (options.dryRun) {
    log('Trockenlauf — es wurde nichts geschrieben.');
    return;
  }
  await writeFile(repoPath(AGENDA_JSON), JSON.stringify(payload, null, 2) + '\n', 'utf8');
  if (workbook) {
    await writeFile(repoPath(WORKBOOK_FILE), workbook);
  } else {
    await rm(repoPath(WORKBOOK_FILE), { force: true });
  }
}

async function main() {
  const listUrl = new URL(SESSION_LIST_PATH, BASE_URL).href;
  log(`Sitzungsübersicht abrufen: ${listUrl}`);
  const listHtml = await fetchPage(listUrl, { log: verbose });
  const sessions = parseSessionList(listHtml);
  log(`  ${sessions.length} Sitzungen gefunden`);

  const previous = await readAgendaJson();
  const session = selectNextSession(sessions);

  if (!session) {
    log('Keine künftige Sitzung publiziert — Zustand «keine Traktanden» festhalten.');
    if (previous?.status === 'none' && !options.force) {
      log('Zustand ist bereits gespeichert — nichts zu tun.');
      return;
    }
    await writeOutputs(
      {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        generatedBy: 'scripts/scrape-agenda.mjs',
        source: listUrl,
        status: 'none',
        message: 'Für die nächste Sitzung sind noch keine Traktanden publiziert.',
        session: null,
        file: null,
        fileName: null,
        contentHash: null,
      },
      null,
    );
    return;
  }

  log(`Nächste Sitzung: ${session.title || session.id} (${session.dates.join(', ') || 'ohne Datum'})`);

  const items = await fetchAgendaItems(session);
  log(`  ${items.length} Traktanden gelesen`);

  if (!items.length) {
    log('Sitzung ohne publizierte Traktanden — Zustand «keine Traktanden» festhalten.');
    if (previous?.status === 'none' && !options.force) {
      log('Zustand ist bereits gespeichert — nichts zu tun.');
      return;
    }
    await writeOutputs(
      {
        schemaVersion: SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        generatedBy: 'scripts/scrape-agenda.mjs',
        source: listUrl,
        status: 'none',
        message: 'Für die nächste Sitzung sind noch keine Traktanden publiziert.',
        session: {
          id: session.id,
          title: session.title,
          url: session.url,
          date: session.date,
          dates: session.dates,
          itemCount: 0,
        },
        file: null,
        fileName: null,
        contentHash: null,
      },
      null,
    );
    return;
  }

  const hash = contentHash(session, items);
  const unchanged =
    previous?.status === 'ok' &&
    previous?.session?.id === session.id &&
    previous?.contentHash === hash &&
    existsSync(repoPath(WORKBOOK_FILE));

  if (unchanged && !options.force) {
    log('Sitzung ist bereits gespeichert und unverändert — nichts zu tun.');
    return;
  }

  const sheetName = session.date ? `Traktanden ${session.date}` : 'Traktanden';
  const workbook = createWorkbook({
    sheetName,
    columns: AGENDA_COLUMNS,
    rows: toWorkbookRows(items),
    columnWidths: COLUMN_WIDTHS,
    // Fester Zeitstempel, damit identische Daten identische Dateien ergeben.
    modified: new Date(Date.UTC(2020, 0, 1)),
  });

  await writeOutputs(
    {
      schemaVersion: SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      generatedBy: 'scripts/scrape-agenda.mjs',
      source: listUrl,
      status: 'ok',
      session: {
        id: session.id,
        title: session.title,
        url: session.url,
        date: session.date,
        dates: session.dates,
        itemCount: items.length,
      },
      file: WORKBOOK_FILE,
      fileName: downloadName(session),
      contentHash: hash,
    },
    workbook,
  );

  log(`${WORKBOOK_FILE} geschrieben (${items.length} Traktanden).`);
}

main().catch((error) => {
  console.error(`Fehler: ${error.message}`);
  process.exitCode = 1;
});
