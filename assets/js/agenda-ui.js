/**
 * Download-Bereich für die Traktandenliste der nächsten Sitzung.
 *
 * Die Daten stammen aus `data/agenda.json`, das der Workflow
 * «Traktandenliste aktualisieren» täglich schreibt. Ist keine Sitzung
 * publiziert (`status: 'none'`), erscheint statt des Downloads ein Hinweis.
 */

import { escapeHtml } from './layout.js';
import { fetchJson, siteUrl } from './paths.js';

const NO_AGENDA_TEXT = 'Es sind noch keine Sitzungstraktanden verfügbar.';

/** Datum im Format `21.09.2026`. */
function formatDay(isoDate) {
  if (!isoDate) return '';
  const [year, month, day] = String(isoDate).split('-');
  return year && month && day ? `${day}.${month}.${year}` : String(isoDate);
}

/** Beschreibung der Sitzung, z.B. «Sitzung vom 21.09.2026 und 05.10.2026». */
function describeSession(session) {
  const dates = (session?.dates?.length ? session.dates : [session?.date]).filter(Boolean).map(formatDay);
  if (!dates.length) return session?.title || 'Nächste Sitzung';
  const list = dates.length === 1 ? dates[0] : `${dates.slice(0, -1).join(', ')} und ${dates[dates.length - 1]}`;
  return `Sitzung vom ${list}`;
}

function renderUnavailable(container, message) {
  container.innerHTML = `
    <p class="notice info">${escapeHtml(message)}</p>
    <p><button type="button" class="btn" disabled aria-disabled="true">Traktandenliste als Excel</button></p>`;
}

function renderDownload(container, agenda) {
  const { session } = agenda;
  const count = session?.itemCount ?? 0;
  const sessionLink = session?.url
    ? ` <a href="${escapeHtml(session.url)}" rel="noopener noreferrer" target="_blank">Sitzung beim Parlamentsdienst</a>`
    : '';
  container.innerHTML = `
    <p class="agenda-summary">
      <strong>${escapeHtml(describeSession(session))}</strong> — ${count} Traktanden.${sessionLink}
    </p>
    <p>
      <a class="btn primary" href="${escapeHtml(siteUrl(agenda.file))}" download="${escapeHtml(
        agenda.fileName || 'Traktandenliste.xlsx',
      )}">Traktandenliste als Excel</a>
    </p>
    <p class="hint">
      Enthält Nr., Geschäft (verlinkt), Geschäftart und Bezeichnung; die Spalten für die
      Fraktionsarbeit bleiben leer.
    </p>`;
}

/**
 * Baut den Download-Bereich in ein Element.
 * @param {HTMLElement|null} container
 * @returns {Promise<void>}
 */
export async function createAgendaDownload(container) {
  if (!container) return;
  container.classList.add('agenda-download');
  try {
    const agenda = await fetchJson('data/agenda.json');
    if (agenda?.status === 'ok' && agenda.file && (agenda.session?.itemCount ?? 0) > 0) {
      renderDownload(container, agenda);
    } else {
      renderUnavailable(container, agenda?.message || NO_AGENDA_TEXT);
    }
  } catch {
    renderUnavailable(container, NO_AGENDA_TEXT);
  }
}
