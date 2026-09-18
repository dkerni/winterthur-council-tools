/**
 * Seite «Statistik» — Umschalter zwischen den beiden Auswertungsbereichen.
 *
 * Die Seite fasst die früheren Seiten «Zusammensetzung» und «Vorstösse»
 * zusammen. Ein Umschalter (wie im Mehrheitsrechner) wechselt zwischen
 * «Aktuelle Ratsstatistiken» (Zusammensetzung des Rats) und «Historische
 * Vorstoss Auswertungen» (Geschäfte seit 2000).
 *
 * Der jeweilige Bereich wird erst beim ersten Aufruf aufgebaut; dadurch
 * werden die Diagramme immer in einem sichtbaren Container gezeichnet und
 * die zweite Datenquelle nur bei Bedarf geladen. Die Auswahl steht im
 * URL-Fragment (`#ratsstatistik`, `#vorstoesse`) und bleibt damit teilbar.
 */

import { escapeHtml } from './layout.js';
import { createStatistics } from './stats-ui.js';
import { createInquiryStatistics } from './inquiry-stats-ui.js';

const VIEWS = [
  {
    id: 'ratsstatistik',
    label: 'Aktuelle Ratsstatistiken',
    lead: `Auswertungen zur Zusammensetzung des Stadtparlaments: zuerst gesamthaft (Geschlecht, Alter,
      Amtsdauer, Stadtkreise), danach je Fraktion (Sitzverteilung, Geschlecht, Alter, Amtsdauer).
      Alle Zahlen beruhen ausschliesslich auf den öffentlich publizierten Angaben des
      Parlamentsdienstes; fehlende Angaben werden als solche ausgewiesen.`,
    create: createStatistics,
  },
  {
    id: 'vorstoesse',
    label: 'Historische Vorstoss Auswertungen',
    lead: `Historische Auswertungen zu den politischen Geschäften des Stadtparlaments seit 2000 —
      wer reicht wie viele Vorstösse ein, welche Instrumente werden genutzt, wie unterstützen
      sich die Parteien gegenseitig und wie werden die Vorstösse behandelt. Gruppiert wird
      durchwegs nach <strong>Partei</strong>, nicht nach Fraktion. Alle Zahlen stammen aus den
      öffentlich publizierten Angaben des Parlamentsdienstes; Lücken der Quelle sind unter
      «Datengrundlage» ausgewiesen.`,
    create: createInquiryStatistics,
  },
];

const DEFAULT_VIEW = VIEWS[0].id;

/** Bereich gemäss URL-Fragment; unbekannte Werte fallen auf den Standard zurück. */
function viewFromHash(hash) {
  const id = String(hash || '').replace(/^#/, '');
  return VIEWS.some((view) => view.id === id) ? id : DEFAULT_VIEW;
}

function skeleton() {
  const buttons = VIEWS.map(
    (view) =>
      `<button type="button" id="tab-${view.id}" data-view="${view.id}" aria-pressed="false" aria-controls="view-${
        view.id
      }">${escapeHtml(view.label)}</button>`,
  ).join('');

  const panels = VIEWS.map(
    (view) =>
      `<section id="view-${view.id}" data-panel="${view.id}" aria-labelledby="tab-${view.id}" hidden>
        <p class="loading">Daten werden geladen …</p>
      </section>`,
  ).join('');

  return `
    <div class="toolbar">
      <span class="segmented" role="group" aria-label="Auswertung">${buttons}</span>
    </div>
    <p class="page-lead" data-lead></p>
    ${panels}`;
}

/**
 * Baut die Statistik-Seite mit Umschalter in den Container.
 * @param {HTMLElement} container
 */
export function createStatisticsPage(container) {
  container.innerHTML = skeleton();

  const lead = container.querySelector('[data-lead]');
  const buttons = Array.from(container.querySelectorAll('[data-view]'));
  const started = new Set();
  let active = null;

  function show(id, { updateHash = true } = {}) {
    const view = VIEWS.find((entry) => entry.id === id) || VIEWS[0];
    if (active === view.id) return;
    active = view.id;

    lead.innerHTML = view.lead;

    buttons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.view === view.id));
    });

    VIEWS.forEach((entry) => {
      const panel = container.querySelector(`[data-panel="${entry.id}"]`);
      panel.hidden = entry.id !== view.id;
    });

    if (updateHash && window.location.hash !== `#${view.id}`) {
      window.history.replaceState(null, '', `#${view.id}`);
    }

    if (!started.has(view.id)) {
      started.add(view.id);
      // Erst jetzt aufbauen: der Container ist sichtbar, die Diagramme
      // erhalten dadurch von Beginn weg die richtige Grösse.
      view.create(container.querySelector(`[data-panel="${view.id}"]`));
    }
  }

  buttons.forEach((button) => {
    button.addEventListener('click', () => show(button.dataset.view));
  });

  window.addEventListener('hashchange', () => {
    show(viewFromHash(window.location.hash), { updateHash: false });
  });

  show(viewFromHash(window.location.hash), { updateHash: false });
}
