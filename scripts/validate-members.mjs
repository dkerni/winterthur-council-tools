#!/usr/bin/env node
/**
 * Schema- und Plausibilitätsprüfung für die Daten im Ordner `data/`.
 *
 * Geprüft werden `members.json`, `party-meta.json`, `gender-overrides.json`
 * und `seating.json`.
 *
 * Aufruf:
 *   node scripts/validate-members.mjs [--strict] [--expect-members=60]
 *
 *   --strict   Warnungen (z.B. fehlende Detaildaten, vorläufiger Datenstand)
 *              werden wie Fehler behandelt. Wird nach einem Scraper-Lauf
 *              verwendet, um unvollständige Ergebnisse zu erkennen.
 *
 * Exit-Code 1, sobald ein Fehler gefunden wurde.
 */

import { findGenderOverride, matchParty, normalizeName, readJson } from './lib/normalize.mjs';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;
const GENDERS = new Set(['m', 'w', 'd', 'unbekannt']);
const GENDER_SOURCES = new Set(['override', 'unknown']);

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const expectedMembers = Number(args.find((a) => a.startsWith('--expect-members='))?.split('=')[1]) || 60;

const errors = [];
const warnings = [];

const error = (message) => errors.push(message);
const warn = (message) => warnings.push(message);

function checkPartyMeta(meta) {
  const partyIds = new Set();
  const orders = new Set();

  for (const party of meta.parties) {
    if (partyIds.has(party.id)) error(`party-meta: doppelte Partei-ID «${party.id}»`);
    partyIds.add(party.id);

    if (!HEX_COLOR.test(party.color || '')) error(`party-meta: ungültige Farbe bei «${party.id}»`);
    if (typeof party.order !== 'number') error(`party-meta: «${party.id}» hat keine Reihenfolge`);
    if (orders.has(party.order)) error(`party-meta: Reihenfolge ${party.order} ist doppelt vergeben`);
    orders.add(party.order);

    if (!meta.fractions.some((f) => f.id === party.fractionId)) {
      error(`party-meta: Partei «${party.id}» verweist auf unbekannte Fraktion «${party.fractionId}»`);
    }
  }

  const fractionIds = new Set();
  for (const fraction of meta.fractions) {
    if (fractionIds.has(fraction.id)) error(`party-meta: doppelte Fraktions-ID «${fraction.id}»`);
    fractionIds.add(fraction.id);

    for (const partyId of fraction.partyIds || []) {
      if (!partyIds.has(partyId)) {
        error(`party-meta: Fraktion «${fraction.id}» verweist auf unbekannte Partei «${partyId}»`);
      }
    }
  }
}

function checkMembers(db, meta) {
  if (db.schemaVersion !== 1) error(`members.json: unbekannte schemaVersion «${db.schemaVersion}»`);
  if (!db.generatedAt || !ISO_DATETIME.test(db.generatedAt)) {
    error(`members.json: generatedAt ist kein ISO-Zeitstempel («${db.generatedAt}»)`);
  }
  if (!Array.isArray(db.members)) {
    error('members.json: «members» fehlt oder ist kein Array');
    return;
  }

  if (db.members.length !== expectedMembers) {
    error(`members.json: ${db.members.length} Mitglieder, erwartet ${expectedMembers}`);
  }

  const ids = new Set();
  const missing = {
    birthYear: 0,
    profession: 0,
    firstEntryDate: 0,
    district: 0,
    commissions: 0,
    profileUrl: 0,
    email: 0,
  };
  for (const member of db.members) {
    const who = member.displayName || member.id || '(ohne Namen)';

    for (const field of ['id', 'firstName', 'lastName', 'displayName', 'partyId', 'fractionId']) {
      if (!member[field]) error(`members.json: «${who}» — Pflichtfeld «${field}» fehlt`);
    }

    if (member.id) {
      if (ids.has(member.id)) error(`members.json: doppelte ID «${member.id}»`);
      ids.add(member.id);
    }

    const party = meta.parties.find((p) => p.id === member.partyId);
    if (member.partyId && !party) {
      error(`members.json: «${who}» — unbekannte Partei «${member.partyId}»`);
    }

    const fraction = meta.fractions.find((f) => f.id === member.fractionId);
    if (member.fractionId && !fraction) {
      error(`members.json: «${who}» — unbekannte Fraktion «${member.fractionId}»`);
    }
    if (party && fraction && party.fractionId !== fraction.id) {
      error(
        `members.json: «${who}» — Partei «${party.id}» gehört laut party-meta.json zur Fraktion ` +
          `«${party.fractionId}», nicht zu «${fraction.id}»`,
      );
    }

    if (!GENDERS.has(member.gender)) error(`members.json: «${who}» — ungültiges Geschlecht «${member.gender}»`);
    if (!GENDER_SOURCES.has(member.genderSource)) {
      error(`members.json: «${who}» — ungültige genderSource «${member.genderSource}»`);
    }
    if (member.gender !== 'unbekannt' && member.genderSource !== 'override') {
      error(`members.json: «${who}» — Geschlecht gesetzt, aber genderSource ist nicht «override»`);
    }

    for (const field of ['firstEntryDate', 'currentMandateStart']) {
      if (member[field] && !ISO_DATE.test(member[field])) {
        error(`members.json: «${who}» — «${field}» ist kein ISO-Datum («${member[field]}»)`);
      }
    }
    if (member.firstEntryDate && member.currentMandateStart && member.currentMandateStart < member.firstEntryDate) {
      error(`members.json: «${who}» — currentMandateStart liegt vor firstEntryDate`);
    }

    if (member.email && !EMAIL.test(member.email)) {
      error(`members.json: «${who}» — ungültige E-Mail «${member.email}»`);
    }

    if (member.birthYear != null) {
      const year = Number(member.birthYear);
      if (!Number.isInteger(year) || year < 1920 || year > new Date().getFullYear() - 17) {
        error(`members.json: «${who}» — unplausibles Geburtsjahr «${member.birthYear}»`);
      }
    }

    for (const entry of member.commissions || []) {
      if (!entry.id || !entry.name) error(`members.json: «${who}» — unvollständiger Kommissionseintrag`);
    }

    for (const inquiry of member.inquiries || []) {
      if (inquiry.date && !ISO_DATE.test(inquiry.date)) {
        error(`members.json: «${who}» — Vorstoss mit ungültigem Datum «${inquiry.date}»`);
      }
    }

    const counts = member.inquiryCounts || {};
    if (counts.total !== (member.inquiries || []).length) {
      error(`members.json: «${who}» — inquiryCounts.total passt nicht zur Anzahl Vorstösse`);
    }
    if ((counts.first || 0) + (counts.co || 0) > (counts.total || 0)) {
      error(`members.json: «${who}» — inquiryCounts sind inkonsistent`);
    }

    // Warnungen: Felder, die erst der Scraper befüllt (aggregiert ausgegeben).
    if (!member.birthYear) missing.birthYear++;
    if (!member.profession) missing.profession++;
    if (!member.firstEntryDate) missing.firstEntryDate++;
    if (!member.district) missing.district++;
    if (!(member.commissions || []).length) missing.commissions++;
    if (!member.profileUrl) missing.profileUrl++;
    if (!member.email) missing.email++;
  }

  const MISSING_LABELS = {
    birthYear: 'ohne Geburtsjahr',
    profession: 'ohne Beruf',
    firstEntryDate: 'ohne Eintrittsdatum',
    district: 'ohne Stadtkreis',
    commissions: 'ohne Kommissionszugehörigkeit',
    profileUrl: 'ohne Profil-URL',
    email: 'ohne E-Mail-Adresse',
  };
  for (const [field, count] of Object.entries(missing)) {
    if (count) warn(`${count} von ${db.members.length} Mitgliedern ${MISSING_LABELS[field]}`);
  }

  // Sitzsummen
  const partySeatSum = (db.parties || []).reduce((sum, p) => sum + (p.seats || 0), 0);
  if (partySeatSum !== db.members.length) {
    error(`members.json: Summe der Parteisitze (${partySeatSum}) ≠ Anzahl Mitglieder (${db.members.length})`);
  }
  for (const party of db.parties || []) {
    const actual = db.members.filter((m) => m.partyId === party.id).length;
    if (actual !== party.seats) {
      error(`members.json: Partei «${party.id}» meldet ${party.seats} Sitze, gezählt wurden ${actual}`);
    }
  }

  const fractionSeatSum = (db.fractions || []).reduce((sum, f) => sum + (f.seats || 0), 0);
  if (fractionSeatSum !== db.members.length) {
    error(`members.json: Summe der Fraktionssitze (${fractionSeatSum}) ≠ Anzahl Mitglieder (${db.members.length})`);
  }
  for (const fraction of db.fractions || []) {
    const actual = db.members.filter((m) => m.fractionId === fraction.id).length;
    if (actual !== fraction.seats) {
      error(`members.json: Fraktion «${fraction.id}» meldet ${fraction.seats} Sitze, gezählt wurden ${actual}`);
    }
  }

  for (const commission of db.commissions || []) {
    if (!commission.id || !commission.name) error('members.json: unvollständiger Kommissions-Stammdatensatz');
  }

  if (db.dataQuality && db.dataQuality.complete === false) {
    warn('members.json ist als vorläufig gekennzeichnet (dataQuality.complete = false)');
  }
}

function checkGenderOverrides(overrides, db) {
  const seen = new Set();
  for (const entry of overrides.overrides || []) {
    if (!entry.name && !entry.id) {
      error('gender-overrides.json: Eintrag ohne «name» und ohne «id»');
      continue;
    }
    if (!GENDERS.has(entry.gender)) {
      error(`gender-overrides.json: ungültiger Wert «${entry.gender}» bei «${entry.name || entry.id}»`);
    }
    const key = entry.id ? `id:${entry.id}` : normalizeName(entry.name);
    if (seen.has(key)) error(`gender-overrides.json: doppelter Eintrag «${entry.name || entry.id}»`);
    seen.add(key);
  }

  if (!db || !Array.isArray(db.members)) return;

  for (const entry of overrides.overrides || []) {
    const matched = db.members.some((member) => {
      const found = findGenderOverride({ overrides: [entry] }, member);
      return Boolean(found);
    });
    if (!matched) warn(`gender-overrides.json: «${entry.name || entry.id}» passt zu keinem Mitglied`);
  }

  const missing = db.members.filter((m) => m.gender === 'unbekannt').length;
  if (missing) warn(`${missing} Mitglieder ohne bekanntes Geschlecht`);
}

function checkSeating(seating, meta) {
  if (!Array.isArray(seating.seats)) {
    error('seating.json: «seats» fehlt');
    return;
  }
  if (seating.seats.length !== expectedMembers) {
    error(`seating.json: ${seating.seats.length} Sitze, erwartet ${expectedMembers}`);
  }

  const ids = new Set();
  for (const seat of [...seating.seats, ...(seating.frontSeats || [])]) {
    if (ids.has(seat.id)) error(`seating.json: doppelte Sitz-ID «${seat.id}»`);
    ids.add(seat.id);

    if (typeof seat.px !== 'number' || typeof seat.py !== 'number') {
      error(`seating.json: Sitz «${seat.id}» hat keine gültigen Koordinaten`);
    }
    if (!matchParty(meta, seat.party)) {
      error(`seating.json: Sitz «${seat.id}» verweist auf unbekannte Partei «${seat.party}»`);
    }
  }

  for (const key of ['pdfHeight', 'dxMin', 'dxMax', 'dyMin', 'dyMax', 'stageWidth', 'stageHeight']) {
    if (typeof seating.coordinateMapping?.[key] !== 'number') {
      error(`seating.json: coordinateMapping.${key} fehlt`);
    }
  }
}

async function main() {
  const meta = await readJson('data/party-meta.json');
  const db = await readJson('data/members.json');
  const overrides = await readJson('data/gender-overrides.json');
  const seating = await readJson('data/seating.json');

  checkPartyMeta(meta);
  checkMembers(db, meta);
  checkGenderOverrides(overrides, db);
  checkSeating(seating, meta);

  if (warnings.length) {
    console.log(`Warnungen (${warnings.length}):`);
    for (const message of warnings.slice(0, 40)) console.log(`  · ${message}`);
    if (warnings.length > 40) console.log(`  · … und ${warnings.length - 40} weitere`);
    console.log('');
  }

  if (errors.length) {
    console.error(`Fehler (${errors.length}):`);
    for (const message of errors) console.error(`  ✗ ${message}`);
    process.exitCode = 1;
    return;
  }

  if (strict && warnings.length) {
    console.error(`--strict: ${warnings.length} Warnung(en) werden als Fehler gewertet.`);
    process.exitCode = 1;
    return;
  }

  console.log(`✓ Validierung erfolgreich (${db.members.length} Mitglieder, ${warnings.length} Warnungen).`);
}

main().catch((err) => {
  console.error(`Fehler: ${err.message}`);
  process.exitCode = 1;
});
