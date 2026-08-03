#!/usr/bin/env node
/**
 * Erzeugt eine **vorläufige** `data/members.json` aus `data/seating.json`.
 *
 * Hintergrund: Die vollständige Datenbank stammt aus dem Scraper
 * (`scripts/scrape-members.mjs`), der Netzzugriff auf parlament.winterthur.ch
 * benötigt. Solange dieser (noch) nicht gelaufen ist, liefert dieses Skript
 * eine reduzierte, aber korrekte Datenbasis: die 60 aktuellen Mitglieder mit
 * Name, Partei und Fraktion aus dem offiziellen Sitzplan.
 *
 * Alle nicht aus dem Sitzplan ableitbaren Felder bleiben `null`; die Datei ist
 * über `dataQuality.complete = false` als vorläufig gekennzeichnet und wird vom
 * ersten Scraper-Lauf vollständig ersetzt.
 *
 * Aufruf: node scripts/bootstrap-members.mjs [--dry-run]
 */

import {
  compareMembers,
  findGenderOverride,
  matchParty,
  readJson,
  slugify,
  splitNameFirstLast,
  writeJson,
} from './lib/normalize.mjs';

const SCHEMA_VERSION = 1;
const BASE_URL = 'https://parlament.winterthur.ch';

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const meta = await readJson('data/party-meta.json');
  const seating = await readJson('data/seating.json');
  const genderOverrides = await readJson('data/gender-overrides.json');

  const members = seating.seats.map((seat) => {
    const party = matchParty(meta, seat.party);
    if (!party) throw new Error(`Partei «${seat.party}» ist in party-meta.json nicht definiert.`);

    const { firstName, lastName } = splitNameFirstLast(seat.name);
    const displayName = `${firstName} ${lastName}`.trim();

    const member = {
      id: slugify(`${lastName} ${firstName}`),
      firstName,
      lastName,
      displayName,
      email: null,
      address: null,
      partyId: party.id,
      fractionId: party.fractionId,
      birthYear: null,
      profession: null,
      firstEntryDate: null,
      currentMandateStart: null,
      district: null,
      gender: 'unbekannt',
      genderSource: 'unknown',
      commissions: [],
      inquiries: [],
      inquiryCounts: { total: 0, first: 0, co: 0 },
      profileUrl: null,
      photoUrl: null,
    };

    const override = findGenderOverride(genderOverrides, member);
    if (override && override.gender && override.gender !== 'unbekannt') {
      member.gender = override.gender;
      member.genderSource = 'override';
    }

    return member;
  });

  members.sort(compareMembers(meta));

  const usedPartyIds = new Set(members.map((m) => m.partyId));
  const usedFractionIds = new Set(members.map((m) => m.fractionId));

  const database = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: `${seating.asOf}T00:00:00Z`,
    generatedBy: 'scripts/bootstrap-members.mjs',
    source: BASE_URL,
    sources: { seating: seating.source },
    dataQuality: {
      complete: false,
      note:
        'Vorläufiger Datenstand: Name, Partei und Fraktion stammen aus dem offiziellen Sitzplan ' +
        '(data/seating.json), das Geschlecht aus data/gender-overrides.json. Geburtsjahr, Beruf, ' +
        'Adresse, E-Mail, Kommissionen, Eintrittsdaten und Vorstösse werden erst durch den ersten ' +
        'Lauf von scripts/scrape-members.mjs befüllt.',
      warnings: 0,
    },
    legislature: null,
    parties: meta.parties
      .filter((party) => usedPartyIds.has(party.id))
      .map((party) => ({
        id: party.id,
        abbr: party.abbr,
        name: party.name,
        color: party.color,
        order: party.order,
        seats: members.filter((m) => m.partyId === party.id).length,
      })),
    fractions: meta.fractions
      .filter((fraction) => usedFractionIds.has(fraction.id))
      .map((fraction) => ({
        id: fraction.id,
        name: fraction.name,
        shortName: fraction.shortName,
        partyIds: fraction.partyIds,
        order: fraction.order,
        seats: members.filter((m) => m.fractionId === fraction.id).length,
      })),
    commissions: [],
    members,
  };

  console.log(`Mitglieder: ${members.length}`);
  console.log(
    `Parteien:   ${database.parties.map((p) => `${p.abbr} ${p.seats}`).join(', ')}`,
  );
  console.log(
    `Fraktionen: ${database.fractions.map((f) => `${f.shortName} ${f.seats}`).join(', ')}`,
  );

  if (dryRun) {
    console.log('\n--dry-run: data/members.json wurde NICHT geschrieben.');
    return;
  }

  await writeJson('data/members.json', database);
  console.log('\ndata/members.json geschrieben (vorläufig).');
}

main().catch((err) => {
  console.error(`Fehler: ${err.message}`);
  process.exitCode = 1;
});
