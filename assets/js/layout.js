/**
 * Gemeinsames Seitengerüst — Header, Navigation, Footer und Disclaimer.
 *
 * Wird von allen Seiten eingebunden. Die aktive Navigation ergibt sich aus
 * `document.body.dataset.page`. Alle Links sind relativ zur Website-Basis,
 * damit die Seite auch unter `/winterthur-council-tools/` funktioniert.
 */

import { siteUrl } from './paths.js';
import { ensureAccess, forgetKey } from './access.js';
import { loadPartyMeta, applyPartyCssVars } from './parties.js';
import { loadDatabase, formatDate } from './data.js';

const SOURCE_URL = 'https://parlament.winterthur.ch';
const AUTHOR_URL = 'https://dominik-kern.ch/';

const NAV_ITEMS = [
  { page: 'start', label: 'Start', href: 'index.html' },
  { page: 'sitzplan', label: 'Sitzplan', href: 'tools/sitzplan.html' },
  { page: 'mehrheitsrechner', label: 'Mehrheitsrechner', href: 'tools/mehrheitsrechner.html' },
  { page: 'statistik', label: 'Statistik', href: 'tools/statistik.html' },
  { page: 'mitglieder', label: 'Mitglieder', href: 'tools/mitglieder.html' },
  { page: 'impressum', label: 'Impressum', href: 'impressum.html' },
];

/** Escaped Text für die Verwendung in HTML. */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHeader() {
  const header = document.createElement('header');
  header.className = 'site-header';
  header.innerHTML = `
    <a href="${siteUrl('index.html')}" aria-label="Zur Startseite">
      <img class="logo" src="${siteUrl('media/Wappen_Winterthur.svg.webp')}" alt="Wappen Winterthur" />
    </a>
    <a class="site-title" href="${siteUrl('index.html')}">
      Stadtparlament Winterthur Tools
      <span>Werkzeuge rund um das Stadtparlament Winterthur</span>
    </a>`;
  return header;
}

function buildNav(activePage) {
  const nav = document.createElement('nav');
  nav.className = 'site-nav';
  nav.setAttribute('aria-label', 'Hauptnavigation');
  nav.innerHTML = `<ul>${NAV_ITEMS.map((item) => {
    const current = item.page === activePage ? ' aria-current="page"' : '';
    return `<li><a href="${siteUrl(item.href)}"${current}>${escapeHtml(item.label)}</a></li>`;
  }).join('')}</ul>`;
  return nav;
}

function buildFooter() {
  const footer = document.createElement('footer');
  footer.className = 'site-footer';
  footer.innerHTML = `
    <div class="footer-inner">
      <p>
        Datenquelle: <a href="${SOURCE_URL}" rel="noopener noreferrer" target="_blank">parlament.winterthur.ch</a>
        — Stadt Winterthur. Alle Angaben ohne Gewähr. Dieses Projekt ist ein privates Angebot und
        steht in keiner Verbindung zur Stadt Winterthur oder zum Parlamentsdienst.
        Erstellt von <a href="${AUTHOR_URL}" rel="noopener noreferrer" target="_blank">Dominik Kern</a>.
        Weitere Angaben im <a href="${siteUrl('impressum.html')}">Impressum</a>.
      </p>
      <p class="footer-meta">
        Datenstand: <span data-generated-at>wird geladen …</span>
      </p>
    </div>`;
  return footer;
}

/** Trägt den Datenstand (`generatedAt`) in alle `[data-generated-at]`-Elemente ein. */
async function fillDataStatus() {
  const targets = document.querySelectorAll('[data-generated-at]');
  if (!targets.length) return;
  try {
    const db = await loadDatabase();
    const text = db.generatedAt ? formatDate(db.generatedAt) : 'unbekannt';
    const provisional = db.dataQuality && db.dataQuality.complete === false ? ' (vorläufig)' : '';
    targets.forEach((el) => {
      el.textContent = text + provisional;
    });
  } catch {
    targets.forEach((el) => {
      el.textContent = 'nicht verfügbar';
    });
  }
}

/** Fügt bei geschützten Deployments einen «Sperren»-Knopf in den Footer ein. */
function addLockButton() {
  const target = document.querySelector('.site-footer .footer-inner');
  if (!target || target.querySelector('.lock-button')) return;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'lock-button';
  button.textContent = 'Sperren';
  button.title = 'Zugang für diesen Browser wieder sperren';
  button.addEventListener('click', () => {
    forgetKey();
    window.location.reload();
  });
  target.append(button);
}

/** Baut Header, Navigation und Footer auf und aktiviert die Partei-Farbvariablen. */
export function initLayout() {
  const activePage = document.body.dataset.page || '';
  document.body.prepend(buildNav(activePage));
  document.body.prepend(buildHeader());
  document.body.append(buildFooter());

  ensureAccess()
    .then((isProtected) => {
      if (isProtected) addLockButton();
    })
    .catch(() => {
      /* Fehler werden von den Tools beim Datenladen sichtbar gemacht. */
    })
    .finally(() => {
      loadPartyMeta()
        .then((meta) => applyPartyCssVars(meta))
        .catch(() => {
          /* Farben bleiben auf den CSS-Fallbackwerten. */
        });

      fillDataStatus();
    });
}

initLayout();
