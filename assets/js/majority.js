/**
 * Mehrheitsrechner — reine Rechenlogik (ohne DOM).
 *
 * Eingabe ist das Stimmverhalten je Gruppe (Partei oder Fraktion) plus die
 * Anzahl Absenzen je Gruppe. Ausgabe sind die Stimmenzahlen, das erforderliche
 * Mehr und das Ergebnis. Zusätzlich lassen sich benannte **Allianzen** sowie
 * alle **minimalen Gewinn-Koalitionen** berechnen.
 *
 * Gerechnet wird durchwegs mit den **stimmberechtigten** Sitzen: Das
 * Ratspräsidium stimmt nicht mit, deshalb sind es 59 statt 60 Stimmen.
 */

/** Mögliche Stimmabgaben einer Gruppe. */
export const VOTE_YES = 'yes';
export const VOTE_NO = 'no';
export const VOTE_ABSTAIN = 'abstain';
/** @deprecated Wird in der Oberfläche nicht mehr angeboten; Standard ist die Enthaltung. */
export const VOTE_FREE = 'free';

export const VOTE_OPTIONS = [
  { id: VOTE_YES, label: 'Ja' },
  { id: VOTE_NO, label: 'Nein' },
  { id: VOTE_ABSTAIN, label: 'Enthaltung' },
];

/** Standardstimme einer Gruppe, solange nichts anderes gewählt ist. */
export const DEFAULT_VOTE = VOTE_ABSTAIN;

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
    description: 'Mehr als die Hälfte aller stimmberechtigten Sitze, unabhängig von Absenzen.',
  },
  {
    id: 'two-thirds',
    label: 'Zweidrittelmehr',
    description: 'Mindestens zwei Drittel der abgegebenen Stimmen.',
  },
];

/**
 * Beschreibung einer Mehrheitsart, beim absoluten Mehr ergänzt um die
 * konkreten Zahlen der aktuellen Sitzverteilung.
 * @param {string} majorityType
 * @param {number} totalSeats stimmberechtigte Sitze
 */
export function majorityDescription(majorityType, totalSeats) {
  const type = MAJORITY_TYPES.find((entry) => entry.id === majorityType);
  if (!type) return '';
  if (type.id === 'absolute' && totalSeats > 0) {
    return `${type.description} Aktuell ${requiredMajority('absolute', 0, totalSeats)} von ${totalSeats} Stimmen.`;
  }
  return type.description;
}

/**
 * Vorgefertigte Abstimmungsszenarien. Angegeben sind jeweils die Parteien;
 * Fraktionen erben das Verhalten ihrer Parteien.
 */
export const SCENARIO_PRESETS = [
  {
    id: 'right',
    label: 'Rechtes Anliegen',
    description: 'Ja: SVP, FDP · Nein: SP, Grüne/AL · Enthaltung: übrige',
    yesParties: ['svp', 'fdp'],
    noParties: ['sp', 'gruene', 'al'],
  },
  {
    id: 'left',
    label: 'Linkes Anliegen',
    description: 'Ja: SP, Grüne/AL · Nein: SVP, FDP · Enthaltung: übrige',
    yesParties: ['sp', 'gruene', 'al'],
    noParties: ['svp', 'fdp'],
  },
];

/**
 * Stimmverhalten eines Szenarios auf die übergebenen Gruppen abbilden.
 * Eine Gruppe stimmt nur dann Ja bzw. Nein, wenn **alle** ihre Parteien im
 * Szenario so stimmen; sonst enthält sie sich.
 *
 * @param {Group[]} groups
 * @param {string|{yesParties: string[], noParties: string[]}} preset Szenario oder dessen ID
 * @returns {Record<string, string>} Gruppen-ID → Stimmverhalten
 */
export function presetVotes(groups, preset) {
  const scenario =
    typeof preset === 'string' ? SCENARIO_PRESETS.find((entry) => entry.id === preset) : preset;
  const votes = {};
  for (const group of groups) {
    const partyIds = group.partyIds && group.partyIds.length ? group.partyIds : [group.id];
    if (scenario && partyIds.every((id) => scenario.yesParties.includes(id))) {
      votes[group.id] = VOTE_YES;
    } else if (scenario && partyIds.every((id) => scenario.noParties.includes(id))) {
      votes[group.id] = VOTE_NO;
    } else {
      votes[group.id] = DEFAULT_VOTE;
    }
  }
  return votes;
}

/**
 * Benannte Allianzen — fraktionsweise Bündnisse, die im Rat realistisch
 * vorkommen. Reihenfolge und Namen sind bewusst redaktionell gesetzt.
 */
export const ALLIANCES = [
  { id: 'buergerliche', name: 'Die Bürgerlichen', fractionIds: ['svp', 'fdp', 'mitte'], color: '#1565c0' },
  {
    id: 'christlich-buergerliche',
    name: 'Die christlichen Bürgerlichen',
    fractionIds: ['svp', 'fdp', 'mitte', 'evp-edu'],
    color: '#b8860b',
  },
  {
    id: 'gruen-buergerliche',
    name: 'Die etwas grünen Bürgerlichen',
    fractionIds: ['svp', 'fdp', 'mitte', 'glp'],
    color: '#6b8f2e',
  },
  {
    id: 'alle-ausser-links',
    name: 'Einfach alle ausser die Linken',
    fractionIds: ['svp', 'fdp', 'mitte', 'glp', 'evp-edu'],
    color: '#8a6d3b',
  },
  { id: 'rot-gruen', name: 'Rot-grün', fractionIds: ['sp', 'gruene-al'], color: '#c0392b' },
  {
    id: 'rot-gruen-liberal',
    name: 'Rot-grün & etwas liberal',
    fractionIds: ['sp', 'gruene-al', 'glp'],
    color: '#a8574a',
  },
  {
    id: 'rot-gruen-christlich',
    name: 'Rot-grün & etwas christlich',
    fractionIds: ['sp', 'gruene-al', 'evp-edu'],
    color: '#cf7a1f',
  },
  {
    id: 'progressive',
    name: 'Die progressive Allianz',
    fractionIds: ['sp', 'gruene-al', 'glp', 'evp-edu'],
    color: '#a3195b',
  },
  {
    id: 'liberales-zentrum',
    name: 'Das liberale Zentrum',
    fractionIds: ['fdp', 'mitte', 'evp-edu', 'glp'],
    color: '#2f80b8',
  },
  {
    id: 'unheilig',
    name: 'Unheilige Allianz',
    fractionIds: ['svp', 'sp', 'gruene-al'],
    color: '#6d4c41',
  },
];

/**
 * Stimmverhalten einer Allianz: Die beteiligten Fraktionen stimmen Ja, alle
 * übrigen Gruppen Nein. Im Parteimodus werden die Fraktionen über ihre
 * Parteien aufgelöst, dafür ist `fractions` nötig.
 *
 * @param {Group[]} groups Gruppen des aktuellen Modus (Fraktionen oder Parteien)
 * @param {{fractionIds: string[]}} alliance
 * @param {Group[]} [fractions] Fraktionen mit `partyIds`
 * @returns {Record<string, string>} Gruppen-ID → Stimmverhalten
 */
export function allianceVotes(groups, alliance, fractions = []) {
  const fractionIds = new Set(alliance?.fractionIds || []);
  const memberIds = new Set(fractionIds);
  for (const fraction of fractions) {
    if (!fractionIds.has(fraction.id)) continue;
    for (const partyId of fraction.partyIds || []) memberIds.add(partyId);
  }

  const votes = {};
  for (const group of groups) {
    const ids = group.partyIds && group.partyIds.length ? group.partyIds : [group.id];
    const inAlliance = memberIds.has(group.id) || ids.every((id) => memberIds.has(id));
    votes[group.id] = inAlliance ? VOTE_YES : VOTE_NO;
  }
  return votes;
}

/**
 * @typedef {{id: string, name: string, shortName?: string, color?: string, seats: number, partyIds?: string[]}} Group
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
 * Benannte Allianzen auswerten.
 *
 * Für jede Allianz wird geprüft, ob ihre anwesenden Mitglieder das
 * erforderliche Mehr erreichen (angenommen, alle übrigen Anwesenden stimmen
 * dagegen). Allianzen, deren Fraktionen nicht alle vorhanden sind, entfallen.
 *
 * @param {object} input
 * @param {Group[]} input.groups Fraktionen mit stimmberechtigten Sitzen
 * @param {Record<string, number>} [input.absences] Fraktions-ID → Absenzen
 * @param {string} [input.majorityType]
 * @param {Array} [input.alliances] Default: {@link ALLIANCES}
 * @returns {Array<{alliance: object, groups: Group[], votes: number, required: number, winning: boolean, margin: number}>}
 */
export function allianceResults({
  groups,
  absences = {},
  majorityType = 'simple',
  alliances = ALLIANCES,
}) {
  const byId = new Map(groups.map((group) => [group.id, group]));
  const presentOf = (group) => group.seats - clampAbsences(group.seats, absences[group.id]);

  const totalSeats = groups.reduce((total, group) => total + group.seats, 0);
  const presentTotal = groups.reduce((total, group) => total + presentOf(group), 0);
  const required = requiredMajority(majorityType, presentTotal, totalSeats);

  return alliances
    .filter((alliance) => alliance.fractionIds.every((id) => byId.has(id)))
    .map((alliance) => {
      const members = alliance.fractionIds.map((id) => byId.get(id));
      const votes = members.reduce((total, group) => total + presentOf(group), 0);
      return {
        alliance,
        groups: members,
        votes,
        required,
        winning: votes >= required,
        margin: votes - required,
      };
    });
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
