import assert from 'node:assert/strict';
import { inflateRawSync } from 'node:zlib';
import { test } from 'node:test';

import {
  AGENDA_COLUMNS,
  dedupeAgendaItems,
  extractDates,
  findPaginationLinks,
  parseAgendaItems,
  parseSessionList,
  selectNextSession,
  sortAgendaItems,
  toWorkbookRows,
} from '../lib/agenda.mjs';
import { columnName, createWorkbook } from '../lib/xlsx.mjs';

/* ─── Sitzungsübersicht ────────────────────────────────────────────── */

const SESSION_LIST_HTML = `
<html><body>
  <ul class="sessions">
    <li>
      <span class="date">Montag, 21. September 2026</span>
      <a href="/sitzung/7603498">Sitzung / Doppelsitzung</a>
    </li>
    <li>
      <span class="date">02.11.2026</span>
      <a href="/sitzung/7603499">Sitzung</a>
    </li>
    <li>
      <span class="date">15.06.2026</span>
      <a href="/sitzung/7603400">Sitzung</a>
    </li>
  </ul>
</body></html>`;

test('parseSessionList liest Sitzungen mit Datum und Link', () => {
  const sessions = parseSessionList(SESSION_LIST_HTML);
  assert.equal(sessions.length, 3);
  assert.deepEqual(
    sessions.map((s) => s.id),
    ['7603400', '7603498', '7603499'],
  );
  const next = sessions.find((s) => s.id === '7603498');
  assert.equal(next.date, '2026-09-21');
  assert.equal(next.url, 'https://parlament.winterthur.ch/sitzung/7603498');
});

test('parseSessionList wertet data-entities aus', () => {
  const html =
    '<table class="icms-dt" data-entities="' +
    '[{&quot;_datum&quot;:&quot;21.09.2026&quot;,&quot;_titel&quot;:&quot;' +
    '&lt;a href=\'/sitzung/7603498\'&gt;Doppelsitzung&lt;/a&gt;&quot;}]">' +
    '</table>';
  const sessions = parseSessionList(html);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, '7603498');
  assert.equal(sessions[0].date, '2026-09-21');
});

test('selectNextSession nimmt die früheste künftige Sitzung', () => {
  const sessions = parseSessionList(SESSION_LIST_HTML);
  const next = selectNextSession(sessions, new Date('2026-08-01T00:00:00Z'));
  assert.equal(next.id, '7603498');
});

test('selectNextSession berücksichtigt den Sitzungstag selbst', () => {
  const sessions = parseSessionList(SESSION_LIST_HTML);
  const next = selectNextSession(sessions, new Date('2026-09-21T09:00:00Z'));
  assert.equal(next.id, '7603498');
});

test('selectNextSession liefert null, wenn alle Sitzungen vorbei sind', () => {
  const sessions = parseSessionList(SESSION_LIST_HTML);
  assert.equal(selectNextSession(sessions, new Date('2027-01-01T00:00:00Z')), null);
});

test('extractDates erkennt die gängigen Schreibweisen', () => {
  assert.deepEqual(extractDates('Montag, 1. Dezember 2026'), ['2026-12-01']);
  assert.deepEqual(extractDates('01.12.2026'), ['2026-12-01']);
  assert.deepEqual(extractDates('2026-12-01'), ['2026-12-01']);
  assert.deepEqual(extractDates('kein Datum'), []);
});

/* ─── Traktanden ───────────────────────────────────────────────────── */

const AGENDA_TABLE_HTML = `
<table>
  <tr><th>Nr.</th><th>Geschäft</th><th>Geschäftsart</th><th>Bezeichnung</th></tr>
  <tr>
    <td>1</td>
    <td><a href="/geschaeft/123">2026.123</a></td>
    <td>Interpellation</td>
    <td>Verkehr in der Altstadt</td>
  </tr>
  <tr>
    <td>2</td>
    <td><a href="https://parlament.winterthur.ch/geschaeft/124">2026.124</a></td>
    <td>Motion</td>
    <td>Schulraum &amp; Betreuung</td>
  </tr>
</table>`;

test('parseAgendaItems liest die gerenderte Tabelle', () => {
  const items = parseAgendaItems(AGENDA_TABLE_HTML);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    number: '1',
    business: '2026.123',
    businessUrl: 'https://parlament.winterthur.ch/geschaeft/123',
    type: 'Interpellation',
    label: 'Verkehr in der Altstadt',
  });
  assert.equal(items[1].label, 'Schulraum & Betreuung');
});

test('parseAgendaItems bevorzugt data-entities', () => {
  const html =
    '<table class="icms-dt" data-entities="' +
    '[{&quot;_nummer&quot;:&quot;3&quot;,&quot;_geschaeft&quot;:&quot;' +
    '&lt;a href=\'/geschaeft/125\'&gt;2026.125&lt;/a&gt;&quot;,' +
    '&quot;_geschaeftsart&quot;:&quot;Postulat&quot;,' +
    '&quot;_bezeichnung&quot;:&quot;Velowege&quot;}]"></table>';
  const items = parseAgendaItems(html);
  assert.deepEqual(items, [
    {
      number: '3',
      business: '2026.125',
      businessUrl: 'https://parlament.winterthur.ch/geschaeft/125',
      type: 'Postulat',
      label: 'Velowege',
    },
  ]);
});

test('parseAgendaItems ignoriert Tabellen ohne passende Spalten', () => {
  const html = '<table><tr><th>Person</th><th>Partei</th></tr><tr><td>A</td><td>B</td></tr></table>';
  assert.deepEqual(parseAgendaItems(html), []);
});

test('findPaginationLinks findet Folgeseiten derselben Sitzung', () => {
  const html = `
    <a href="/sitzung/7603498?page=2">2</a>
    <a href="/sitzung/7603498?page=3">3</a>
    <a href="/sitzung/7603498">1</a>
    <a href="/sitzung/7603499?page=2">andere Sitzung</a>
    <a href="/geschaeft/1?page=2">Geschäft</a>`;
  const links = findPaginationLinks(html, 'https://parlament.winterthur.ch/sitzung/7603498');
  assert.deepEqual(links, [
    'https://parlament.winterthur.ch/sitzung/7603498?page=2',
    'https://parlament.winterthur.ch/sitzung/7603498?page=3',
  ]);
});

test('dedupeAgendaItems entfernt doppelte Traktanden', () => {
  const items = parseAgendaItems(AGENDA_TABLE_HTML);
  assert.equal(dedupeAgendaItems([...items, ...items]).length, 2);
});

test('sortAgendaItems sortiert numerisch', () => {
  const items = [{ number: '10' }, { number: '2' }, { number: '' }, { number: '1' }];
  assert.deepEqual(
    sortAgendaItems(items).map((item) => item.number),
    ['1', '2', '10', ''],
  );
});

test('toWorkbookRows füllt neun Spalten und verlinkt das Geschäft', () => {
  const rows = toWorkbookRows(parseAgendaItems(AGENDA_TABLE_HTML));
  assert.equal(AGENDA_COLUMNS.length, 9);
  assert.equal(rows[0].length, 9);
  assert.deepEqual(rows[0][1], {
    text: '2026.123',
    link: 'https://parlament.winterthur.ch/geschaeft/123',
  });
  assert.deepEqual(rows[0].slice(4), ['', '', '', '', '']);
});

/* ─── Excel ────────────────────────────────────────────────────────── */

/** Liest einen Eintrag aus dem erzeugten ZIP-Archiv. */
function readZipEntry(buffer, name) {
  let offset = 0;
  while (offset < buffer.length - 4 && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const entryName = buffer.toString('utf8', offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    if (entryName === name) return inflateRawSync(buffer.subarray(start, start + compressedSize)).toString('utf8');
    offset = start + compressedSize;
  }
  return null;
}

test('columnName bildet Spaltenbuchstaben', () => {
  assert.equal(columnName(1), 'A');
  assert.equal(columnName(9), 'I');
  assert.equal(columnName(27), 'AA');
});

test('createWorkbook erzeugt eine lesbare Arbeitsmappe mit Hyperlink', () => {
  const buffer = createWorkbook({
    sheetName: 'Traktanden',
    columns: AGENDA_COLUMNS,
    rows: toWorkbookRows(parseAgendaItems(AGENDA_TABLE_HTML)),
    columnWidths: [6, 18, 22, 60, 20, 22, 20, 30, 30],
    modified: new Date(Date.UTC(2020, 0, 1)),
  });

  assert.equal(buffer.readUInt32LE(0), 0x04034b50, 'ZIP-Signatur');
  assert.ok(readZipEntry(buffer, '[Content_Types].xml').includes('workbook.xml'));

  const sheet = readZipEntry(buffer, 'xl/worksheets/sheet1.xml');
  assert.match(sheet, /<t xml:space="preserve">Zuständig Fraktion<\/t>/);
  assert.match(sheet, /<t xml:space="preserve">Schulraum &amp; Betreuung<\/t>/);
  assert.match(sheet, /<hyperlink ref="B2" r:id="rHl1"\/>/);
  assert.match(sheet, /autoFilter ref="A1:I3"/);

  const rels = readZipEntry(buffer, 'xl/worksheets/_rels/sheet1.xml.rels');
  assert.match(rels, /Target="https:\/\/parlament\.winterthur\.ch\/geschaeft\/123"/);
});

test('createWorkbook ist bei gleichen Daten byte-identisch', () => {
  const build = () =>
    createWorkbook({
      columns: ['A', 'B'],
      rows: [['1', '2']],
      modified: new Date(Date.UTC(2020, 0, 1)),
    });
  assert.ok(build().equals(build()));
});
