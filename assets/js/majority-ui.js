/**
 * Mehrheitsrechner — Oberfläche.
 *
 * Wird sowohl für die vollständige Toolseite (`tools/mehrheitsrechner.html`)
 * als auch als kompaktes Widget auf der Landing Page verwendet.
 * Die Rechenlogik steckt vollständig in `majority.js`.
 */

import { loadDatabase, votingGroupsFor, dataErrorMessage } from './data.js';
import { escapeHtml } from './layout.js';
import { siteUrl } from './paths.js';
import { councilNote } from './parties.js';
import {
  DEFAULT_VOTE,
  MAJORITY_TYPES,
  VOTE_ABSTAIN,
  VOTE_NO,
  VOTE_OPTIONS,
  VOTE_YES,
  allianceResults,
  computeResult,
  majorityDescription,
  outcomeLabel,
} from './majority.js';

const VOTE_CODES = { [VOTE_YES]: 'j', [VOTE_NO]: 'n', [VOTE_ABSTAIN]: 'e' };
const CODE_VOTES = Object.fromEntries(Object.entries(VOTE_CODES).map(([vote, code]) => [code, vote]));

const OUTCOME_CLASS = {
  accepted: 'outcome-accepted',
  rejected: 'outcome-rejected',
  tie: 'outcome-tie',
  undecided: 'outcome-undecided',
};

/**
 * Erzeugt einen Mehrheitsrechner im angegebenen Container.
 * @param {HTMLElement} container
 * @param {{compact?: boolean, permalink?: boolean, mode?: 'party'|'fraction'}} [options]
 */
export async function createMajorityCalculator(container, options = {}) {
  const compact = Boolean(options.compact);
  const usePermalink = options.permalink !== false && !compact;

  let db;
  try {
    db = await loadDatabase();
  } catch (err) {
    container.innerHTML = `<p class="notice error">${escapeHtml(dataErrorMessage(err))}</p>`;
    return;
  }

  const state = {
    mode: options.mode === 'party' ? 'party' : 'fraction',
    majorityType: 'simple',
    votes: {},
    absences: {},
  };

  if (usePermalink) readStateFromUrl(state);

  container.innerHTML = compact ? compactSkeleton() : fullSkeleton();
  const refs = {
    controls: container.querySelector('[data-controls]'),
    groups: container.querySelector('[data-groups]'),
    result: container.querySelector('[data-result]'),
    alliances: container.querySelector('[data-alliances]'),
    note: container.querySelector('[data-council-note]'),
  };

  function currentGroups() {
    return votingGroupsFor(db, state.mode);
  }

  /** Fraktionen — Grundlage der Allianzen, unabhängig vom gewählten Modus. */
  function fractionGroups() {
    return votingGroupsFor(db, 'fraction');
  }

  /** Absenzen auf Fraktionen umrechnen (im Parteimodus werden sie aufsummiert). */
  function fractionAbsences(groups) {
    if (state.mode === 'fraction') return state.absences;
    const mapped = {};
    for (const group of groups) {
      mapped[group.id] = (group.partyIds || []).reduce(
        (total, partyId) => total + (Number(state.absences[partyId]) || 0),
        0,
      );
    }
    return mapped;
  }

  function ensureVotes() {
    const ids = new Set(currentGroups().map((group) => group.id));
    for (const id of Object.keys(state.votes)) if (!ids.has(id)) delete state.votes[id];
    for (const id of Object.keys(state.absences)) if (!ids.has(id)) delete state.absences[id];
    for (const group of currentGroups()) {
      if (!state.votes[group.id]) state.votes[group.id] = DEFAULT_VOTE;
    }
  }

  function renderNote() {
    if (!refs.note) return;
    const parts = [councilNote(db.meta, { names: false })];
    const nonVoting = (db.council?.nonVoting || []).length;
    if (nonVoting) {
      const total = db.members.length;
      parts.push(
        `Stimmberechtigt sind ${total - nonVoting} von ${total} Sitzen — das Ratspräsidium stimmt nicht mit ` +
          'und entscheidet bei Stimmengleichheit.',
      );
    }
    refs.note.innerHTML = `<p class="hint">${escapeHtml(parts.filter(Boolean).join(' · '))}</p>`;
  }

  function renderControls() {
    if (compact || !refs.controls) return;
    const totalSeats = currentGroups().reduce((total, group) => total + group.seats, 0);
    refs.controls.innerHTML = `
      <div class="toolbar">
        <span class="segmented" role="group" aria-label="Gruppierung">
          <button type="button" data-mode="fraction" aria-pressed="${state.mode === 'fraction'}">Nach Fraktion</button>
          <button type="button" data-mode="party" aria-pressed="${state.mode === 'party'}">Nach Partei</button>
        </span>

        <label>Mehrheitsart
          <select data-majority-type>
            ${MAJORITY_TYPES.map(
              (type) =>
                `<option value="${type.id}"${type.id === state.majorityType ? ' selected' : ''}>${escapeHtml(
                  type.label,
                )}</option>`,
            ).join('')}
          </select>
        </label>

        <button type="button" data-reset>Zurücksetzen</button>
      </div>
      <p class="hint">${escapeHtml(majorityDescription(state.majorityType, totalSeats))}</p>
    `;

    refs.controls.querySelectorAll('[data-mode]').forEach((button) => {
      button.addEventListener('click', () => {
        if (state.mode === button.dataset.mode) return;
        state.mode = button.dataset.mode;
        state.votes = {};
        state.absences = {};
        renderAll();
      });
    });

    refs.controls.querySelector('[data-majority-type]').addEventListener('change', (event) => {
      state.majorityType = event.target.value;
      renderAll();
    });

    refs.controls.querySelector('[data-reset]').addEventListener('click', () => {
      state.votes = {};
      state.absences = {};
      state.majorityType = 'simple';
      renderAll();
    });
  }

  function renderGroups() {
    const groups = currentGroups();

    refs.groups.innerHTML = groups
      .map((group) => {
        const shortName = escapeHtml(group.shortName || group.name);
        const fullName = escapeHtml(group.name);
        const nameHtml = compact
          ? `<span>${shortName}</span>`
          : `<span title="${fullName}"><strong>${shortName}</strong></span>`;
        const seatTitle =
          group.councilSeats > group.seats
            ? ` title="${group.seats} stimmberechtigte von ${group.councilSeats} Sitzen"`
            : '';
        const radios = VOTE_OPTIONS.map(
          (option) => `
          <label class="vote-option vote-${option.id}">
            <input type="radio" name="vote-${escapeHtml(group.id)}" value="${option.id}"
                   ${state.votes[group.id] === option.id ? 'checked' : ''} />
            <span>${escapeHtml(option.label)}</span>
          </label>`,
        ).join('');

        const absence = compact
          ? ''
          : `<label class="absence">Absenzen
               <input type="number" min="0" max="${group.seats}" step="1"
                      value="${state.absences[group.id] || 0}" data-absence="${escapeHtml(group.id)}" />
             </label>`;

        return `
        <fieldset class="group-row" data-group="${escapeHtml(group.id)}">
          <legend class="visually-hidden">${fullName}</legend>
          <div class="group-name">
            <span class="group-dot" style="background:${escapeHtml(group.color)}"></span>
            ${nameHtml}
            <span class="badge neutral"${seatTitle}>${group.seats}</span>
          </div>
          <div class="vote-options">${radios}</div>
          ${absence}
        </fieldset>`;
      })
      .join('');

    refs.groups.querySelectorAll('input[type="radio"]').forEach((input) => {
      input.addEventListener('change', (event) => {
        const groupId = event.target.closest('[data-group]').dataset.group;
        state.votes[groupId] = event.target.value;
        renderResult();
        syncUrl();
      });
    });

    refs.groups.querySelectorAll('[data-absence]').forEach((input) => {
      input.addEventListener('input', (event) => {
        const groupId = event.target.dataset.absence;
        const group = currentGroups().find((entry) => entry.id === groupId);
        const value = Math.min(Math.max(Math.trunc(Number(event.target.value) || 0), 0), group.seats);
        if (String(value) !== event.target.value) event.target.value = String(value);
        state.absences[groupId] = value;
        renderResult();
        syncUrl();
      });
    });
  }

  function renderResult() {
    const groups = currentGroups();
    const result = computeResult({
      groups,
      votes: state.votes,
      absences: state.absences,
      majorityType: state.majorityType,
    });

    const segments = [
      { key: 'yes', label: 'Ja', value: result.yes, className: 'seg-yes' },
      { key: 'no', label: 'Nein', value: result.no, className: 'seg-no' },
      { key: 'abstain', label: 'Enthaltung', value: result.abstain, className: 'seg-abstain' },
      { key: 'absent', label: 'abwesend', value: result.absent, className: 'seg-absent' },
    ].filter((segment) => segment.value > 0);

    const bar = segments
      .map(
        (segment) =>
          `<span class="${segment.className}" style="width:${(segment.value / result.totalSeats) * 100}%"
                 title="${escapeHtml(segment.label)}: ${segment.value}">${
                   segment.value >= 3 ? segment.value : ''
                 }</span>`,
      )
      .join('');

    const legend = segments
      .map(
        (segment) =>
          `<span class="vote-legend-item"><span class="dot ${segment.className}"></span>${escapeHtml(
            segment.label,
          )}: <strong>${segment.value}</strong></span>`,
      )
      .join('');

    refs.result.innerHTML = `
      <div class="result-badge ${OUTCOME_CLASS[result.outcome]}">
        ${escapeHtml(outcomeLabel(result.outcome))}
      </div>
      <div class="vote-bar" role="img"
           aria-label="Ja ${result.yes}, Nein ${result.no}, Enthaltung ${result.abstain}, abwesend ${result.absent}">
        ${bar}
      </div>
      <div class="vote-legend">${legend}</div>
      <p class="result-summary">
        <strong>${result.yes}</strong> Ja zu <strong>${result.no}</strong> Nein ·
        erforderliches Mehr: <strong>${result.required}</strong>
        (${escapeHtml(MAJORITY_TYPES.find((t) => t.id === result.majorityType)?.label || '')},
        Basis ${result.base} Stimmen) ·
        anwesend ${result.present} von ${result.totalSeats} stimmberechtigten Sitzen
      </p>`;

    if (refs.alliances) renderAlliances();
  }

  function renderAlliances() {
    const groups = fractionGroups();
    const results = allianceResults({
      groups,
      absences: fractionAbsences(groups),
      majorityType: state.majorityType,
    });

    if (!results.length) {
      refs.alliances.innerHTML = '<p class="empty">Keine Allianzen verfügbar.</p>';
      return;
    }

    const required = results[0].required;
    const rows = results
      .map(
        (entry) => `
      <li class="alliance ${entry.winning ? 'is-winning' : 'is-losing'}"
          style="--alliance-color:${escapeHtml(entry.alliance.color)}">
        <span class="alliance-name">
          <span class="group-dot" style="background:${escapeHtml(entry.alliance.color)}"></span>
          <strong>${escapeHtml(entry.alliance.name)}</strong>
          <span class="alliance-parts">${entry.groups
            .map((group) => escapeHtml(group.shortName || group.name))
            .join(' &amp; ')}</span>
        </span>
        <span class="alliance-votes">
          <strong>${entry.votes}</strong> Stimmen
          <span class="badge ${entry.winning ? 'ok' : 'neutral'}">${
            entry.winning ? `Mehrheit (+${entry.margin})` : `fehlen ${-entry.margin}`
          }</span>
        </span>
      </li>`,
      )
      .join('');

    refs.alliances.innerHTML = `
      <p class="subtitle">
        Übliche fraktionsweise Bündnisse und ihre Stimmenzahl. Erforderliches Mehr:
        <strong>${required}</strong> Stimmen. Absenzen sind berücksichtigt; das Ratspräsidium
        stimmt nicht mit.
      </p>
      <ul class="alliance-list">${rows}</ul>`;
  }

  function syncUrl() {
    if (!usePermalink) return;
    const params = new URLSearchParams();
    params.set('modus', state.mode === 'fraction' ? 'fraktion' : 'partei');
    if (state.majorityType !== 'simple') params.set('mehr', state.majorityType);

    const votes = Object.entries(state.votes)
      .filter(([, vote]) => vote && vote !== DEFAULT_VOTE)
      .map(([id, vote]) => `${id}:${VOTE_CODES[vote]}`);
    if (votes.length) params.set('stimmen', votes.join(','));

    const absences = Object.entries(state.absences)
      .filter(([, value]) => Number(value) > 0)
      .map(([id, value]) => `${id}:${value}`);
    if (absences.length) params.set('absenzen', absences.join(','));

    const query = params.toString();
    window.history.replaceState(null, '', query ? `?${query}` : window.location.pathname);
  }

  function renderAll() {
    ensureVotes();
    renderNote();
    renderControls();
    renderGroups();
    renderResult();
    syncUrl();
  }

  renderAll();
}

function readStateFromUrl(state) {
  const params = new URLSearchParams(window.location.search);

  const mode = params.get('modus');
  if (mode === 'partei') state.mode = 'party';
  else if (mode === 'fraktion') state.mode = 'fraction';

  const majorityType = params.get('mehr');
  if (MAJORITY_TYPES.some((type) => type.id === majorityType)) state.majorityType = majorityType;

  for (const entry of (params.get('stimmen') || '').split(',')) {
    const [id, code] = entry.split(':');
    if (id && CODE_VOTES[code]) state.votes[id] = CODE_VOTES[code];
  }

  for (const entry of (params.get('absenzen') || '').split(',')) {
    const [id, value] = entry.split(':');
    const parsed = Number(value);
    if (id && Number.isFinite(parsed) && parsed > 0) state.absences[id] = Math.trunc(parsed);
  }
}

function fullSkeleton() {
  return `
    <div data-council-note></div>
    <div data-controls></div>
    <div class="majority-layout">
      <div class="majority-groups" data-groups></div>
      <div class="majority-result card" data-result></div>
    </div>
    <div class="card alliance-card">
      <h2>Mögliche Allianzen</h2>
      <div data-alliances></div>
    </div>`;
}

function compactSkeleton() {
  return `
    <div class="majority-groups compact" data-groups></div>
    <div class="majority-result compact" data-result></div>
    <p class="widget-link">
      <a href="${siteUrl('tools/mehrheitsrechner.html')}">Zum Mehrheitsrechner</a>
    </p>`;
}
