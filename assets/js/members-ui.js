/**
 * Mitgliederliste — sortierbare Tabelle mit Suche, Filtern und Detailbereich.
 */

import { loadDatabase, dataErrorMessage, ageOf, tenureYears, formatDate, formatDateTime } from './data.js';
import { GENDER_LABELS } from './stats.js';
import { toCsv, downloadCsv, datedFilename } from './csv.js';
import { escapeHtml } from './layout.js';

const COLUMNS = [
  { id: 'name', label: 'Name', sort: (m) => `${m.lastName} ${m.firstName}`.toLowerCase() },
  { id: 'party', label: 'Partei', sort: (m, db) => db.partyById.get(m.partyId)?.order ?? 99 },
  { id: 'fraction', label: 'Fraktion', sort: (m, db) => db.fractionById.get(m.fractionId)?.order ?? 99 },
  { id: 'age', label: 'Alter', numeric: true, sort: (m) => ageOf(m) ?? -1 },
  { id: 'district', label: 'Stadtkreis', sort: (m) => (m.district || '').toLowerCase() },
  { id: 'profession', label: 'Beruf', sort: (m) => (m.profession || '').toLowerCase() },
  { id: 'tenure', label: 'Amtsdauer', numeric: true, sort: (m) => tenureYears(m) ?? -1 },
  { id: 'inquiries', label: 'Vorstösse', numeric: true, sort: (m) => m.inquiryCounts?.total ?? 0 },
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

  const state = { query: '', party: '', fraction: '', commission: '', district: '', sort: 'name', dir: 1, selected: null };

  container.innerHTML = skeleton(db);

  const searchInput = container.querySelector('#member-search');
  const partySelect = container.querySelector('#filter-party');
  const fractionSelect = container.querySelector('#filter-fraction');
  const commissionSelect = container.querySelector('#filter-commission');
  const districtSelect = container.querySelector('#filter-district');
  const tableHost = container.querySelector('#member-table');
  const detailHost = container.querySelector('#member-detail');
  const countHost = container.querySelector('#member-count');

  searchInput.addEventListener('input', () => {
    state.query = searchInput.value.trim().toLowerCase();
    render();
  });
  partySelect.addEventListener('change', () => {
    state.party = partySelect.value;
    render();
  });
  fractionSelect.addEventListener('change', () => {
    state.fraction = fractionSelect.value;
    render();
  });
  commissionSelect.addEventListener('change', () => {
    state.commission = commissionSelect.value;
    render();
  });
  districtSelect.addEventListener('change', () => {
    state.district = districtSelect.value;
    render();
  });
  container.querySelector('#member-reset').addEventListener('click', () => {
    Object.assign(state, { query: '', party: '', fraction: '', commission: '', district: '' });
    searchInput.value = '';
    [partySelect, fractionSelect, commissionSelect, districtSelect].forEach((select) => {
      select.value = '';
    });
    render();
  });
  container.querySelector('#member-csv').addEventListener('click', () => {
    downloadCsv(datedFilename('mitglieder'), toCsv(csvRows(db, filtered())));
  });

  function filtered() {
    return db.members.filter((member) => {
      if (state.party && member.partyId !== state.party) return false;
      if (state.fraction && member.fractionId !== state.fraction) return false;
      if (state.district && member.district !== state.district) return false;
      if (state.commission && !member.commissions.some((entry) => entry.id === state.commission)) return false;
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
      if (left === right) return `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'de');
      if (typeof left === 'number' && typeof right === 'number') return (left - right) * state.dir;
      return String(left).localeCompare(String(right), 'de') * state.dir;
    });
  }

  function render() {
    const members = sorted(filtered());
    countHost.textContent =
      members.length === db.members.length
        ? `${db.members.length} Mitglieder`
        : `${members.length} von ${db.members.length} Mitgliedern`;
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

    tableHost.querySelectorAll('tr[data-member]').forEach((row) => {
      row.addEventListener('click', () => select(row.dataset.member));
      row.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          select(row.dataset.member);
        }
      });
    });

    showDetail();
  }

  /** Auswahl wechseln, ohne die Tabelle neu aufzubauen. */
  function select(id) {
    state.selected = id;
    tableHost.querySelectorAll('tr[data-member]').forEach((row) => {
      row.classList.toggle('is-selected', row.dataset.member === id);
    });
    showDetail();
  }

  function showDetail() {
    renderDetail(detailHost, db, state.selected ? db.memberById.get(state.selected) : null);
  }

  render();
}

function skeleton(db) {
  const districts = [...new Set(db.members.map((member) => member.district).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'de'),
  );

  const option = (value, label) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;

  return `
    <div class="filter-bar">
      <label>Suche
        <input type="search" id="member-search" placeholder="Name, Beruf, Kommission …" />
      </label>
      <label>Partei
        <select id="filter-party">${[option('', 'alle')]
          .concat(db.parties.map((party) => option(party.id, `${party.abbr} (${party.seats})`)))
          .join('')}</select>
      </label>
      <label>Fraktion
        <select id="filter-fraction">${[option('', 'alle')]
          .concat(db.fractions.map((fraction) => option(fraction.id, `${fraction.shortName} (${fraction.seats})`)))
          .join('')}</select>
      </label>
      <label>Kommission
        <select id="filter-commission"${db.commissions.length ? '' : ' disabled title="Noch keine Kommissionen erfasst"'}>${[
          option('', 'alle'),
        ]
          .concat(db.commissions.map((commission) => option(commission.id, commission.shortName || commission.name)))
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
      <button type="button" class="btn" id="member-csv">Auswahl als CSV</button>
      <span class="hint" id="member-count"></span>
    </div>
    <div class="members-layout">
      <div class="card" id="member-table"></div>
      <aside class="card member-detail" id="member-detail"></aside>
    </div>`;
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
      const fraction = db.fractionById.get(member.fractionId);
      const age = ageOf(member);
      const tenure = tenureYears(member);
      return `<tr data-member="${escapeHtml(member.id)}" class="${state.selected === member.id ? 'is-selected' : ''}"
        tabindex="0">
        <td>${escapeHtml(member.lastName)}, ${escapeHtml(member.firstName)}</td>
        <td><span class="group-dot" style="background:${escapeHtml(party?.color || '#999')}"></span> ${escapeHtml(
          party?.abbr || '–',
        )}</td>
        <td>${escapeHtml(fraction?.shortName || '–')}</td>
        <td class="num">${age ?? '–'}</td>
        <td>${escapeHtml(member.district || '–')}</td>
        <td>${escapeHtml(member.profession || '–')}</td>
        <td class="num">${tenure ?? '–'}</td>
        <td class="num">${member.inquiryCounts?.total ?? 0}</td>
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

function renderDetail(host, db, member) {
  if (!member) {
    host.innerHTML =
      '<h3>Details</h3><p class="empty">Eine Zeile in der Tabelle auswählen, um alle erfassten Angaben zu sehen.</p>';
    return;
  }

  const party = db.partyById.get(member.partyId);
  const fraction = db.fractionById.get(member.fractionId);
  const age = ageOf(member);
  const tenure = tenureYears(member);

  const rows = [
    ['Partei', party ? `${party.abbr} — ${party.name}` : '–'],
    ['Fraktion', fraction ? fraction.name : '–'],
    ['Geschlecht', GENDER_LABELS[member.gender] || 'unbekannt'],
    ['Geburtsjahr', member.birthYear ? `${member.birthYear} (${age} Jahre)` : 'nicht erfasst'],
    ['Beruf', member.profession || 'nicht erfasst'],
    ['Stadtkreis', member.district || 'nicht erfasst'],
    ['Im Rat seit', member.firstEntryDate ? formatDate(member.firstEntryDate) : 'nicht erfasst'],
    ['Amtsdauer', tenure != null ? `${tenure} Jahre` : 'nicht erfasst'],
  ];

  const commissions = member.commissions.length
    ? `<div class="chip-list">${member.commissions
        .map(
          (entry) =>
            `<span class="chip">${escapeHtml(entry.name)}${entry.role ? ` — ${escapeHtml(entry.role)}` : ''}</span>`,
        )
        .join('')}</div>`
    : '<p class="empty">Keine Kommissionen erfasst.</p>';

  const inquiries = member.inquiries.length
    ? `<ul class="inquiry-list">${member.inquiries
        .slice(0, 25)
        .map(
          (entry) => `<li>
            <a href="${escapeHtml(entry.url || '#')}" target="_blank" rel="noopener">${escapeHtml(entry.title)}</a>
            <div class="inquiry-meta">${escapeHtml(entry.type || '')}${
              entry.date ? ` · ${escapeHtml(formatDate(entry.date))}` : ''
            }${entry.role === 'first' ? ' · erstunterzeichnet' : ''}</div>
          </li>`,
        )
        .join('')}</ul>`
    : '<p class="empty">Keine Vorstösse erfasst.</p>';

  host.innerHTML = `
    <h3>${escapeHtml(member.firstName)} ${escapeHtml(member.lastName)}</h3>
    <p class="subtitle">${escapeHtml(party?.abbr || '')}${fraction ? ` · Fraktion ${escapeHtml(fraction.shortName)}` : ''}</p>
    <dl>${rows.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(value))}</dd>`).join('')}</dl>
    ${
      member.email || member.profileUrl
        ? `<div class="detail-section"><h4>Kontakt</h4><p>${[
            member.email ? `<a href="mailto:${escapeHtml(member.email)}">${escapeHtml(member.email)}</a>` : '',
            member.profileUrl
              ? `<a href="${escapeHtml(member.profileUrl)}" target="_blank" rel="noopener">Profil auf parlament.winterthur.ch</a>`
              : '',
          ]
            .filter(Boolean)
            .join(' · ')}</p></div>`
        : ''
    }
    <div class="detail-section"><h4>Kommissionen</h4>${commissions}</div>
    <div class="detail-section"><h4>Vorstösse${
      member.inquiryCounts?.total ? ` (${member.inquiryCounts.total})` : ''
    }</h4>${inquiries}</div>
    ${
      member.lastSeenAt
        ? `<p class="hint">Zuletzt bestätigt: ${escapeHtml(formatDateTime(member.lastSeenAt))}</p>`
        : ''
    }`;
}

function csvRows(db, members) {
  return members.map((member) => ({
    nachname: member.lastName,
    vorname: member.firstName,
    partei: db.partyById.get(member.partyId)?.abbr || '',
    fraktion: db.fractionById.get(member.fractionId)?.shortName || '',
    geschlecht: GENDER_LABELS[member.gender] || 'unbekannt',
    geburtsjahr: member.birthYear ?? '',
    alter: ageOf(member) ?? '',
    beruf: member.profession || '',
    stadtkreis: member.district || '',
    im_rat_seit: member.firstEntryDate || '',
    amtsdauer_jahre: tenureYears(member) ?? '',
    kommissionen: member.commissions.map((entry) => entry.name).join(' | '),
    vorstoesse: member.inquiryCounts?.total ?? 0,
    profil: member.profileUrl || '',
  }));
}
