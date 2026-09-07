/**
 * Minimaler XLSX-Writer.
 *
 * Das Projekt kommt bewusst ohne Laufzeit-Abhängigkeiten aus. Eine
 * Tabellenmappe im Format Office Open XML ist ein ZIP-Archiv mit wenigen
 * XML-Dateien — das lässt sich mit den Bordmitteln von Node (`zlib`) direkt
 * erzeugen. Unterstützt werden Text- und Zahlenzellen, Hyperlinks, eine fette
 * Kopfzeile mit Autofilter und Spaltenbreiten.
 */

import { deflateRawSync } from 'node:zlib';

/* ─── ZIP ──────────────────────────────────────────────────────────── */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Datum/Zeit im MS-DOS-Format (Sekundengenauigkeit: 2 s). */
function dosDateTime(date) {
  const year = Math.max(1980, date.getUTCFullYear());
  const time = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
  const day = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  return { time, day };
}

/**
 * Baut ein ZIP-Archiv (Deflate, ohne Data-Descriptor).
 * @param {Array<{name: string, data: string|Buffer}>} entries
 * @param {Date} [modified] Zeitstempel der Einträge (Default: jetzt)
 * @returns {Buffer}
 */
export function createZip(entries, modified = new Date()) {
  const { time, day } = dosDateTime(modified);
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const content = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const compressed = deflateRawSync(content, { level: 9 });
    const crc = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // benötigte Version
    local.writeUInt16LE(0x0800, 6); // UTF-8-Dateinamen
    local.writeUInt16LE(8, 8); // Deflate
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // erzeugende Version
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralDirectory, end]);
}

/* ─── XLSX ─────────────────────────────────────────────────────────── */

/** Maskiert Text für XML und entfernt in XML unzulässige Steuerzeichen. */
export function escapeXml(value) {
  return String(value ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Spaltenbuchstabe zu einem 1-basierten Index (1 → A, 27 → AA). */
export function columnName(index) {
  let name = '';
  let rest = index;
  while (rest > 0) {
    const remainder = (rest - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    rest = Math.floor((rest - 1) / 26);
  }
  return name;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

// Stile: 0 = Standard, 1 = fett (Kopfzeile), 2 = Hyperlink (blau, unterstrichen).
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="3">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><u/><color rgb="FF0563C1"/><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFEFEF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="3">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

function workbookXml(sheetName) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
}

function cellXml(reference, value, styleId) {
  if (value == null || value === '') return `<c r="${reference}" s="${styleId}"/>`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${reference}" s="${styleId}"><v>${value}</v></c>`;
  }
  return `<c r="${reference}" s="${styleId}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

/**
 * Erzeugt eine Arbeitsmappe mit genau einem Arbeitsblatt.
 *
 * Zellwerte sind entweder Skalare (Text/Zahl) oder `{ text, link }` für einen
 * Hyperlink.
 *
 * @param {object} options
 * @param {string} [options.sheetName] Blattname (max. 31 Zeichen)
 * @param {string[]} options.columns Spaltenüberschriften
 * @param {Array<Array<string|number|null|{text: string, link?: string|null}>>} options.rows Datenzeilen
 * @param {number[]} [options.columnWidths] Spaltenbreiten in Zeichen
 * @param {Date} [options.modified] Zeitstempel der ZIP-Einträge
 * @returns {Buffer} Inhalt der `.xlsx`-Datei
 */
export function createWorkbook({ sheetName = 'Tabelle1', columns, rows, columnWidths, modified }) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('createWorkbook: columns darf nicht leer sein');
  }

  const hyperlinks = [];
  const sheetRows = [];

  const headerCells = columns.map((label, index) => cellXml(`${columnName(index + 1)}1`, label, 1));
  sheetRows.push(`<row r="1">${headerCells.join('')}</row>`);

  rows.forEach((row, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const cells = columns.map((_, columnIndex) => {
      const reference = `${columnName(columnIndex + 1)}${rowNumber}`;
      const raw = row[columnIndex];
      if (raw && typeof raw === 'object') {
        if (raw.link) {
          hyperlinks.push({ reference, target: raw.link });
          return cellXml(reference, raw.text ?? raw.link, 2);
        }
        return cellXml(reference, raw.text ?? '', 0);
      }
      return cellXml(reference, raw, 0);
    });
    sheetRows.push(`<row r="${rowNumber}">${cells.join('')}</row>`);
  });

  const widths = columns
    .map((_, index) => {
      const width = columnWidths?.[index];
      return width ? `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>` : '';
    })
    .join('');

  const lastColumn = columnName(columns.length);
  const lastRow = rows.length + 1;
  const hyperlinkRels = hyperlinks
    .map(
      (link, index) =>
        `<Relationship Id="rHl${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(
          link.target,
        )}" TargetMode="External"/>`,
    )
    .join('');
  const hyperlinkXml = hyperlinks.length
    ? `<hyperlinks>${hyperlinks
        .map((link, index) => `<hyperlink ref="${link.reference}" r:id="rHl${index + 1}"/>`)
        .join('')}</hyperlinks>`
    : '';

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
${widths ? `<cols>${widths}</cols>` : ''}
<sheetData>${sheetRows.join('')}</sheetData>
<autoFilter ref="A1:${lastColumn}${lastRow}"/>
${hyperlinkXml}
</worksheet>`;

  const entries = [
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'xl/workbook.xml', data: workbookXml(sheetName.slice(0, 31)) },
    { name: 'xl/_rels/workbook.xml.rels', data: WORKBOOK_RELS },
    { name: 'xl/styles.xml', data: STYLES },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
  ];
  if (hyperlinks.length) {
    entries.push({
      name: 'xl/worksheets/_rels/sheet1.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hyperlinkRels}</Relationships>`,
    });
  }

  return createZip(entries, modified);
}
