import assert from 'node:assert/strict';
import { test } from 'node:test';

import { extractLabeledFieldPairs, extractLabeledFields, parseDate } from '../lib/icms.mjs';
import {
  buildDecisions,
  buildIndex,
  buildRecord,
  inquiryListUrl,
  inquiryUrl,
  inquiryYear,
  parseAuthors,
  parseDocuments,
  parseInquiryIds,
  parseInquiryList,
  parseSessions,
  parseStages,
  parseTitle,
  parseVoteResult,
  resolveConclusion,
  selectWorkSet,
  serializeIndex,
  serializeShard,
  shardName,
  shardRecords,
  slugify,
} from '../lib/inquiries.mjs';

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

/* ─── Trefferliste ─────────────────────────────────────────────────── */

const LIST_HTML = `<table class="table icms-dt" id="icmsTable-geschaefteList"
  data-entities="${dataEntities({
    emptyColumns: [],
    data: [
      {
        title: '<a href="/_rte/information/1388441">Kosten und Qualität der Kinderbetreuung</a>',
        'title-sort': '#3e46',
        _nummer: '2018.8',
        '_nummer-sort': '201800008',
        _geschaeftsdatum: '12.12.2018',
        '_geschaeftsdatum-sort': '2018-12-12',
        _kategorieId: 'Motion',
      },
      {
        title: '<a href="/_rte/information/2777389">Schulabsentismus in Winterthur</a>',
        _nummer: '2026.14',
        '_nummer-sort': '202600014',
        '_geschaeftsdatum-sort': '2026-03-02',
        _kategorieId: 'Schriftliche Anfrage',
      },
    ],
  })}"><tbody></tbody></table>`;

test('parseInquiryList liest ID, Nummer, Titel, Art und Datum aus data-entities', () => {
  const rows = parseInquiryList(LIST_HTML);

  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], {
    id: '1388441',
    url: 'https://parlament.winterthur.ch/politbusiness/1388441',
    number: '2018.8',
    numberSort: '201800008',
    title: 'Kosten und Qualität der Kinderbetreuung',
    type: 'Motion',
    submittedDate: '2018-12-12',
    year: 2018,
  });
  assert.equal(rows[1].id, '2777389');
  assert.equal(rows[1].year, 2026);
});

test('parseInquiryList überspringt Zeilen ohne Geschäftslink und Duplikate', () => {
  const html = `<table id="icmsTable-geschaefteList" data-entities="${dataEntities({
    data: [
      { title: 'Ohne Link', _nummer: '2020.1' },
      { title: '<a href="/_rte/information/42">A</a>', _nummer: '2020.2' },
      { title: '<a href="/politbusiness/42">A (nochmals)</a>', _nummer: '2020.2' },
    ],
  })}"></table>`;

  const rows = parseInquiryList(html);
  assert.deepEqual(
    rows.map((row) => row.id),
    ['42'],
  );
});

test('parseInquiryIds liefert die IDs der gefilterten Liste', () => {
  assert.deepEqual([...parseInquiryIds(LIST_HTML)], ['1388441', '2777389']);
});

test('inquiryListUrl setzt das frühe Startdatum und den Statusfilter', () => {
  const url = new URL(inquiryListUrl({ status: 'erledigt' }));
  assert.equal(url.pathname, '/politbusiness');
  assert.equal(url.searchParams.get('politische_geschaefte_suchformular[vomStart]'), '17.9.1800');
  assert.equal(url.searchParams.get('politische_geschaefte_suchformular[statusId]'), 'erledigt');
  assert.equal(new URL(inquiryListUrl()).searchParams.get('politische_geschaefte_suchformular[statusId]'), '');
});

test('inquiryYear nutzt das Datum, ersatzweise die Geschäftsnummer', () => {
  assert.equal(inquiryYear('2018-12-12', '2018.8'), 2018);
  assert.equal(inquiryYear(null, '2005.95'), 2005);
  assert.equal(inquiryYear(null, null), null);
});

/* ─── Detailseite ──────────────────────────────────────────────────── */

/** Detailseite wie die Quelle sie ausliefert (Felderliste plus Akkordeon). */
const DETAIL_HTML = `<h1>Kontakt</h1><h1>Suche</h1>
<h1>Synergien nutzen bei der Ladeinfrastruktur</h1>
<div class="icms-desclist-container"><dl class="row">
<dt>Nummer</dt><dd>2025.27</dd>
<dt>Geschäftsart</dt><dd>Interpellation</dd>
<dt>Status</dt><dd>Erledigt</dd>
<dt>Eingangsdatum</dt><dd>24. Februar 2025</dd>
<dt>Beschlussdatum Stadtparlament</dt><dd>2. Juni 2025</dd>
<dt>Beschlussart Stadtparlament</dt><dd>Überweisung</dd>
<dt>Abstimmungsresultat Stadtparlament</dt><dd>27:25 (3 Enthaltungen)</dd>
<dt>Frist für Antrag / Beantwortung bis</dt><dd>24. Juli 2025</dd>
<dt>Beantwortung durch Stadtrat vom</dt><dd>18. Juni 2025</dd>
<dt>Geschäft in Vorberatung bei</dt><dd>Sachkommission Stadtbau</dd>
<dt>Beschlussdatum Stadtparlament</dt><dd>19. Januar 2026</dd>
<dt>Beschluss Stadtparlament</dt><dd>Abschreibung</dd>
<dt>Abstimmungsresultat Stadtparlament</dt><dd>einstimmig</dd>
<dt>Bemerkungen</dt><dd>Der Kantonsrat hat am 14. März 2022 entschieden.</dd>
<dt>Verfasser/Beteiligte</dt><dd> <a href="/_rte/person/297689" class="icms-link-person"> Ernst Nora</a> (Erstunterzeichner/-in), Frei Glowatz Katharina (Mitunterzeichner/-in)</dd>
</dl></div>
<div class="icms-accordion-container">
<h3 class="icms-accordion-title"> <a data-toggle="collapse" href="#c1">Dokumente</a> </h3>
<table class="table icms-dt" data-dt-type="static"><thead><tr><th class="dtScopeRow">Name</th><th></th><th class="dtHidden"></th><th class="dtHidden"></th><th class="dtHidden"></th></tr></thead><tbody>
<tr> <td> <a title="2025.27V" href="/_doc/5536708" target="_blank">2025.27V</a> <span class="icms-document-type-and-size"> (PDF, 144 kB)</span><br>Dokumentdatum:<br>24. Februar 2025<br>Kategorie: Vorstoss</td> <td><a href="/_doc/5536708" class="cms-download">Download</a></td> <td>0</td> <td>2025.27V</td> <td>2025-02-24T00:00:00+01:00</td> </tr>
<tr> <td> <a title="2025.27W" href="/_doc/5857537" target="_blank">2025.27W</a> <span class="icms-document-type-and-size"> (PDF, 235 kB)</span><br>Dokumentdatum:<br>18. Juni 2025<br>Kategorie: Antwort Stadtrat</td> <td><a href="/_doc/5857537" class="cms-download">Download</a></td> <td>1</td> <td>2025.27W</td> <td>2025-06-18T00:00:00+02:00</td> </tr>
</tbody></table>
<h3 class="icms-accordion-title"> <a data-toggle="collapse" href="#c2">Sitzungen</a> </h3>
<table class="table icms-dt" id="icmsTableSitzungen" data-entities="${dataEntities({
  emptyColumns: [],
  data: [
    {
      name: '<a href="/_rte/anlass/6789199">9./10. Sitzungen</a>',
      'name-sort': '#2508',
      _datum:
        '<span class="d-none d-md-block"><span class="text-nowrap">19.01.2026, <br>16.15 Uhr - 21.50 Uhr </span></span>',
      '_datum-sort': '#171315250',
    },
  ],
})}"></table>
</div>`;

test('parseStages behält Reihenfolge und Wiederholungen der Felder', () => {
  const stages = parseStages(DETAIL_HTML);

  assert.deepEqual(
    stages.map((stage) => stage.label),
    [
      'Nummer',
      'Geschäftsart',
      'Status',
      'Eingangsdatum',
      'Beschlussdatum Stadtparlament',
      'Beschlussart Stadtparlament',
      'Abstimmungsresultat Stadtparlament',
      'Frist für Antrag / Beantwortung bis',
      'Beantwortung durch Stadtrat vom',
      'Geschäft in Vorberatung bei',
      'Beschlussdatum Stadtparlament',
      'Beschluss Stadtparlament',
      'Abstimmungsresultat Stadtparlament',
      'Bemerkungen',
      'Verfasser/Beteiligte',
    ],
  );
  assert.equal(stages[4].date, '2025-06-02');
  assert.equal(stages[10].date, '2026-01-19');
});

test('parseStages setzt nur bei reinen Datumswerten ein Datum', () => {
  const stages = parseStages(DETAIL_HTML);
  const remarks = stages.find((stage) => stage.label === 'Bemerkungen');

  // Der Bemerkungstext enthält ein Datum, ist aber selbst keines.
  assert.equal(remarks.date, undefined);
  assert.equal(stages.find((stage) => stage.label === 'Beschlussart Stadtparlament').date, undefined);
});

test('parseStages ignoriert die Tabellen der Zusatzsektionen', () => {
  const labels = parseStages(DETAIL_HTML).map((stage) => stage.label);
  assert.equal(labels.includes('Name'), false);
});

test('parseAuthors liest Name, Rolle und verlinkte Personen-ID', () => {
  const authors = parseAuthors(DETAIL_HTML);

  assert.deepEqual(authors[0], {
    name: 'Ernst Nora',
    lastName: 'Ernst',
    firstName: 'Nora',
    role: 'Erstunterzeichner/-in',
    roleId: 'erstunterzeichner',
    personId: '297689',
    personUrl: 'https://parlament.winterthur.ch/behoerdenmitglieder/297689',
  });
  // Mehrteilige Nachnamen: die Quelle schreibt «Nachname Vorname».
  assert.deepEqual(
    { name: authors[1].name, lastName: authors[1].lastName, firstName: authors[1].firstName },
    { name: 'Frei Glowatz Katharina', lastName: 'Frei Glowatz', firstName: 'Katharina' },
  );
  assert.equal(authors[1].personId, null);
  assert.equal(authors[1].roleId, 'mitunterzeichner');
});

test('parseAuthors liefert eine leere Liste ohne Verfasserfeld', () => {
  assert.deepEqual(parseAuthors('<dl><dt>Nummer</dt><dd>2020.1</dd></dl>'), []);
});

test('parseDocuments liest Name, Link, Datum, Kategorie und Dateiangaben', () => {
  const documents = parseDocuments(DETAIL_HTML);

  assert.equal(documents.length, 2);
  assert.deepEqual(documents[0], {
    name: '2025.27V',
    url: 'https://parlament.winterthur.ch/_doc/5536708',
    date: '2025-02-24',
    category: 'Vorstoss',
    fileType: 'PDF',
    fileSize: '144 kB',
  });
  assert.equal(documents[1].category, 'Antwort Stadtrat');
});

test('parseSessions liest Sitzungen samt Datum aus der angezeigten Spalte', () => {
  assert.deepEqual(parseSessions(DETAIL_HTML), [
    {
      id: '6789199',
      name: '9./10. Sitzungen',
      date: '2026-01-19',
      url: 'https://parlament.winterthur.ch/sitzung/6789199',
    },
  ]);
});

test('parseSessions greift nicht auf fremde Tabellen zurück', () => {
  const html = `<table id="icmsTable-geschaefteList" data-entities="${dataEntities({
    data: [{ title: '<a href="/_rte/information/42">A</a>' }],
  })}"></table>`;
  assert.deepEqual(parseSessions(html), []);
});

test('parseTitle nimmt die letzte Überschrift der Seite', () => {
  assert.equal(parseTitle(DETAIL_HTML), 'Synergien nutzen bei der Ladeinfrastruktur');
});

/* ─── Abstimmungen und Beschlüsse ──────────────────────────────────── */

test('parseVoteResult erkennt Ja/Nein, Enthaltungen, Einstimmigkeit und Einzelwerte', () => {
  assert.deepEqual(parseVoteResult('27:25 (3 Enthaltungen)'), {
    raw: '27:25 (3 Enthaltungen)',
    yes: 27,
    no: 25,
    abstentions: 3,
    unanimous: false,
  });
  assert.deepEqual(parseVoteResult('55:0'), { raw: '55:0', yes: 55, no: 0, abstentions: null, unanimous: false });
  assert.deepEqual(parseVoteResult('einstimmig'), {
    raw: 'einstimmig',
    yes: null,
    no: null,
    abstentions: null,
    unanimous: true,
  });
  assert.equal(parseVoteResult('29 Stimmen').yes, 29);
  assert.equal(parseVoteResult('40:14 Stimmen').no, 14);
  assert.equal(parseVoteResult('  '), null);
});

test('buildDecisions bildet je Beschlussdatum einen Beratungsschritt', () => {
  const decisions = buildDecisions(parseStages(DETAIL_HTML));

  assert.equal(decisions.length, 2);
  assert.equal(decisions[0].body, 'Stadtparlament');
  assert.equal(decisions[0].date, '2025-06-02');
  assert.equal(decisions[0].decision, 'Überweisung');
  assert.equal(decisions[0].vote.yes, 27);
  assert.equal(decisions[1].date, '2026-01-19');
  assert.equal(decisions[1].decision, 'Abschreibung');
  assert.equal(decisions[1].vote.unanimous, true);
});

test('buildDecisions trennt Vorberatung und Stadtparlament', () => {
  const decisions = buildDecisions([
    { label: 'Beschlussdatum Vorberatung', value: '13. Juni 2022', date: '2022-06-13' },
    { label: 'Beschluss Vorberatung', value: 'Zustimmende Kenntnisnahme' },
    { label: 'Abstimmungsresultat Vorberatung', value: '10:0' },
    { label: 'Beschlussdatum Stadtparlament', value: '27. Juni 2022', date: '2022-06-27' },
    { label: 'Beschlussart Stadtparlament', value: 'Zustimmung' },
  ]);

  assert.deepEqual(
    decisions.map((decision) => [decision.body, decision.decision]),
    [
      ['Vorberatung', 'Zustimmende Kenntnisnahme'],
      ['Stadtparlament', 'Zustimmung'],
    ],
  );
});

/* ─── Datensatz ────────────────────────────────────────────────────── */

const ROW = {
  id: '2373889',
  url: inquiryUrl('2373889'),
  number: '2025.27',
  numberSort: '202500027',
  title: 'Synergien nutzen bei der Bereitstellung von Ladeinfrastruktur',
  type: 'Interpellation',
  submittedDate: '2025-02-24',
  year: 2025,
};

test('buildRecord fasst Liste und Detailseite zu einem Datensatz zusammen', () => {
  const record = buildRecord({ row: ROW, html: DETAIL_HTML, fetchedAt: '2026-09-17T12:00:00Z' });

  assert.equal(record.id, '2373889');
  assert.equal(record.url, 'https://parlament.winterthur.ch/politbusiness/2373889');
  assert.equal(record.number, '2025.27');
  assert.equal(record.year, 2025);
  // Der Titel der Liste ist vollständig; die Detailseite kürzt ihn.
  assert.equal(record.title, ROW.title);
  assert.equal(record.type, 'Interpellation');
  assert.equal(record.typeId, 'interpellation');
  assert.equal(record.status, 'Erledigt');
  assert.equal(record.closed, true);
  assert.equal(record.submittedDate, '2025-02-24');
  assert.equal(record.committee, 'Sachkommission Stadtbau');
  assert.equal(record.remarks, 'Der Kantonsrat hat am 14. März 2022 entschieden.');
  assert.equal(record.applicant, null);
  assert.equal(record.authors.length, 2);
  assert.equal(record.documents.length, 2);
  assert.equal(record.sessions.length, 1);
  assert.equal(record.fetchedAt, '2026-09-17T12:00:00Z');
  assert.match(record.contentHash, /^[0-9a-f]{16}$/);
});

test('buildRecord leitet die benannten Daten und die Dauer ab', () => {
  const record = buildRecord({ row: ROW, html: DETAIL_HTML, fetchedAt: '2026-09-17T12:00:00Z' });

  assert.deepEqual(record.dates, {
    submitted: '2025-02-24',
    deadline: '2025-07-24',
    answeredByCouncil: '2025-06-18',
    motion: null,
    report: null,
    assigned: null,
    finalDecision: '2026-01-19',
    concluded: '2026-01-19',
  });
  assert.equal(record.concludedSource, 'decision');
  assert.equal(record.durationDays, 329);
});

test('resolveConclusion nutzt das Beschlussdatum der Quelle, wenn vorhanden', () => {
  const result = resolveConclusion({
    finalDecision: '2019-05-06',
    closed: true,
    documents: [{ category: 'Beschluss Stadtparlament', date: '2019-05-20' }],
    sessions: [{ date: '2019-06-03' }],
  });

  assert.deepEqual(result, { concluded: '2019-05-06', concludedSource: 'decision' });
});

test('resolveConclusion weicht bei erledigten Geschäften auf Beschlussdokumente aus', () => {
  const result = resolveConclusion({
    closed: true,
    documents: [
      { category: 'Vorstoss', date: '2012-03-06' },
      { category: 'Überweisungsbeschluss Stadtparlament', date: '2012-09-10' },
      { category: 'Beschluss Stadtparlament', date: '2013-03-18' },
    ],
    sessions: [{ date: '2013-03-18' }],
  });

  assert.deepEqual(result, { concluded: '2013-03-18', concludedSource: 'document' });
});

test('resolveConclusion übergeht Überweisungsbeschlüsse als Zwischenstufe', () => {
  const result = resolveConclusion({
    closed: true,
    documents: [{ category: 'Überweisungsbeschluss Stadtparlament', date: '2012-09-10' }],
    sessions: [{ date: '2012-11-05' }],
  });

  assert.deepEqual(result, { concluded: '2012-11-05', concludedSource: 'session' });
});

test('resolveConclusion leitet bei offenen Geschäften nichts ab', () => {
  const result = resolveConclusion({
    closed: false,
    documents: [{ category: 'Beschluss Stadtparlament', date: '2013-03-18' }],
    sessions: [{ date: '2013-03-18' }],
  });

  assert.deepEqual(result, { concluded: null, concludedSource: null });
});

test('resolveConclusion liefert null, wenn kein Datum greifbar ist', () => {
  assert.deepEqual(resolveConclusion({ closed: true }), { concluded: null, concludedSource: null });
});

test('buildRecord leitet die Dauer erledigter Altgeschäfte aus den Dokumenten ab', () => {
  const html = [
    '<div class="icms-desclist-container"><dl class="row">',
    '<dt>Nummer</dt><dd>2012.18</dd>',
    '<dt>Status</dt><dd>Erledigt</dd>',
    '<dt>Eingangsdatum</dt><dd>5. März 2012</dd>',
    '</dl></div>',
    '<div class="icms-accordion-container">',
    '<h3 class="icms-accordion-title"> <a data-toggle="collapse" href="#c1">Dokumente</a> </h3>',
    '<table class="table icms-dt" data-dt-type="static"><tbody>',
    '<tr><td><a href="/_doc/3472466">eb2012-018</a> <span> (PDF, 33 kB)</span><br>Kategorie: Beschluss Stadtparlament</td>',
    '<td></td><td>1</td><td>eb2012-018</td><td>2013-03-18T00:00:00+01:00</td></tr>',
    '</tbody></table></div>',
  ].join('');
  const record = buildRecord({ row: { id: '1410337', number: '2012.18' }, html });

  assert.equal(record.dates.finalDecision, null);
  assert.equal(record.dates.concluded, '2013-03-18');
  assert.equal(record.concludedSource, 'document');
  assert.equal(record.durationDays, 378);
});

test('buildRecord behandelt Geschäfte ohne Status als offen', () => {
  const html = '<dl><dt>Nummer</dt><dd>2005.95</dd><dt>Eingangsdatum</dt><dd>5. Dezember 2005</dd></dl>';
  const record = buildRecord({ row: { id: '1650575', number: '2005.95' }, html });

  assert.equal(record.status, null);
  assert.equal(record.closed, false);
  assert.equal(record.year, 2005);
  assert.equal(record.concludedSource, null);
  assert.equal(record.durationDays, null);
});

test('contentHash bleibt gleich, wenn sich nur der Abrufzeitpunkt ändert', () => {
  const first = buildRecord({ row: ROW, html: DETAIL_HTML, fetchedAt: '2026-09-17T12:00:00Z' });
  const second = buildRecord({ row: ROW, html: DETAIL_HTML, fetchedAt: '2026-09-24T12:00:00Z' });

  assert.equal(first.contentHash, second.contentHash);
});

/* ─── Abgleich ─────────────────────────────────────────────────────── */

const LIST_ROWS = [
  { id: '1', number: '2020.1', submittedDate: '2020-01-01', type: 'Motion', year: 2020 },
  { id: '2', number: '2020.2', submittedDate: '2020-02-01', type: 'Postulat', year: 2020 },
  { id: '3', number: '2020.3', submittedDate: '2020-03-01', type: 'Motion', year: 2020 },
  { id: '4', number: '2020.4', submittedDate: '2020-04-01', type: 'Motion', year: 2020 },
  { id: '5', number: '2026.1', submittedDate: '2026-01-01', type: 'Motion', year: 2026 },
];

const INDEX = {
  schemaVersion: 1,
  inquiries: [
    { id: '1', number: '2020.1', submittedDate: '2020-01-01', type: 'Motion', closed: true },
    { id: '2', number: '2020.2', submittedDate: '2020-02-01', type: 'Postulat', closed: false },
    { id: '3', number: '2020.3', submittedDate: '2020-03-01', type: 'Motion', closed: true },
    { id: '4', number: '2020.4', submittedDate: '2020-04-01', type: 'Bericht', closed: true },
    { id: '9', number: '2019.9', submittedDate: '2019-01-01', type: 'Motion', closed: true },
  ],
};

test('selectWorkSet holt Neue, Offene, Wiedereröffnete und Geänderte', () => {
  const { targets, reasons, removed } = selectWorkSet({
    listRows: LIST_ROWS,
    closedIds: new Set(['1', '4']),
    index: INDEX,
  });

  assert.deepEqual(
    targets.map(({ row, reason }) => [row.id, reason]),
    [
      ['2', 'open'],
      ['3', 'reopened'],
      ['4', 'changed'],
      ['5', 'new'],
    ],
  );
  assert.deepEqual(reasons, { all: 0, new: 1, open: 1, reopened: 1, changed: 1, missing: 0 });
  assert.deepEqual(removed, ['9']);
});

test('selectWorkSet holt Geschäfte nach, deren Datensatz fehlt', () => {
  // Der Index führt das Geschäft als erledigt, der Shard fehlt oder ist defekt.
  const { targets, reasons } = selectWorkSet({
    listRows: LIST_ROWS,
    closedIds: new Set(['1', '2', '3', '4', '5']),
    index: { schemaVersion: 1, inquiries: LIST_ROWS.map((row) => ({ ...row, closed: true })) },
    storedIds: new Set(['1', '2', '3', '5']),
  });

  assert.deepEqual(
    targets.map(({ row, reason }) => [row.id, reason]),
    [['4', 'missing']],
  );
  assert.equal(reasons.missing, 1);
});

test('selectWorkSet holt ohne Index, mit --full und bei neuem Schema alles', () => {
  const all = { listRows: LIST_ROWS, closedIds: new Set(['1', '2', '3', '4', '5']) };

  assert.equal(selectWorkSet({ ...all, index: null }).targets.length, 5);
  assert.equal(selectWorkSet({ ...all, index: INDEX, full: true }).targets.length, 5);
  assert.equal(selectWorkSet({ ...all, index: { ...INDEX, schemaVersion: 0 } }).reasons.all, 5);
});

test('selectWorkSet meldet nichts, wenn alles erledigt und unverändert ist', () => {
  const index = {
    schemaVersion: 1,
    inquiries: LIST_ROWS.map((row) => ({ ...row, closed: true })),
  };
  const result = selectWorkSet({
    listRows: LIST_ROWS,
    closedIds: new Set(LIST_ROWS.map((row) => row.id)),
    storedIds: new Set(LIST_ROWS.map((row) => row.id)),
    index,
  });

  assert.deepEqual(result.targets, []);
  assert.deepEqual(result.removed, []);
});

/* ─── Ablage ───────────────────────────────────────────────────────── */

const RECORDS = [
  { id: '3', number: '2020.3', numberSort: '202000003', year: 2020, type: 'Motion', status: 'Erledigt', closed: true, submittedDate: '2020-03-01', contentHash: 'c' },
  { id: '1', number: '2020.1', numberSort: '202000001', year: 2020, type: 'Motion', status: 'Erledigt', closed: true, submittedDate: '2020-01-01', contentHash: 'a' },
  { id: '5', number: '2026.1', numberSort: '202600001', year: 2026, type: 'Postulat', status: null, closed: false, submittedDate: '2026-01-01', contentHash: 'e' },
  { id: '7', number: null, numberSort: null, year: null, type: 'Motion', status: 'Erledigt', closed: true, submittedDate: null, contentHash: 'g' },
];

test('shardRecords gruppiert nach Jahr und sortiert stabil', () => {
  const shards = shardRecords(RECORDS);

  assert.deepEqual([...shards.keys()], ['2020.json', '2026.json', 'unbekannt.json']);
  assert.deepEqual(
    shards.get('2020.json').map((record) => record.id),
    ['1', '3'],
  );
  assert.equal(shardName(null), 'unbekannt.json');
});

test('buildIndex zählt Bestand, Jahre und Ausprägungen', () => {
  const index = buildIndex(RECORDS, { generatedAt: '2026-09-17T12:00:00Z', source: 'https://example.test' });

  assert.equal(index.schemaVersion, 1);
  assert.equal(index.generatedAt, '2026-09-17T12:00:00Z');
  assert.equal(index.lastSubmittedDate, '2026-01-01');
  assert.deepEqual(index.counts, {
    total: 4,
    closed: 3,
    open: 1,
    byYear: { 2020: 2, 2026: 1, unbekannt: 1 },
    byType: { Motion: 3, Postulat: 1 },
    byStatus: { Erledigt: 3, unbekannt: 1 },
  });
  assert.deepEqual(index.years, [
    { year: 2020, file: '2020.json', count: 2, open: 0 },
    { year: 2026, file: '2026.json', count: 1, open: 1 },
    { year: null, file: 'unbekannt.json', count: 1, open: 0 },
  ]);
  assert.deepEqual(Object.keys(index.inquiries[0]), [
    'id',
    'number',
    'year',
    'type',
    'status',
    'submittedDate',
    'closed',
    'contentHash',
  ]);
});

test('serializeIndex und serializeShard schreiben eine Zeile je Geschäft', () => {
  const index = buildIndex(RECORDS, { generatedAt: '2026-09-17T12:00:00Z' });
  const text = serializeIndex(index);

  assert.deepEqual(JSON.parse(text), index);
  // Eine Zeile je Eintrag hält die Git-Diffs klein.
  assert.equal(text.split('\n').filter((line) => line.startsWith('    {')).length, RECORDS.length);

  const shard = serializeShard({ year: 2020, records: shardRecords(RECORDS).get('2020.json'), generatedAt: 'x' });
  const parsed = JSON.parse(shard);
  assert.equal(parsed.year, 2020);
  assert.equal(parsed.count, 2);
  assert.deepEqual(
    parsed.inquiries.map((record) => record.id),
    ['1', '3'],
  );
});

test('serializeCollection bleibt bei leerer Sammlung gültiges JSON', () => {
  assert.deepEqual(JSON.parse(serializeShard({ year: 2020, records: [], generatedAt: 'x' })).inquiries, []);
});

test('slugify normalisiert Umlaute und Sonderzeichen', () => {
  assert.equal(slugify('Verordnung / Rechtserlass'), 'verordnung-rechtserlass');
  assert.equal(slugify('übrige Geschäfte'), 'uebrige-geschaefte');
  assert.equal(slugify('Erledigt'), 'erledigt');
});

/* ─── Erweiterungen der icms-Helfer ────────────────────────────────── */

test('extractLabeledFieldPairs behält Wiederholungen, extractLabeledFields nicht', () => {
  const html = '<dl><dt>Beschluss</dt><dd>Überweisung</dd><dt>Beschluss</dt><dd>Abschreibung</dd></dl>';

  assert.deepEqual(
    extractLabeledFieldPairs(html).map((pair) => pair.value),
    ['Überweisung', 'Abschreibung'],
  );
  assert.equal(extractLabeledFields(html).get('beschluss'), 'Überweisung');
});

test('parseDate versteht ausgeschriebene, Schweizer und ISO-Daten', () => {
  assert.equal(parseDate('2. März 2026'), '2026-03-02');
  assert.equal(parseDate('20. April 2026'), '2026-04-20');
  assert.equal(parseDate('5. Dezember 2005'), '2005-12-05');
  assert.equal(parseDate('28.06.2021, 16.15 Uhr'), '2021-06-28');
  assert.equal(parseDate('2025-02-24T00:00:00+01:00'), '2025-02-24');
  assert.equal(parseDate('Zustimmung'), null);
});
