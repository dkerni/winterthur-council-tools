/**
 * Gemeinsames Seitengerüst — Header, Navigation, Footer und Disclaimer.
 *
 * Wird von allen Seiten eingebunden. Die aktive Navigation ergibt sich aus
 * `document.body.dataset.page`. Alle Links sind relativ zur Website-Basis,
 * damit die Seite auch unter `/winterthur-council-tools/` funktioniert.
 */

import { siteUrl } from './paths.js';
import { loadPartyMeta, applyPartyCssVars } from './parties.js';
import { loadDatabase, formatDate } from './data.js';

const SOURCE_URL = 'https://parlament.winterthur.ch';
const AUTHOR_URL = 'https://dominik-kern.ch/';

/** Oberhalb dieser Breite ist die Navigation immer sichtbar (siehe main.css). */
const DESKTOP_NAV_QUERY = '(min-width: 701px)';

const NAV_ITEMS = [
  { page: 'start', label: 'Start', href: '' },
  { page: 'mehrheitsrechner', label: 'Mehrheitsrechner', href: 'mehrheitsrechner' },
  { page: 'sitzplan', label: 'Sitzplan', href: 'sitzplan' },
  { page: 'statistik', label: 'Statistiken', href: 'statistiken' },
  { page: 'mitglieder', label: 'Mitglieder', href: 'mitglieder' },
  { page: 'impressum', label: 'Impressum', href: 'impressum' },
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
    <a href="${siteUrl('')}" aria-label="Zur Startseite">
      <img class="logo" src="${siteUrl('media/Logo.jpg')}" alt="Wappen Winterthur" />
    </a>
    <a class="site-title" href="${siteUrl('')}">
      Winti Politik
      <span>Werkzeuge rund um das Stadtparlament Winterthur</span>
    </a>
    <button type="button" class="nav-toggle" id="nav-toggle"
            aria-controls="site-nav" aria-expanded="false" aria-label="Menü öffnen">
      <span class="nav-toggle-bar"></span>
      <span class="nav-toggle-bar"></span>
      <span class="nav-toggle-bar"></span>
    </button>`;
  return header;
}

function buildNav(activePage) {
  const nav = document.createElement('nav');
  nav.className = 'site-nav';
  nav.id = 'site-nav';
  nav.setAttribute('aria-label', 'Hauptnavigation');
  nav.innerHTML = `<ul>${NAV_ITEMS.map((item) => {
    const current = item.page === activePage ? ' aria-current="page"' : '';
    return `<li><a href="${siteUrl(item.href)}"${current}>${escapeHtml(item.label)}</a></li>`;
  }).join('')}</ul>`;
  return nav;
}

/**
 * Burger-Menü verdrahten: Auf schmalen Viewports blendet `.site-nav.is-open`
 * die Navigation ein. Sie schliesst sich nach einem Klick auf einen Link,
 * bei Escape, bei einem Klick ausserhalb und beim Wechsel zur Desktop-Breite.
 */
function bindNavToggle(toggle, nav) {
  if (!toggle || !nav) return;

  function setOpen(open) {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Menü schliessen' : 'Menü öffnen');
  }

  toggle.addEventListener('click', () => {
    setOpen(toggle.getAttribute('aria-expanded') !== 'true');
  });

  nav.addEventListener('click', (event) => {
    if (event.target.closest('a')) setOpen(false);
  });

  document.addEventListener('click', (event) => {
    if (!nav.classList.contains('is-open')) return;
    if (nav.contains(event.target) || toggle.contains(event.target)) return;
    setOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !nav.classList.contains('is-open')) return;
    setOpen(false);
    toggle.focus();
  });

  // Beim Wechsel auf Desktop-Breite den Zustand zurücksetzen, sonst bliebe
  // `is-open` erhalten und würde beim erneuten Verkleinern nachwirken.
  const desktop = window.matchMedia(DESKTOP_NAV_QUERY);
  const onChange = () => {
    if (desktop.matches) setOpen(false);
  };
  if (typeof desktop.addEventListener === 'function') desktop.addEventListener('change', onChange);
  else desktop.addListener(onChange);
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
        Weitere Angaben im <a href="${siteUrl('impressum')}">Impressum</a>.
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

/** Baut Header, Navigation und Footer auf und aktiviert die Partei-Farbvariablen. */
export function initLayout() {
  const activePage = document.body.dataset.page || '';
  const nav = buildNav(activePage);
  const header = buildHeader();
  document.body.prepend(nav);
  document.body.prepend(header);
  document.body.append(buildFooter());

  bindNavToggle(header.querySelector('.nav-toggle'), nav);

  loadPartyMeta()
    .then((meta) => applyPartyCssVars(meta))
    .catch(() => {
      /* Farben bleiben auf den CSS-Fallbackwerten. */
    });

  fillDataStatus();
}

initLayout();
