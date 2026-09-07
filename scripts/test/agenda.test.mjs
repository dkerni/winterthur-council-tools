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

/**
 * Baut ein `data-entities`-Attribut so, wie es das CMS ausgibt: JSON mit
 * escapten Schrägstrichen, anschliessend HTML-escaped.
 */
function dataEntities(payload) {
  return JSON.stringify(payload)
    .replace(/\//g, '\\/')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Datumszelle der Übersicht (Desktop- und Mobilvariante, wie in der Quelle). */
function datumCell(day) {
  return (
    `<span class="d-none d-md-block"><span class="text-nowrap">${day}, <br>16.15 Uhr - 22.00 Uhr </span></span>` +
    `<span class="d-block d-md-none">${day}, 16.15 Uhr - 22.00 Uhr </span>`
  );
}

function sessionEntity(id, title, day) {
  return {
    name: `<a href="/_rte/anlass/${id}">${title}</a>`,
    'name-sort': '#17080a9e1908044e3a505c5244363244011301c0dc0c',
    _datum: datumCell(day),
    '_datum-sort': '#1713171f050e131f050e131504151f0736151d0736131304',
  };
}

// Aufbau wie auf https://parlament.winterthur.ch/sitzung: zwei Tabellen
// («Nächste» und «Letzte Sitzungen»), deren Zeilen erst im Browser gerendert
// werden — der Tabellenkörper ist leer, die Daten stecken in `data-entities`,
// und Sitzungen sind dort als `/_rte/anlass/<id>` verlinkt.
const SESSION_LIST_HTML = `
<html><body>
<ul class="menu">
  <li class="active first menu-item menu-sitzung menu-level-1"><a href="/sitzung">Sitzungen / Sitzungsdokumente<span class="sr-only">(ausgewählt)</span></a></li>
</ul>
<div class="icms-global-table-container"><h2>Nächste Sitzungen</h2>
  <table class="table icms-dt rs_preserve" cellspacing="0" width="100%" id="icmsTableFutureSitzungen"
     data-webpack-module="datatables"
     data-entity-type="datatables"
     data-entities="${dataEntities({
       emptyColumns: [],
       data: [sessionEntity('7524445', '2./3. Sitzungen', '01.06.2026'), sessionEntity('7603498', '4./5. Sitzungen', '21.09.2026')],
     })}"
     data-page-length="20"
     data-order="[[ 0, &quot;asc&quot; ]]"
     data-dt-type="localdynamic"
     data-is-update-address-bar='true'
  >
    <thead><tr><th data-data="_datum" class="all dtNoAutoWidth icms-sitzung-list-col-date">Datum</th><th data-data="name" class="all dtScopeRow">Sitzung</th></tr></thead>
    <tbody></tbody>
  </table>
</div>
<div class="icms-global-table-container"><h2>Letzte Sitzungen</h2>
  <table class="table icms-dt rs_preserve" cellspacing="0" width="100%" id="icmsTablePastSitzungen"
     data-entity-type="datatables"
     data-entities="${dataEntities({
       emptyColumns: [],
       data: [sessionEntity('4855958', '14./15. Sitzungen', '13.04.2026')],
     })}"
     data-order="[[ 0, &quot;desc&quot; ]]"
  >
    <thead><tr><th data-data="_datum">Datum</th><th data-data="name">Sitzung</th></tr></thead>
    <tbody></tbody>
  </table>
</div>
</body></html>`;

test('parseSessionList liest die Sitzungen der Übersichtsseite', () => {
  const sessions = parseSessionList(SESSION_LIST_HTML);
  assert.deepEqual(
    sessions.map((s) => s.id),
    ['4855958', '7524445', '7603498'],
  );

  const next = sessions.find((s) => s.id === '7603498');
  assert.equal(next.title, '4./5. Sitzungen');
  assert.equal(next.date, '2026-09-21');
  assert.deepEqual(next.dates, ['2026-09-21']);
  assert.equal(next.url, 'https://parlament.winterthur.ch/sitzung/7603498');
  assert.equal(next.sourceUrl, 'https://parlament.winterthur.ch/_rte/anlass/7603498');
});

test('parseSessionList hält den Navigationslink /sitzung nicht für eine Sitzung', () => {
  assert.deepEqual(parseSessionList('<a href="/sitzung">Sitzungen / Sitzungsdokumente</a>'), []);
});

test('parseSessionList liest auch gerenderte Links samt Datum', () => {
  const html = `
    <ul class="sessions">
      <li><span class="date">Montag, 21. September 2026</span><a href="/sitzung/7603498">Doppelsitzung</a></li>
      <li><span class="date">02.11.2026</span><a href="/_rte/anlass/7603499">Sitzung</a></li>
    </ul>`;
  const sessions = parseSessionList(html);
  assert.deepEqual(
    sessions.map((s) => [s.id, s.date]),
    [
      ['7603498', '2026-09-21'],
      ['7603499', '2026-11-02'],
    ],
  );
  assert.equal(sessions[0].sourceUrl, 'https://parlament.winterthur.ch/sitzung/7603498');
  assert.equal(sessions[1].sourceUrl, 'https://parlament.winterthur.ch/_rte/anlass/7603499');
});

test('selectNextSession nimmt die früheste künftige Sitzung', () => {
  const sessions = parseSessionList(SESSION_LIST_HTML);
  assert.equal(selectNextSession(sessions, new Date('2026-05-01T00:00:00Z')).id, '7524445');
  assert.equal(selectNextSession(sessions, new Date('2026-07-01T00:00:00Z')).id, '7603498');
});

test('selectNextSession berücksichtigt den Sitzungstag selbst', () => {
  const sessions = parseSessionList(SESSION_LIST_HTML);
  assert.equal(selectNextSession(sessions, new Date('2026-06-01T09:00:00Z')).id, '7524445');
});

test('selectNextSession liefert null, wenn alle Sitzungen vorbei sind', () => {
  const sessions = parseSessionList(SESSION_LIST_HTML);
  assert.equal(selectNextSession(sessions, new Date('2027-01-01T00:00:00Z')), null);
});

test('selectNextSession zieht undatierte Sitzungen nicht datierten vor', () => {
  const sessions = [
    { id: '1', date: '2020-01-01', dates: ['2020-01-01'] },
    { id: '2', date: null, dates: [] },
  ];
  assert.equal(selectNextSession(sessions, new Date('2026-01-01T00:00:00Z')), null);
  assert.equal(selectNextSession([sessions[1]], new Date('2026-01-01T00:00:00Z')).id, '2');
});

test('extractDates erkennt die gängigen Schreibweisen', () => {
  assert.deepEqual(extractDates('Montag, 1. Dezember 2026'), ['2026-12-01']);
  assert.deepEqual(extractDates('01.12.2026'), ['2026-12-01']);
  assert.deepEqual(extractDates('2026-12-01'), ['2026-12-01']);
  assert.deepEqual(extractDates(datumCell('01.12.2026')), ['2026-12-01']);
  assert.deepEqual(extractDates('kein Datum'), []);
});

/* ─── Traktanden ───────────────────────────────────────────────────── */

// Aufbau wie auf einer Sitzungsseite (z.B. /sitzung/7603498): die Traktanden
// stehen als Zeilen `<tr id="traktanden_…">` im Quelltext, das Blättern
// übernimmt erst im Browser das Tabellen-Skript. Daneben stehen weitere
// Tabellen (Dokumente, Kontakt), die nicht mitgelesen werden dürfen.
const SESSION_DETAIL_HTML = `
<div class="icms-partial-wrapper"><h2>Dokumente</h2><div class="icms-dt-wrapper"><table class="table icms-dt rs_preserve" id="icmsTable-dokumente" data-dt-type="static">
<thead><tr><th scope="col">Name</th><th scope="col">Download</th></tr></thead>
<tbody><tr><td>Traktandenliste</td><td><a href="/_rte/dokument/999">PDF</a></td></tr></tbody></table></div></div>
<div class="icms-partial-wrapper"><h2>Traktanden</h2><div class="icms-dt-wrapper"><table class="table icms-dt rs_preserve" cellspacing="0" width="100%" id="icmsTable-1210141554"
               data-dt-type="static"
               data-order="[[ 0, &quot;asc&quot; ]]"
               data-webpack-module="datatables"
               data-page-length="20"
               data-page-length-all="Alle"
               data-paging="1"
        ><thead>
                <tr><th scope="col">Nr.</th><th class="dtScopeRow">Bezeichnung</th>
                            <th scope="col">Geschäftsart</th>
            <th scope="col">Geschäft</th></tr>
                </thead><tbody>
            <tr id="traktanden_88649"><td>1</td><td>                                    <div class="icms-wysiwyg">Wahl von zwei Mitgliedern in die Sachkommission Soziales und Sicherheit (SSK)</div>
                    </td><td>
                            Wahlen</td><td>
                            <a href="/_rte/information/1388420">                                        2021.82</a></td></tr><tr id="traktanden_88652"><td>2</td><td>  <div class="icms-wysiwyg">Teilrevision der Verordnung &uuml;ber den Finanzhaushalt &amp; die Rechnung</div>
                    </td><td>
                            Weisung</td><td>
                            <a href="/_rte/information/1388421">2021.83</a></td></tr></tbody></table></div></div>
<div class="icms-partial-wrapper"><h2>Kontakt</h2><table class="table"><thead><tr><th scope="col">Name</th><th scope="col">Funktion</th></tr></thead>
<tbody><tr><td>Parlamentsdienst</td><td>Sekretariat</td></tr></tbody></table></div>`;

test('parseAgendaItems liest die Traktanden einer Sitzungsseite', () => {
  const items = parseAgendaItems(SESSION_DETAIL_HTML);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], {
    number: '1',
    business: '2021.82',
    businessUrl: 'https://parlament.winterthur.ch/_rte/information/1388420',
    type: 'Wahlen',
    label: 'Wahl von zwei Mitgliedern in die Sachkommission Soziales und Sicherheit (SSK)',
  });
  assert.equal(items[1].label, 'Teilrevision der Verordnung über den Finanzhaushalt & die Rechnung');
  assert.equal(items[1].type, 'Weisung');
});

test('parseAgendaItems überspringt Dokumenten- und Kontakttabellen', () => {
  const items = parseAgendaItems(SESSION_DETAIL_HTML);
  assert.ok(!items.some((item) => item.business === 'PDF' || item.label === 'Parlamentsdienst'));
});

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
