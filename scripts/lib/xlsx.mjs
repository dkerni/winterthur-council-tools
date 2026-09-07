/**
 * Minimaler XLSX-Writer.
 *
 * Das Projekt kommt bewusst ohne Laufzeit-Abhängigkeiten aus. Eine
 * Tabellenmappe im Format Office Open XML ist ein ZIP-Archiv mit wenigen
 * XML-Dateien — das lässt sich mit den Bordmitteln von Node (`zlib`) direkt
 * erzeugen. Unterstützt werden Text- und Zahlenzellen, Hyperlinks, ein
 * Kopfbereich mit Logo, eine farbige Titelzeile mit Autofilter, alternierende
 * Zeilenfarben und Spaltenbreiten.
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

const CONTENT_TYPES_BASE = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`;

/** `[Content_Types].xml`; mit Bild kommen PNG- und Zeichnungs-Teil dazu. */
function contentTypesXml(hasImage) {
  const image = hasImage
    ? '\n<Default Extension="png" ContentType="image/png"/>' +
      '\n<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
    : '';
  return `${CONTENT_TYPES_BASE}${image}\n</Types>`;
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

/* Farben aus dem Logo der Mitte-Fraktion: Dunkelblau als Kopffarbe, eine helle
 * Ableitung für jede zweite Zeile, Orange als Akzent der Titelzeile. */
const COLOR_HEADER = 'FF003C69';
const COLOR_BAND = 'FFE8EFF5';
const COLOR_BORDER = 'FFB6C6D6';
const COLOR_ACCENT = 'FFFF9B00';

/**
 * Stile der Arbeitsmappe (Reihenfolge = Index in `cellXfs`):
 * 0 Datenzelle, 1 Datenzelle getönt, 2 Link, 3 Link getönt, 4 Kopfzeile,
 * 5 Titel, 6 Kopfbereich-Text, 7 Kopfbereich-Link, 8 Trennlinie.
 */
const STYLE = {
  body: 0,
  bodyBand: 1,
  link: 2,
  linkBand: 3,
  header: 4,
  title: 5,
  meta: 6,
  metaLink: 7,
  accent: 8,
};

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font>
<font><u/><color rgb="FF0563C1"/><sz val="11"/><name val="Calibri"/></font>
<font><b/><color rgb="${COLOR_HEADER}"/><sz val="14"/><name val="Calibri"/></font>
<font><color rgb="${COLOR_HEADER}"/><sz val="11"/><name val="Calibri"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="${COLOR_HEADER}"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="${COLOR_BAND}"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="3">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="${COLOR_BORDER}"/></left><right style="thin"><color rgb="${COLOR_BORDER}"/></right><top style="thin"><color rgb="${COLOR_BORDER}"/></top><bottom style="thin"><color rgb="${COLOR_BORDER}"/></bottom><diagonal/></border>
<border><left/><right/><top/><bottom style="medium"><color rgb="${COLOR_ACCENT}"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1"/>
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

/* ─── Kopfbereich mit Logo ─────────────────────────────────────────── */

/** Bildmasse in EMU (English Metric Units), der Einheit von DrawingML. */
const EMU_PER_PIXEL = 9525;

/** Zeilenhöhen des Kopfbereichs in Punkt; Logohöhe in Bildpunkten. */
const TITLE_ROW_HEIGHT = 22;
const META_ROW_HEIGHT = 16;
const SPACER_ROW_HEIGHT = 8;
const LOGO_HEIGHT_PX = 56;

/**
 * Masse einer PNG-Datei aus dem IHDR-Block (erster Chunk nach der Signatur).
 * @param {Buffer} data
 * @returns {{width: number, height: number}|null}
 */
export function pngSize(data) {
  if (!Buffer.isBuffer(data) || data.length < 24) return null;
  if (data.readUInt32BE(0) !== 0x89504e47 || data.toString('ascii', 12, 16) !== 'IHDR') return null;
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * Zeichnung mit genau einem Bild, verankert an einer Zelle (`oneCellAnchor`),
 * damit es beim Ändern von Spaltenbreiten nicht verzerrt wird.
 */
function drawingXml({ column, row, widthPx, heightPx, name }) {
  const cx = Math.round(widthPx * EMU_PER_PIXEL);
  const cy = Math.round(heightPx * EMU_PER_PIXEL);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
<xdr:oneCellAnchor>
<xdr:from><xdr:col>${column}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${EMU_PER_PIXEL * 2}</xdr:rowOff></xdr:from>
<xdr:ext cx="${cx}" cy="${cy}"/>
<xdr:pic>
<xdr:nvPicPr><xdr:cNvPr id="1" name="${escapeXml(name)}" descr="${escapeXml(name)}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr>
<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdImg1"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>
<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>
</xdr:pic>
<xdr:clientData/>
</xdr:oneCellAnchor>
</xdr:wsDr>`;
}

/**
 * Erzeugt eine Arbeitsmappe mit genau einem Arbeitsblatt.
 *
 * Zellwerte sind entweder Skalare (Text/Zahl) oder `{ text, link }` für einen
 * Hyperlink. Über `title` entsteht oberhalb der Tabelle ein Kopfbereich:
 * Titelzeile, weitere Textzeilen (auch verlinkt) und rechts ein Logo.
 *
 * @param {object} options
 * @param {string} [options.sheetName] Blattname (max. 31 Zeichen)
 * @param {string[]} options.columns Spaltenüberschriften
 * @param {Array<Array<string|number|null|{text: string, link?: string|null}>>} options.rows Datenzeilen
 * @param {number[]} [options.columnWidths] Spaltenbreiten in Zeichen
 * @param {object} [options.title] Kopfbereich über der Tabelle
 * @param {Array<string|{text: string, link?: string|null}>} [options.title.lines] Zeilen des Kopfbereichs
 * @param {{data: Buffer, name?: string, height?: number}} [options.title.image] PNG rechts im Kopfbereich
 * @param {Date} [options.modified] Zeitstempel der ZIP-Einträge
 * @returns {Buffer} Inhalt der `.xlsx`-Datei
 */
export function createWorkbook({ sheetName = 'Tabelle1', columns, rows, columnWidths, title, modified }) {
  if (!Array.isArray(columns) || columns.length === 0) {
    throw new Error('createWorkbook: columns darf nicht leer sein');
  }

  const hyperlinks = [];
  const sheetRows = [];
  const merges = [];

  const titleLines = (title?.lines ?? [])
    .map((line) => (line && typeof line === 'object' ? line : { text: line }))
    .filter((line) => line.text != null && String(line.text) !== '');
  // Der Kopfbereich sind die Textzeilen plus eine Leerzeile als Abstand.
  const headerRow = titleLines.length ? titleLines.length + 2 : 1;
  // Die letzten beiden Spalten bleiben für das Logo frei.
  const titleSpan = Math.max(1, columns.length - 2);

  titleLines.forEach((line, index) => {
    const rowNumber = index + 1;
    const styleId = index === 0 ? STYLE.title : line.link ? STYLE.metaLink : STYLE.meta;
    if (line.link) hyperlinks.push({ reference: `A${rowNumber}`, target: line.link });
    const cells = [cellXml(`A${rowNumber}`, line.text, styleId)];
    for (let column = 2; column <= titleSpan; column++) {
      cells.push(cellXml(`${columnName(column)}${rowNumber}`, '', styleId));
    }
    if (titleSpan > 1) merges.push(`A${rowNumber}:${columnName(titleSpan)}${rowNumber}`);
    const height = index === 0 ? TITLE_ROW_HEIGHT : META_ROW_HEIGHT;
    sheetRows.push(`<row r="${rowNumber}" ht="${height}" customHeight="1">${cells.join('')}</row>`);
  });

  if (titleLines.length) {
    // Leerzeile mit farbiger Trennlinie zwischen Kopfbereich und Tabelle.
    const rowNumber = titleLines.length + 1;
    const cells = columns.map((_, index) => cellXml(`${columnName(index + 1)}${rowNumber}`, '', STYLE.accent));
    sheetRows.push(
      `<row r="${rowNumber}" ht="${SPACER_ROW_HEIGHT}" customHeight="1">${cells.join('')}</row>`,
    );
  }

  const headerCells = columns.map((label, index) =>
    cellXml(`${columnName(index + 1)}${headerRow}`, label, STYLE.header),
  );
  sheetRows.push(`<row r="${headerRow}" ht="18" customHeight="1">${headerCells.join('')}</row>`);

  rows.forEach((row, rowIndex) => {
    const rowNumber = headerRow + rowIndex + 1;
    // Klassische Tabellenoptik: jede zweite Datenzeile wird eingefärbt.
    const banded = rowIndex % 2 === 1;
    const cells = columns.map((_, columnIndex) => {
      const reference = `${columnName(columnIndex + 1)}${rowNumber}`;
      const raw = row[columnIndex];
      if (raw && typeof raw === 'object') {
        if (raw.link) {
          hyperlinks.push({ reference, target: raw.link });
          return cellXml(reference, raw.text ?? raw.link, banded ? STYLE.linkBand : STYLE.link);
        }
        return cellXml(reference, raw.text ?? '', banded ? STYLE.bodyBand : STYLE.body);
      }
      return cellXml(reference, raw, banded ? STYLE.bodyBand : STYLE.body);
    });
    sheetRows.push(`<row r="${rowNumber}">${cells.join('')}</row>`);
  });

  const widths = columns
    .map((_, index) => {
      const width = columnWidths?.[index];
      return width ? `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>` : '';
    })
    .join('');

  const image = title?.image?.data ? title.image : null;
  const natural = image ? pngSize(image.data) : null;
  const logoHeight = image?.height ?? LOGO_HEIGHT_PX;
  const drawing = image
    ? drawingXml({
        column: Math.max(0, columns.length - 2),
        row: 0,
        widthPx: natural ? Math.round((logoHeight * natural.width) / natural.height) : logoHeight,
        heightPx: logoHeight,
        name: image.name || 'Logo',
      })
    : null;

  const lastColumn = columnName(columns.length);
  const lastRow = headerRow + rows.length;
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
  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>`
    : '';

  // Reihenfolge der Elemente ist im Schema festgelegt: sheetData, autoFilter,
  // mergeCells, hyperlinks, drawing.
  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
${widths ? `<cols>${widths}</cols>` : ''}
<sheetData>${sheetRows.join('')}</sheetData>
<autoFilter ref="A${headerRow}:${lastColumn}${lastRow}"/>
${mergeXml}
${hyperlinkXml}
${drawing ? '<drawing r:id="rIdDr1"/>' : ''}
</worksheet>`;

  const entries = [
    { name: '[Content_Types].xml', data: contentTypesXml(Boolean(drawing)) },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'xl/workbook.xml', data: workbookXml(sheetName.slice(0, 31)) },
    { name: 'xl/_rels/workbook.xml.rels', data: WORKBOOK_RELS },
    { name: 'xl/styles.xml', data: STYLES },
    { name: 'xl/worksheets/sheet1.xml', data: sheetXml },
  ];

  const drawingRel = drawing
    ? '<Relationship Id="rIdDr1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>'
    : '';
  if (hyperlinks.length || drawing) {
    entries.push({
      name: 'xl/worksheets/_rels/sheet1.xml.rels',
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hyperlinkRels}${drawingRel}</Relationships>`,
    });
  }
  if (drawing) {
    entries.push(
      { name: 'xl/drawings/drawing1.xml', data: drawing },
      {
        name: 'xl/drawings/_rels/drawing1.xml.rels',
        data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
      },
      { name: 'xl/media/image1.png', data: image.data },
    );
  }

  return createZip(entries, modified);
}
