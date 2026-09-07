/**
 * Datenzugriff — lädt `data/members.json` und `data/party-meta.json`,
 * führt beides zu einer konsistenten Datenbank zusammen und stellt
 * Selektoren für die Tools bereit.
 *
 * Die Rohdaten werden vom Scraper (`scripts/scrape-members.mjs`) erzeugt;
 * die Website liest sie nur.
 */

import { fetchJson } from './paths.js';
import { loadPartyMeta, councilOf } from './parties.js';

let dbPromise = null;

/**
 * Lädt die Mitgliederdatenbank (einmalig, Promise-Cache).
 * @returns {Promise<object>} zusammengeführte Datenbank
 */
export function loadDatabase() {
  if (!dbPromise) {
    dbPromise = build().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

async function build() {
  const [raw, meta] = await Promise.all([fetchJson('data/members.json'), loadPartyMeta()]);

  if (!raw || !Array.isArray(raw.members)) {
    throw new Error('members.json enthält keine Mitgliederliste.');
  }

  const rawParties = new Map((raw.parties || []).map((p) => [p.id, p]));
  const rawFractions = new Map((raw.fractions || []).map((f) => [f.id, f]));

  const council = councilOf(meta);
  const nonVotingById = new Map(council.nonVoting.map((entry) => [entry.memberId, entry]));
  const nonVotingByName = new Map(
    council.nonVoting.filter((entry) => entry.name).map((entry) => [entry.name.toLowerCase(), entry]),
  );

  const members = raw.members.map((m) => {
    const nonVoting =
      nonVotingById.get(m.id) || nonVotingByName.get(String(m.displayName || '').toLowerCase()) || null;
    return {
      ...m,
      commissions: m.commissions || [],
      inquiryCount: Number(m.inquiryCount) || 0,
      canVote: !nonVoting,
      ...(nonVoting ? { nonVotingRole: nonVoting.role || 'ohne Stimmrecht' } : {}),
    };
  });

  // Parteien: Reihenfolge/Farbe/Kurzname aus party-meta.json (verbindlich),
  // Sitze aus den tatsächlichen Mitgliederdaten.
  const parties = meta.parties.map((p) => ({
    id: p.id,
    abbr: p.abbr,
    name: p.name,
    color: p.color,
    order: p.order,
    fractionId: p.fractionId,
    seats: members.filter((m) => m.partyId === p.id).length,
    ...(rawParties.get(p.id) ? { sourceName: rawParties.get(p.id).name } : {}),
  }));

  // Parteien, die in den Daten vorkommen, aber (noch) nicht in party-meta.json stehen.
  for (const m of members) {
    if (m.partyId && !parties.some((p) => p.id === m.partyId)) {
      const fallback = rawParties.get(m.partyId);
      parties.push({
        id: m.partyId,
        abbr: fallback?.abbr || m.partyId.toUpperCase(),
        name: fallback?.name || m.partyId,
        color: fallback?.color || '#666',
        order: 99,
        fractionId: m.fractionId || null,
        seats: members.filter((x) => x.partyId === m.partyId).length,
      });
    }
  }

  const fractions = meta.fractions.map((f) => ({
    id: f.id,
    name: f.name,
    shortName: f.shortName,
    partyIds: f.partyIds,
    order: f.order,
    seats: members.filter((m) => m.fractionId === f.id).length,
    ...(rawFractions.get(f.id) ? { sourceName: rawFractions.get(f.id).name } : {}),
  }));

  for (const m of members) {
    if (m.fractionId && !fractions.some((f) => f.id === m.fractionId)) {
      const fallback = rawFractions.get(m.fractionId);
      fractions.push({
        id: m.fractionId,
        name: fallback?.name || m.fractionId,
        shortName: fallback?.shortName || m.fractionId,
        partyIds: fallback?.partyIds || [],
        order: 99,
        seats: members.filter((x) => x.fractionId === m.fractionId).length,
      });
    }
  }

  const commissions = (raw.commissions || [])
    .map((c) => ({
      ...c,
      memberCount: members.filter((m) => m.commissions.some((mc) => mc.id === c.id)).length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));

  const db = {
    schemaVersion: raw.schemaVersion,
    generatedAt: raw.generatedAt || null,
    generatedBy: raw.generatedBy || null,
    dataQuality: raw.dataQuality || { complete: true },
    source: raw.source || 'https://parlament.winterthur.ch',
    sources: raw.sources || {},
    legislature: raw.legislature || council.legislature || null,
    council,
    meta,
    parties: parties.sort((a, b) => a.order - b.order),
    fractions: fractions.sort((a, b) => a.order - b.order),
    commissions,
    members,
  };

  db.partyById = new Map(db.parties.map((p) => [p.id, p]));
  db.fractionById = new Map(db.fractions.map((f) => [f.id, f]));
  db.commissionById = new Map(db.commissions.map((c) => [c.id, c]));
  db.memberById = new Map(db.members.map((m) => [m.id, m]));

  return db;
}

/** Partei eines Mitglieds (oder `null`). */
export function partyOf(db, member) {
  return db.partyById.get(member.partyId) || null;
}

/** Fraktion eines Mitglieds (oder `null`). */
export function fractionOf(db, member) {
  return db.fractionById.get(member.fractionId) || null;
}

/**
 * Gruppen für Mehrheits- und Statistikberechnungen.
 *
 * `seats` ist die Zahl der Ratssitze, `votingSeats` die Zahl der
 * **stimmberechtigten** Sitze (das Ratspräsidium stimmt nicht mit).
 *
 * @param {object} db
 * @param {'party'|'fraction'} mode
 * @returns {Array<{id,name,shortName,color,order,seats,votingSeats,partyIds,members}>}
 */
export function groupsFor(db, mode) {
  const votingSeats = (members) => members.filter((m) => m.canVote !== false).length;

  if (mode === 'fraction') {
    return db.fractions
      .map((f) => {
        const members = db.members.filter((m) => m.fractionId === f.id);
        const leadParty = f.partyIds
          .map((id) => db.partyById.get(id))
          .filter(Boolean)
          .sort((a, b) => b.seats - a.seats)[0];
        return {
          id: f.id,
          name: f.name,
          shortName: f.shortName,
          color: leadParty ? leadParty.color : '#666',
          order: f.order,
          seats: members.length,
          votingSeats: votingSeats(members),
          partyIds: f.partyIds,
          members,
        };
      })
      .filter((g) => g.seats > 0)
      .sort((a, b) => a.order - b.order);
  }

  return db.parties
    .map((p) => {
      const members = db.members.filter((m) => m.partyId === p.id);
      return {
        id: p.id,
        name: p.name,
        shortName: p.abbr,
        color: p.color,
        order: p.order,
        seats: members.length,
        votingSeats: votingSeats(members),
        partyIds: [p.id],
        members,
      };
    })
    .filter((g) => g.seats > 0)
    .sort((a, b) => a.order - b.order);
}

/**
 * Gruppen für den Mehrheitsrechner: `seats` entspricht hier den
 * **stimmberechtigten** Sitzen, `councilSeats` den effektiven Ratssitzen.
 * @param {object} db
 * @param {'party'|'fraction'} mode
 */
export function votingGroupsFor(db, mode) {
  return groupsFor(db, mode)
    .map((group) => ({ ...group, councilSeats: group.seats, seats: group.votingSeats }))
    .filter((group) => group.seats > 0);
}

/** Mitglieder gruppiert nach Partei-ID. */
export function membersByParty(db) {
  return groupBy(db.members, (m) => m.partyId);
}

/** Mitglieder gruppiert nach Fraktions-ID. */
export function membersByFraction(db) {
  return groupBy(db.members, (m) => m.fractionId);
}

/** Mitglieder gruppiert nach Kommissions-ID (Mehrfachzuordnung möglich). */
export function membersByCommission(db) {
  const map = new Map();
  for (const member of db.members) {
    for (const entry of member.commissions) {
      if (!map.has(entry.id)) map.set(entry.id, []);
      map.get(entry.id).push(member);
    }
  }
  return map;
}

function groupBy(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

/**
 * Alter in Jahren. Die Quelle liefert nur das Geburtsjahr, das Alter ist
 * daher auf ±1 Jahr genau.
 * @returns {number|null}
 */
export function ageOf(member, referenceDate = new Date()) {
  if (!member.birthYear) return null;
  return referenceDate.getFullYear() - member.birthYear;
}

/**
 * Amtsdauer in Jahren seit dem **ersten** Eintritt ins Parlament
 * (Unterbrüche werden nicht abgezogen — siehe README).
 *
 * Ist ein Austritt (`mandateEnd`) erfasst und liegt er in der Vergangenheit,
 * endet die Amtsdauer an diesem Datum statt am Stichtag.
 * @returns {number|null}
 */
export function tenureYears(member, referenceDate = new Date()) {
  const start = member.firstEntryDate || member.currentMandateStart;
  if (!start) return null;
  const startDate = new Date(start);
  if (Number.isNaN(startDate.getTime())) return null;

  const endDate = member.mandateEnd ? new Date(member.mandateEnd) : null;
  const end = endDate && !Number.isNaN(endDate.getTime()) && endDate < referenceDate ? endDate : referenceDate;

  const years = (end - startDate) / (365.2425 * 24 * 60 * 60 * 1000);
  return years < 0 ? 0 : Math.round(years * 10) / 10;
}

/** Anzeigename einer Kommission. */
export function commissionName(db, id) {
  const commission = db.commissionById.get(id);
  return commission ? commission.shortName || commission.name : id;
}

/** ISO-Datum → `TT.MM.JJJJ` (leer bei fehlendem Wert). */
export function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** ISO-Zeitstempel → `TT.MM.JJJJ, HH:MM` (leer bei fehlendem Wert). */
export function formatDateTime(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return date.toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Benutzerfreundliche Fehlermeldung für Ladefehler. */
export function dataErrorMessage(err) {
  const detail = err && err.message ? err.message : String(err);
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    return (
      'Die Daten konnten nicht geladen werden, weil die Seite direkt aus dem Dateisystem ' +
      'geöffnet wurde. Bitte einen lokalen Webserver verwenden (z.B. «npx serve .»). ' +
      `Details: ${detail}`
    );
  }
  return `Die Daten konnten nicht geladen werden. Details: ${detail}`;
}
