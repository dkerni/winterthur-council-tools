/**
 * Diagramme — dünner Wrapper um Chart.js.
 *
 * Chart.js wird per CDN eingebunden (feste Version, SRI-Hash, `defer`); der
 * `<script>`-Tag steht in der jeweiligen Seite. Ist das CDN nicht erreichbar
 * oder stimmt der SRI-Hash nicht, wird automatisch eine barrierearme
 * HTML-Tabelle mit Balken als Ersatzdarstellung gerendert — die Seite bleibt
 * damit auch offline nutzbar.
 */

import { escapeHtml } from './layout.js';

const CHART_SCRIPT_ID = 'chartjs';
const LOAD_TIMEOUT_MS = 8000;

let chartPromise = null;

/**
 * Wartet auf das global bereitgestellte `Chart`-Objekt.
 * @returns {Promise<any>}
 */
export function loadChartLibrary() {
  if (!chartPromise) {
    chartPromise = new Promise((resolve, reject) => {
      if (window.Chart) {
        resolve(window.Chart);
        return;
      }

      const script = document.getElementById(CHART_SCRIPT_ID);
      if (!script) {
        reject(new Error('Chart.js ist auf dieser Seite nicht eingebunden.'));
        return;
      }

      const timer = setTimeout(() => {
        settle(new Error('Chart.js konnte nicht geladen werden (Zeitüberschreitung).'));
      }, LOAD_TIMEOUT_MS);

      function settle(err) {
        clearTimeout(timer);
        if (window.Chart) resolve(window.Chart);
        else reject(err);
      }

      script.addEventListener('load', () => settle(new Error('Chart.js stellt kein «Chart» bereit.')));
      script.addEventListener('error', () => settle(new Error('Chart.js konnte nicht geladen werden.')));

      // `defer`-Skripte laufen vor `DOMContentLoaded`; spätestens beim
      // `load`-Ereignis steht fest, ob die Bibliothek verfügbar ist. Damit
      // greift die Ersatzdarstellung sofort und nicht erst nach dem Timeout.
      if (document.readyState === 'complete') {
        settle(new Error('Chart.js konnte nicht geladen werden.'));
      } else {
        window.addEventListener('load', () => settle(new Error('Chart.js konnte nicht geladen werden.')));
      }
    }).catch((err) => {
      chartPromise = null;
      throw err;
    });
  }
  return chartPromise;
}

const FONT_FAMILY = "'Helvetica Neue', Helvetica, Arial, sans-serif";

function baseOptions(extra = {}) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    plugins: {
      legend: { display: false, labels: { font: { family: FONT_FAMILY, size: 11 } } },
      tooltip: {
        backgroundColor: 'rgba(10,10,10,.9)',
        titleFont: { family: FONT_FAMILY, size: 12 },
        bodyFont: { family: FONT_FAMILY, size: 12 },
      },
      ...(extra.plugins || {}),
    },
    ...extra,
  };
}

/**
 * Zeichnet ein Diagramm in einen Container (`.chart-canvas-wrap`).
 * Fällt bei fehlendem Chart.js auf eine Tabellendarstellung zurück.
 *
 * @param {HTMLElement} container
 * @param {{type: string, labels: string[], values: number[], colors?: string[],
 *          horizontal?: boolean, unit?: string, stepSize?: number}} spec
 */
export async function renderChart(container, spec) {
  const { labels, values, colors, type = 'bar', horizontal = false, unit = '', stepSize } = spec;

  if (!labels.length || values.every((value) => !value)) {
    container.innerHTML = '<p class="empty">Für diese Auswertung liegen keine Daten vor.</p>';
    return;
  }

  let Chart;
  try {
    Chart = await loadChartLibrary();
  } catch (err) {
    renderFallback(container, spec, err);
    return;
  }

  container.innerHTML = '';
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);

  const dataset = {
    data: values,
    backgroundColor: colors || '#6b7f9e',
    borderWidth: type === 'doughnut' ? 2 : 0,
    borderColor: '#fff',
    borderRadius: type === 'bar' ? 3 : 0,
  };

  const options =
    type === 'doughnut'
      ? baseOptions({
          cutout: '58%',
          plugins: { legend: { display: true, position: 'right', labels: { font: { family: FONT_FAMILY, size: 11 } } } },
        })
      : baseOptions({
          indexAxis: horizontal ? 'y' : 'x',
          scales: {
            x: {
              beginAtZero: true,
              ticks: { font: { family: FONT_FAMILY, size: 11 }, stepSize },
              grid: { color: '#eee' },
            },
            y: {
              beginAtZero: true,
              ticks: { font: { family: FONT_FAMILY, size: 11 }, stepSize },
              grid: { color: '#eee' },
            },
          },
          plugins: {
            tooltip: {
              callbacks: {
                label: (context) => `${context.parsed[horizontal ? 'x' : 'y']}${unit ? ' ' + unit : ''}`,
              },
            },
          },
        });

  return new Chart(canvas, { type, data: { labels, datasets: [dataset] }, options });
}

/** Ersatzdarstellung ohne Chart.js: Tabelle mit Balken. */
function renderFallback(container, { labels, values, colors, unit = '' }, err) {
  const max = Math.max(...values, 1);
  const rows = labels
    .map((label, index) => {
      const color = Array.isArray(colors) ? colors[index] : colors || '#6b7f9e';
      const width = Math.round((values[index] / max) * 100);
      return `<tr>
        <td>${escapeHtml(label)}</td>
        <td class="num">${values[index]}${unit ? ' ' + escapeHtml(unit) : ''}</td>
        <td style="width:55%"><span class="bar-cell" style="width:${width}%;background:${escapeHtml(color)}"></span></td>
      </tr>`;
    })
    .join('');

  container.innerHTML = `
    <p class="chart-fallback">Diagramm nicht verfügbar (${escapeHtml(err.message)}) — Werte als Tabelle:</p>
    <table class="dist-table"><tbody>${rows}</tbody></table>`;
}
