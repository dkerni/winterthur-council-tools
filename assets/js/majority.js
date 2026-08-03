/**
 * Mehrheitsrechner — reine Rechenlogik (ohne DOM).
 *
 * Eingabe ist das Stimmverhalten je Gruppe (Partei oder Fraktion) plus die
 * Anzahl Absenzen je Gruppe. Ausgabe sind die Stimmenzahlen, das erforderliche
 * Mehr und das Ergebnis. Zusätzlich lassen sich alle **minimalen
 * Gewinn-Koalitionen** berechnen.
 */

/** Mögliche Stimmabgaben einer Gruppe. */
export const VOTE_YES = 'yes';
export const VOTE_NO = 'no';
export const VOTE_ABSTAIN = 'abstain';
export const VOTE_FREE = 'free';

export const VOTE_OPTIONS = [
  { id: VOTE_YES, label: 'Ja' },
  { id: VOTE_NO, label: 'Nein' },
  { id: VOTE_ABSTAIN, label: 'Enthaltung' },
  { id: VOTE_FREE, label: 'frei' },
];

/** Mehrheitsarten. */
export const MAJORITY_TYPES = [
  {
    id: 'simple',
    label: 'Einfaches Mehr',
    description: 'Mehr als die Hälfte der abgegebenen Stimmen.',
  },
  {
    id: 'absolute',
    label: 'Absolutes Mehr',
    description: 'Mehr als die Hälfte aller 60 Ratssitze (31 Stimmen), unabhängig von Absenzen.',
  },
  {
    id: 'two-thirds',
    label: 'Zweidrittelmehr',
    description: 'Mindestens zwei Drittel der abgegebenen Stimmen.',
  },
];

/**
 * @typedef {{id: string, name: string, shortName?: string, color?: string, seats: number}} Group
 */

function clampAbsences(seats, absences) {
  const value = Number(absences) || 0;
  return Math.min(Math.max(Math.trunc(value), 0), seats);
}

/**
 * Erforderliches Mehr für eine Abstimmungsbasis.
 * @param {string} majorityType `simple` | `absolute` | `two-thirds`
 * @param {number} base Anzahl zählender Stimmen
 * @param {number} totalSeats Anzahl Sitze insgesamt (für das absolute Mehr)
 * @returns {number}
 */
export function requiredMajority(majorityType, base, totalSeats) {
  if (majorityType === 'absolute') return Math.floor(totalSeats / 2) + 1;
  if (majorityType === 'two-thirds') return Math.ceil((2 * base) / 3);
  return Math.floor(base / 2) + 1;
}

/**
 * Berechnet das Abstimmungsergebnis.
 *
 * @param {object} input
 * @param {Group[]} input.groups Gruppen mit Sitzzahl
 * @param {Record<string, string>} input.votes Gruppen-ID → Stimmverhalten
 * @param {Record<string, number>} [input.absences] Gruppen-ID → Absenzen
 * @param {string} [input.majorityType] Mehrheitsart (Default `simple`)
 * @param {boolean} [input.abstentionsCount] Enthaltungen zählen zur Basis (Default `false`)
 * @returns {object} Ergebnis inkl. Gruppendetails
 */
export function computeResult({
  groups,
  votes,
  absences = {},
  majorityType = 'simple',
  abstentionsCount = false,
}) {
  const details = groups.map((group) => {
    const absent = clampAbsences(group.seats, absences[group.id]);
    const present = group.seats - absent;
    const vote = votes[group.id] || VOTE_FREE;
    return { group, vote, absent, present };
  });

  const sum = (predicate) =>
    details.reduce((total, entry) => total + (predicate(entry) ? entry.present : 0), 0);

  const totalSeats = groups.reduce((total, group) => total + group.seats, 0);
  const absent = details.reduce((total, entry) => total + entry.absent, 0);
  const present = totalSeats - absent;

  const yes = sum((entry) => entry.vote === VOTE_YES);
  const no = sum((entry) => entry.vote === VOTE_NO);
  const abstain = sum((entry) => entry.vote === VOTE_ABSTAIN);
  const free = sum((entry) => entry.vote === VOTE_FREE);

  const base = abstentionsCount ? yes + no + abstain : yes + no;
  const required = requiredMajority(majorityType, base, totalSeats);

  let outcome;
  if (base === 0) outcome = 'undecided';
  else if (yes >= required && yes > no) outcome = 'accepted';
  else if (majorityType === 'simple' && yes === no && yes > 0) outcome = 'tie';
  else outcome = 'rejected';

  return {
    groups: details,
    totalSeats,
    present,
    absent,
    yes,
    no,
    abstain,
    free,
    base,
    required,
    margin: yes - required,
    majorityType,
    abstentionsCount,
    outcome,
  };
}

/** Lesbare Beschriftung eines Ergebnisses. */
export function outcomeLabel(outcome) {
  switch (outcome) {
    case 'accepted':
      return 'angenommen';
    case 'rejected':
      return 'abgelehnt';
    case 'tie':
      return 'Patt (Stichentscheid Ratspräsidium)';
    default:
      return 'noch keine Stimmen verteilt';
  }
}

/**
 * Alle **minimalen** Gewinn-Koalitionen.
 *
 * Eine Koalition gewinnt, wenn ihre anwesenden Mitglieder das erforderliche
 * Mehr erreichen (angenommen, alle übrigen Anwesenden stimmen dagegen).
 * Minimal heisst: Ohne eine beliebige Gruppe wäre die Koalition nicht mehr
 * gewinnend. Bei neun Parteien sind das 2^9 = 512 Kombinationen — vernachlässigbar.
 *
 * @param {object} input
 * @param {Group[]} input.groups
 * @param {Record<string, number>} [input.absences]
 * @param {string} [input.majorityType]
 * @param {number} [input.maxResults] Begrenzung der Rückgabe (Default 100)
 * @returns {Array<{groupIds: string[], votes: number, groups: Group[]}>}
 */
export function minimalWinningCoalitions({
  groups,
  absences = {},
  majorityType = 'simple',
  maxResults = 100,
}) {
  const usable = groups
    .map((group) => ({ group, present: group.seats - clampAbsences(group.seats, absences[group.id]) }))
    .filter((entry) => entry.present > 0);

  const totalSeats = groups.reduce((total, group) => total + group.seats, 0);
  const presentTotal = usable.reduce((total, entry) => total + entry.present, 0);
  const required = requiredMajority(majorityType, presentTotal, totalSeats);

  if (usable.length > 20) return []; // Schutz vor Kombinatorik-Explosion
  if (required > presentTotal) return [];

  const winning = [];
  const combinations = 1 << usable.length;

  for (let mask = 1; mask < combinations; mask++) {
    let votes = 0;
    for (let i = 0; i < usable.length; i++) {
      if (mask & (1 << i)) votes += usable[i].present;
    }
    if (votes < required) continue;

    // Minimalität: Entfernen einer Gruppe darf nicht mehr gewinnen.
    let minimal = true;
    for (let i = 0; i < usable.length && minimal; i++) {
      if (!(mask & (1 << i))) continue;
      if (votes - usable[i].present >= required) minimal = false;
    }
    if (!minimal) continue;

    winning.push({
      groupIds: usable.filter((_, i) => mask & (1 << i)).map((entry) => entry.group.id),
      groups: usable.filter((_, i) => mask & (1 << i)).map((entry) => entry.group),
      votes,
    });
  }

  winning.sort((a, b) => a.groups.length - b.groups.length || b.votes - a.votes);
  return winning.slice(0, maxResults);
}
