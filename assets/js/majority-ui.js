/**
 * Mehrheitsrechner — Oberfläche.
 *
 * Wird sowohl für die vollständige Toolseite (`tools/mehrheitsrechner.html`)
 * als auch als kompaktes Widget auf der Landing Page verwendet.
 * Die Rechenlogik steckt vollständig in `majority.js`.
 */

import { loadDatabase, groupsFor, dataErrorMessage } from './data.js';
import { escapeHtml } from './layout.js';
import { siteUrl } from './paths.js';
import {
  MAJORITY_TYPES,
  VOTE_ABSTAIN,
  VOTE_FREE,
  VOTE_NO,
  VOTE_OPTIONS,
  VOTE_YES,
  computeResult,
  minimalWinningCoalitions,
  outcomeLabel,
} from './majority.js';

const VOTE_CODES = { [VOTE_YES]: 'j', [VOTE_NO]: 'n', [VOTE_ABSTAIN]: 'e', [VOTE_FREE]: 'f' };
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
    mode: options.mode === 'fraction' ? 'fraction' : 'party',
    majorityType: 'simple',
    abstentionsCount: false,
    votes: {},
    absences: {},
  };

  if (usePermalink) readStateFromUrl(state);

  container.innerHTML = compact ? compactSkeleton() : fullSkeleton();
  const refs = {
    controls: container.querySelector('[data-controls]'),
    groups: container.querySelector('[data-groups]'),
    result: container.querySelector('[data-result]'),
    coalitions: container.querySelector('[data-coalitions]'),
    status: container.querySelector('[data-status]'),
  };

  function currentGroups() {
    return groupsFor(db, state.mode);
  }

  function ensureVotes() {
    const ids = new Set(currentGroups().map((group) => group.id));
    for (const id of Object.keys(state.votes)) if (!ids.has(id)) delete state.votes[id];
    for (const id of Object.keys(state.absences)) if (!ids.has(id)) delete state.absences[id];
    for (const group of currentGroups()) {
      if (!state.votes[group.id]) state.votes[group.id] = VOTE_FREE;
    }
  }

  function renderControls() {
    if (compact || !refs.controls) return;
    refs.controls.innerHTML = `
      <div class="toolbar">
        <span class="segmented" role="group" aria-label="Gruppierung">
          <button type="button" data-mode="party" aria-pressed="${state.mode === 'party'}">Nach Partei</button>
          <button type="button" data-mode="fraction" aria-pressed="${state.mode === 'fraction'}">Nach Fraktion</button>
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

        <label>
          <input type="checkbox" data-abstentions ${state.abstentionsCount ? 'checked' : ''} />
          Enthaltungen zählen zur Basis
        </label>

        <button type="button" data-reset>Zurücksetzen</button>
        <button type="button" data-share>Link zum Szenario kopieren</button>
        <span class="status-msg" data-status></span>
      </div>
      <p class="hint">${escapeHtml(MAJORITY_TYPES.find((t) => t.id === state.majorityType)?.description || '')}</p>
    `;
    refs.status = refs.controls.querySelector('[data-status]');

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

    refs.controls.querySelector('[data-abstentions]').addEventListener('change', (event) => {
      state.abstentionsCount = event.target.checked;
      renderAll();
    });

    refs.controls.querySelector('[data-reset]').addEventListener('click', () => {
      state.votes = {};
      state.absences = {};
      state.majorityType = 'simple';
      state.abstentionsCount = false;
      renderAll();
    });

    refs.controls.querySelector('[data-share]').addEventListener('click', async () => {
      const url = window.location.href;
      try {
        await navigator.clipboard.writeText(url);
        setStatus('Link kopiert.');
      } catch {
        setStatus('Kopieren nicht möglich — Link aus der Adresszeile übernehmen.');
      }
    });
  }

  function setStatus(message) {
    if (!refs.status) return;
    refs.status.textContent = message;
    setTimeout(() => {
      if (refs.status && refs.status.textContent === message) refs.status.textContent = '';
    }, 4000);
  }

  function renderGroups() {
    const groups = currentGroups();
    const voteOptions = compact
      ? VOTE_OPTIONS.filter((option) => option.id !== VOTE_ABSTAIN)
      : VOTE_OPTIONS;

    refs.groups.innerHTML = groups
      .map((group) => {
        const shortName = escapeHtml(group.shortName || group.name);
        const fullName = escapeHtml(group.name);
        const nameHtml = compact
          ? `<span>${shortName}</span>`
          : `<span title="${fullName}"><strong>${shortName}</strong></span>`;
        const radios = voteOptions
          .map(
            (option) => `
          <label class="vote-option vote-${option.id}">
            <input type="radio" name="vote-${escapeHtml(group.id)}" value="${option.id}"
                   ${state.votes[group.id] === option.id ? 'checked' : ''} />
            <span>${escapeHtml(option.label)}</span>
          </label>`,
          )
          .join('');

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
            <span class="badge neutral">${group.seats}</span>
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
      abstentionsCount: state.abstentionsCount,
    });

    const segments = [
      { key: 'yes', label: 'Ja', value: result.yes, className: 'seg-yes' },
      { key: 'no', label: 'Nein', value: result.no, className: 'seg-no' },
      { key: 'abstain', label: 'Enthaltung', value: result.abstain, className: 'seg-abstain' },
      { key: 'free', label: 'frei', value: result.free, className: 'seg-free' },
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
           aria-label="Ja ${result.yes}, Nein ${result.no}, Enthaltung ${result.abstain}, frei ${result.free}, abwesend ${result.absent}">
        ${bar}
      </div>
      <div class="vote-legend">${legend}</div>
      <p class="result-summary">
        <strong>${result.yes}</strong> Ja zu <strong>${result.no}</strong> Nein ·
        erforderliches Mehr: <strong>${result.required}</strong>
        (${escapeHtml(MAJORITY_TYPES.find((t) => t.id === result.majorityType)?.label || '')},
        Basis ${result.base} Stimmen) ·
        anwesend ${result.present} von ${result.totalSeats}
      </p>`;

    if (refs.coalitions) renderCoalitions(groups);
  }

  function renderCoalitions(groups) {
    const coalitions = minimalWinningCoalitions({
      groups,
      absences: state.absences,
      majorityType: state.majorityType,
      maxResults: 40,
    });

    if (!coalitions.length) {
      refs.coalitions.innerHTML = '<p class="empty">Keine Koalition erreicht das erforderliche Mehr.</p>';
      return;
    }

    const rows = coalitions
      .map(
        (coalition) => `
      <li>
        <span class="coalition-groups">${coalition.groups
          .map(
            (group) =>
              `<span class="chip"><span class="group-dot" style="background:${escapeHtml(
                group.color,
              )}"></span>${escapeHtml(group.shortName || group.name)}</span>`,
          )
          .join('')}</span>
        <span class="coalition-votes">${coalition.votes} Stimmen</span>
      </li>`,
      )
      .join('');

    refs.coalitions.innerHTML = `
      <p class="subtitle">
        Kleinstmögliche Kombinationen, die das erforderliche Mehr erreichen — ohne eine der
        beteiligten Gruppen wäre die Mehrheit weg. Absenzen sind berücksichtigt.
      </p>
      <ol class="coalition-list">${rows}</ol>`;
  }

  function syncUrl() {
    if (!usePermalink) return;
    const params = new URLSearchParams();
    params.set('modus', state.mode === 'fraction' ? 'fraktion' : 'partei');
    if (state.majorityType !== 'simple') params.set('mehr', state.majorityType);
    if (state.abstentionsCount) params.set('enthaltungen', '1');

    const votes = Object.entries(state.votes)
      .filter(([, vote]) => vote && vote !== VOTE_FREE)
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
  if (mode === 'fraktion') state.mode = 'fraction';

  const majorityType = params.get('mehr');
  if (MAJORITY_TYPES.some((type) => type.id === majorityType)) state.majorityType = majorityType;

  state.abstentionsCount = params.get('enthaltungen') === '1';

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
    <div data-controls></div>
    <div class="majority-layout">
      <div class="majority-groups" data-groups></div>
      <div class="majority-result card" data-result></div>
    </div>
    <div class="card coalition-card">
      <h2>Minimale Gewinn-Koalitionen</h2>
      <div data-coalitions></div>
    </div>`;
}

function compactSkeleton() {
  return `
    <div class="majority-groups compact" data-groups></div>
    <div class="majority-result compact" data-result></div>
    <p class="widget-link">
      <a href="${siteUrl('tools/mehrheitsrechner.html')}">Alle Optionen (Fraktionen, Absenzen, Koalitionen) →</a>
    </p>`;
}
