/**
 * CSV-Export.
 *
 * Erzeugt RFC-4180-konformes CSV (Semikolon als Trennzeichen, damit Excel in
 * der Schweiz die Spalten direkt erkennt) und stösst den Download an.
 */

const SEPARATOR = ';';

/** Maskiert einen einzelnen Wert. */
function escapeCell(value) {
  const text = value == null ? '' : String(value);
  return /["\n\r;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Wandelt Objekte in CSV um.
 * @param {Array<object>} rows
 * @param {string[]} [columns] Spaltenreihenfolge (Default: Schlüssel der ersten Zeile)
 * @returns {string}
 */
export function toCsv(rows, columns) {
  if (!rows.length) return '';
  const keys = columns || Object.keys(rows[0]);
  const header = keys.map(escapeCell).join(SEPARATOR);
  const body = rows.map((row) => keys.map((key) => escapeCell(row[key])).join(SEPARATOR));
  return [header, ...body].join('\r\n');
}

/**
 * Lädt einen CSV-Text als Datei herunter (mit BOM für Excel).
 * @param {string} filename
 * @param {string} csv
 */
export function downloadCsv(filename, csv) {
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** Dateiname mit aktuellem Datum, z.B. `mitglieder_2026-08-03.csv`. */
export function datedFilename(prefix) {
  return `${prefix}_${new Date().toISOString().slice(0, 10)}.csv`;
}
