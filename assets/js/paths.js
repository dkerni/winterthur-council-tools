/**
 * Pfad-Auflösung.
 *
 * Die Website läuft sowohl unter `/` (lokaler Server) als auch unter
 * `/winterthur-council-tools/` (GitHub Pages) und wird aus unterschiedlichen
 * Verzeichnistiefen aufgerufen (`/index.html`, `/tools/*.html`).
 * Alle Module liegen unter `<basis>/assets/js/`, deshalb lässt sich die
 * Basis-URL zuverlässig aus `import.meta.url` ableiten — ohne absolute Pfade.
 */

/** Basis-URL der Website (Verzeichnis, das `assets/`, `data/`, `tools/` enthält). */
export const SITE_BASE = new URL('../../', import.meta.url);

/**
 * Absolute URL zu einer Datei relativ zur Website-Basis.
 * @param {string} relPath z.B. 'data/members.json'
 * @returns {string}
 */
export function siteUrl(relPath) {
  return new URL(relPath, SITE_BASE).href;
}

/**
 * Lädt eine JSON-Datei relativ zur Website-Basis.
 * @param {string} relPath z.B. 'data/members.json'
 * @returns {Promise<object>}
 */
export async function fetchJson(relPath) {
  const res = await fetch(siteUrl(relPath));
  if (!res.ok) throw new Error(`${relPath}: HTTP ${res.status}`);
  return res.json();
}
