/**
 * Mitgliederliste — sortierbare Tabelle mit Suche und Filtern. Ein Klick auf
 * ein Mitglied öffnet dessen Profilseite auf parlament.winterthur.ch.
 */

import { loadDatabase, dataErrorMessage, ageOf, tenureMonths, formatTenure } from './data.js';
import { councilNote } from './parties.js';
import { escapeHtml } from './layout.js';

const COLUMNS = [
  { id: 'firstName', label: 'Vorname', sort: (m) => (m.firstName || '').toLowerCase() },
  { id: 'lastName', label: 'Nachname', sort: (m) => (m.lastName || '').toLowerCase() },
  { id: 'party', label: 'Partei', sort: (m, db) => db.partyById.get(m.partyId)?.order ?? 99 },
  { id: 'age', label: 'Alter', numeric: true, sort: (m) => ageOf(m) ?? -1 },
  { id: 'district', label: 'Stadtkreis', sort: (m) => (m.district || '').toLowerCase() },
  { id: 'profession', label: 'Beruf', sort: (m) => (m.profession || '').toLowerCase() },
  { id: 'tenure', label: 'Amtsdauer', sort: (m) => tenureMonths(m) ?? -1 },
  { id: 'inquiries', label: 'Vorstösse', numeric: true, sort: (m) => m.inquiryCount ?? 0 },
];

/**
 * Baut die Mitgliederliste in den Container.
 * @param {HTMLElement} container
 */
export async function createMembersList(container) {
  let db;
  try {
    db = await loadDatabase();
  } catch (err) {
    container.innerHTML = `<div class="notice error">${escapeHtml(dataErrorMessage(err))}</div>`;
    return;
  }

  const state = { query: '', party: '', district: '', sort: 'firstName', dir: 1 };

  container.innerHTML = skeleton(db);

  const searchInput = container.querySelector('#member-search');
  const partySelect = container.querySelector('#filter-party');
  const districtSelect = container.querySelector('#filter-district');
  const tableHost = container.querySelector('#member-table');
  searchInput.addEventListener('input', () => {
    state.query = searchInput.value.trim().toLowerCase();
    render();
  });
  partySelect.addEventListener('change', () => {
    state.party = partySelect.value;
    render();
  });
  districtSelect.addEventListener('change', () => {
    state.district = districtSelect.value;
    render();
  });
  container.querySelector('#member-reset').addEventListener('click', () => {
    Object.assign(state, { query: '', party: '', district: '' });
    searchInput.value = '';
    [partySelect, districtSelect].forEach((select) => {
      select.value = '';
    });
    render();
  });
  function filtered() {
    return db.members.filter((member) => {
      if (state.party && member.partyId !== state.party) return false;
      if (state.district && member.district !== state.district) return false;
      if (!state.query) return true;
      const haystack = [
        member.firstName,
        member.lastName,
        member.profession,
        member.district,
        db.partyById.get(member.partyId)?.abbr,
        db.partyById.get(member.partyId)?.name,
        db.fractionById.get(member.fractionId)?.shortName,
        ...member.commissions.map((entry) => entry.name),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(state.query);
    });
  }

  function sorted(members) {
    const column = COLUMNS.find((entry) => entry.id === state.sort) || COLUMNS[0];
    return [...members].sort((a, b) => {
      const left = column.sort(a, db);
      const right = column.sort(b, db);
      if (left === right) return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`, 'de');
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * state.dir;
      return String(left).localeCompare(String(right), 'de') * state.dir;
    });
  }

  function render() {
    const members = sorted(filtered());
    renderTable(tableHost, db, members, state);

    tableHost.querySelectorAll('th[data-sort]').forEach((header) => {
      header.addEventListener('click', () => {
        const id = header.dataset.sort;
        if (state.sort === id) state.dir *= -1;
        else {
          state.sort = id;
          state.dir = 1;
        }
        render();
      });
    });

    // Der Profil-Link in der Namensspalte bedient Tastatur und Kontextmenü;
    // ein Klick irgendwo in der Zeile öffnet dasselbe Profil.
    tableHost.querySelectorAll('tr[data-profile]').forEach((row) => {
      row.addEventListener('click', (event) => {
        if (event.target.closest('a')) return;
        window.open(row.dataset.profile, '_blank', 'noopener');
      });
    });
  }

  render();
}

function skeleton(db) {
  const districts = [...new Set(db.members.map((member) => member.district).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'de'),
  );

  const option = (value, label) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;

  return `
    <p class="hint" id="member-council">${escapeHtml(councilNote(db.meta))}</p>
    <div class="filter-bar">
      <label>Suche
        <input type="search" id="member-search" placeholder="Name, Beruf, Kommission …" />
      </label>
      <label>Partei
        <select id="filter-party">${[option('', 'alle')]
          .concat(db.parties.map((party) => option(party.id, `${party.abbr} (${party.seats})`)))
          .join('')}</select>
      </label>
      <label>Stadtkreis
        <select id="filter-district"${districts.length ? '' : ' disabled title="Noch keine Stadtkreise erfasst"'}>${[
          option('', 'alle'),
        ]
          .concat(districts.map((d) => option(d, d)))
          .join('')}</select>
      </label>
      <button type="button" class="btn" id="member-reset">Filter zurücksetzen</button>
    </div>
    <div class="card" id="member-table"></div>`;
}

function renderTable(host, db, members, state) {
  if (!members.length) {
    host.innerHTML = '<p class="empty">Keine Mitglieder gefunden. Filter anpassen oder zurücksetzen.</p>';
    return;
  }

  const headers = COLUMNS.map((column) => {
    const active = state.sort === column.id;
    const arrow = active ? (state.dir === 1 ? ' ▲' : ' ▼') : '';
    return `<th data-sort="${column.id}" class="${column.numeric ? 'num' : ''}"
      aria-sort="${active ? (state.dir === 1 ? 'ascending' : 'descending') : 'none'}"
      title="Nach ${escapeHtml(column.label)} sortieren">${escapeHtml(column.label)}${arrow}</th>`;
  }).join('');

  const rows = members
    .map((member) => {
      const party = db.partyById.get(member.partyId);
      const age = ageOf(member);
      const tenure = formatTenure(tenureMonths(member));
      const url = profileUrl(member);
      const label = `${member.firstName} ${member.lastName}`.trim();
      const nameCell = (value, primary) =>
        url
          ? `<a class="member-link" href="${escapeHtml(url)}" target="_blank" rel="noopener"${
              primary ? '' : ' tabindex="-1"'
            } title="Profil von ${escapeHtml(label)} auf parlament.winterthur.ch öffnen">${escapeHtml(value)}</a>`
          : escapeHtml(value);
      return `<tr data-member="${escapeHtml(member.id)}"${url ? ` data-profile="${escapeHtml(url)}"` : ''}>
        <td>${nameCell(member.firstName, true)}</td>
        <td>${nameCell(member.lastName, false)}</td>
        <td><span class="group-dot" style="background:${escapeHtml(party?.color || '#999')}"></span> ${escapeHtml(
          party?.abbr || '–',
        )}</td>
        <td class="num">${age ?? '–'}</td>
        <td>${escapeHtml(member.district || '–')}</td>
        <td>${escapeHtml(member.profession || '–')}</td>
        <td class="tenure">${tenure ? escapeHtml(tenure) : '–'}</td>
        <td class="num">${member.inquiryCount ?? 0}</td>
      </tr>`;
    })
    .join('');

  host.innerHTML = `<div class="table-wrap">
      <table class="members-table">
        <thead><tr>${headers}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/**
 * Profil-Link eines Mitglieds — nur `http(s)`-Adressen werden übernommen.
 * @returns {string|null}
 */
function profileUrl(member) {
  if (!member.profileUrl) return null;
  try {
    const url = new URL(member.profileUrl, window.location.href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}
