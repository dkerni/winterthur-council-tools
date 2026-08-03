#!/usr/bin/env node
/**
 * Scraper für die Mitgliederdatenbank des Stadtparlaments Winterthur.
 *
 * Ablauf:
 *   1. Listenseite der Mitglieder holen → `data-entities`-JSON auslesen
 *   2. Auf aktive Mandate filtern (erwartet: 60 Mitglieder)
 *   3. Je Mitglied die Personenseite holen (Geburtsjahr, Beruf, Stadtkreis,
 *      Adresse, E-Mail, politische Vorstösse)
 *   4. Fraktionsseite holen und die Mitglieder je Fraktion zuordnen
 *   5. Normalisieren, Geschlechts-Overrides einmischen und
 *      `data/members.json` deterministisch schreiben
 *
 * Aufruf:
 *   node scripts/scrape-members.mjs [--dry-run] [--limit N] [--verbose]
 *
 * Hinweis: Die Quellseite liefert keinen CORS-Header — der Abruf ist deshalb
 * nur serverseitig (Node/GitHub Action) möglich, nicht aus dem Browser.
 */

import {
  BASE_URL,
  extractDataEntities,
  extractEmail,
  extractHrefs,
  extractLabeledFields,
  extractRefId,
  fetchPage,
  parseAddress,
  parseDate,
  parseYear,
  pickField,
  toText,
} from './lib/icms.mjs';
import {
  compareMembers,
  findGenderOverride,
  matchFraction,
  matchParty,
  normalizeName,
  readJson,
  splitNameFirstLast,
  splitNameLastFirst,
  writeJson,
} from './lib/normalize.mjs';

const SOURCES = {
  memberList: `${BASE_URL}/stadtparlament/27428`,
  fractions: `${BASE_URL}/fraktionen`,
  commissions: `${BASE_URL}/kommissionen`,
  memberDetail: `${BASE_URL}/behoerdenmitglieder/{id}`,
};

const SCHEMA_VERSION = 1;
const EXPECTED_MEMBERS = 60;

const args = process.argv.slice(2);
const options = {
  dryRun: args.includes('--dry-run'),
  verbose: args.includes('--verbose'),
  limit: Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1]) || null,
};

const warnings = [];

function log(message) {
  console.log(message);
}

function verbose(message) {
  if (options.verbose) console.log(message);
}

function warn(message) {
  warnings.push(message);
  console.warn(`  ⚠ ${message}`);
}

/* ─── Listenseite ──────────────────────────────────────────────────── */

/** Ist der Datensatz ein aktives Mandat? */
function isActiveMandate(entity) {
  const until = parseDate(entity._mandatPersonDatumBis || entity.datumBis || '');
  if (until && new Date(until) < new Date()) return false;

  const activeFlag = toText(entity._funktionAktiv || entity.funktionAktiv || '');
  if (activeFlag) return true;

  // Ohne Aktiv-Kennzeichen gilt: kein Austrittsdatum ⇒ aktiv.
  return !until;
}

function parseListEntity(entity, meta) {
  const id = extractRefId(entity._nameVorname || '', 'person');
  const nameText = toText(entity._nameVorname || '');
  const { firstName, lastName } = splitNameLastFirst(nameText);

  const partyText = toText(entity._partei || '');
  const party = matchParty(meta, partyText);
  if (!party && partyText) warn(`Partei nicht zugeordnet: «${partyText}» (${nameText})`);

  const commissions = [];
  const commissionSource = entity._taetigInAktiv || entity._taetigInAlle || '';
  const commissionHtml = String(commissionSource);
  for (const match of commissionHtml.matchAll(/<a\b[^>]*href\s*=\s*["'][^"']*\/_rte\/behoerde\/(\d+)["'][^>]*>([\s\S]*?)<\/a>([^<]*)/gi)) {
    const roleText = toText(match[3]).replace(/^[\s,(–-]+|[\s,)–-]+$/g, '');
    commissions.push({
      id: match[1],
      name: toText(match[2]),
      role: roleText || 'Mitglied',
    });
  }

  return {
    id,
    firstName,
    lastName,
    displayName: `${firstName} ${lastName}`.trim(),
    partyId: party ? party.id : null,
    partyText,
    district: toText(entity.wahlkreis || entity._wahlkreis || '') || null,
    firstEntryDate: parseDate(entity._mandatPersonFirstDatumVon || ''),
    currentMandateStart: parseDate(entity._mandatPersonDatumVon || ''),
    mandateEnd: parseDate(entity._mandatPersonDatumBis || ''),
    contactText: toText(entity._kontakt || ''),
    email: extractEmail(entity._kontakt || ''),
    commissions,
    photoUrl: firstHref(entity._thumbnail),
    profileUrl: id ? SOURCES.memberDetail.replace('{id}', id) : null,
  };
}

function firstHref(html) {
  const srcMatch = String(html ?? '').match(/src\s*=\s*["']([^"']+)["']/i);
  if (srcMatch) return new URL(srcMatch[1], BASE_URL).href;
  const [href] = extractHrefs(html);
  return href ? new URL(href, BASE_URL).href : null;
}

/* ─── Personenseite ────────────────────────────────────────────────── */

const INQUIRY_TYPES = new Map([
  ['1', 'Motion'],
  ['2', 'Postulat'],
  ['3', 'Interpellation'],
  ['4', 'Schriftliche Anfrage'],
]);

async function fetchMemberDetail(member) {
  const html = await fetchPage(member.profileUrl, { log: (m) => verbose(m) });
  const fields = extractLabeledFields(html);
  const text = toText(html);

  const firstName = pickField(fields, ['vorname']);
  const lastName = pickField(fields, ['nachname', 'name']);

  const detail = {
    firstName: firstName || member.firstName,
    lastName: lastName || member.lastName,
    email: extractEmail(html) || member.email,
    birthYear: parseYear(pickField(fields, ['geburtsjahr', 'jahrgang', 'geburtsdatum']) || ''),
    profession: pickField(fields, ['beruf', 'tätigkeit', 'berufliche tätigkeit']),
    district: pickField(fields, ['stadtkreis', 'kreis', 'wahlkreis']) || member.district,
    entryDate: parseDate(pickField(fields, ['eintritt', 'im amt seit', 'mitglied seit']) || ''),
    exitDate: parseDate(pickField(fields, ['austritt']) || ''),
    address: buildAddress(fields, text),
    inquiries: extractInquiries(html),
  };

  if (!detail.birthYear) {
    const fallback = text.match(/Geburtsjahr[^\d]{0,20}(\d{4})/i);
    if (fallback) detail.birthYear = Number(fallback[1]);
  }

  return detail;
}

function buildAddress(fields, text) {
  const street = pickField(fields, ['strasse', 'straße', 'adresse']);
  const zipCity = pickField(fields, ['plz/ort', 'plz / ort', 'plz', 'ort']);

  if (street || zipCity) {
    const parsed = parseAddress([street, zipCity].filter(Boolean).join('\n'));
    return {
      street: street && !/^\d{4}\s/.test(street) ? street : parsed?.street || null,
      zip: parsed?.zip || null,
      city: parsed?.city || null,
    };
  }

  const parsed = parseAddress(text);
  return parsed || null;
}

function extractInquiries(html) {
  const entities = extractDataEntities(html);
  const inquiries = [];

  for (const entity of entities) {
    const title = toText(entity.name || entity._name || entity.titel || '');
    const number = toText(entity.nummer || entity._nummer || '');
    if (!title && !number) continue;

    const id =
      extractRefId(entity.name || entity._name || '', 'geschaeft') ||
      (String(entity.name || '').match(/\/(\d{5,})/) || [])[1] ||
      null;

    const categoryId = String(entity.kategorieId ?? entity._kategorieId ?? '').trim();
    const type =
      toText(entity.kategorie || entity._kategorie || '') ||
      INQUIRY_TYPES.get(categoryId) ||
      (categoryId ? `Kategorie ${categoryId}` : null);

    inquiries.push({
      id,
      title,
      type,
      number: number || null,
      date: parseDate(entity.geschaeftsdatum || entity._geschaeftsdatum || ''),
      role: toText(entity._rolle || entity.rolle || '') || null,
    });
  }

  return inquiries;
}

function countInquiries(inquiries) {
  let first = 0;
  let co = 0;
  for (const inquiry of inquiries) {
    if (/erst/i.test(inquiry.role || '')) first++;
    else if (/mit/i.test(inquiry.role || '')) co++;
  }
  return { total: inquiries.length, first, co };
}

/* ─── Fraktionen ───────────────────────────────────────────────────── */

async function fetchFractionAssignments(meta) {
  const assignments = new Map(); // normalisierter Name → Fraktions-ID
  const found = [];

  const html = await fetchPage(SOURCES.fractions, { log: (m) => verbose(m) });
  const entities = extractDataEntities(html);

  for (const entity of entities) {
    const label = toText(entity.name || entity._name || entity.bezeichnung || '');
    const until = parseDate(entity.datumBis || entity._datumBis || '');
    if (until && new Date(until) < new Date()) continue;

    const refField = entity.name || entity._name || entity._behoerde || '';
    const fractionSourceId = extractRefId(refField, 'behoerde');
    const fraction = matchFraction(meta, label);

    if (!fraction) {
      if (label) warn(`Fraktion nicht zugeordnet: «${label}»`);
      continue;
    }
    if (!fractionSourceId) {
      warn(`Keine Behörden-ID für Fraktion «${label}» gefunden`);
      continue;
    }

    found.push({ fraction, sourceId: fractionSourceId, label });

    const memberHtml = await fetchPage(`/_rte/behoerde/${fractionSourceId}`, { log: (m) => verbose(m) });
    const memberEntities = extractDataEntities(memberHtml);

    const names = memberEntities.length
      ? memberEntities.map((e) => toText(e._nameVorname || e.name || e._name || ''))
      : [...memberHtml.matchAll(/\/_rte\/person\/\d+["'][^>]*>([\s\S]*?)<\/a>/gi)].map((m) => toText(m[1]));

    for (const rawName of names) {
      if (!rawName) continue;
      const { firstName, lastName } = splitNameLastFirst(rawName);
      assignments.set(normalizeName(`${firstName} ${lastName}`), fraction.id);
      assignments.set(normalizeName(rawName), fraction.id);
    }

    // Personen-IDs sind die zuverlässigere Zuordnung, falls vorhanden.
    for (const match of memberHtml.matchAll(/\/_rte\/person\/(\d+)/gi)) {
      assignments.set(`id:${match[1]}`, fraction.id);
    }

    verbose(`  Fraktion ${fraction.name}: ${names.length} Mitglieder`);
  }

  return { assignments, fractions: found };
}

/* ─── Hauptlauf ────────────────────────────────────────────────────── */

async function main() {
  const meta = await readJson('data/party-meta.json');
  const genderOverrides = await readJson('data/gender-overrides.json');

  log(`Lade Mitgliederliste: ${SOURCES.memberList}`);
  const listHtml = await fetchPage(SOURCES.memberList, { log: (m) => verbose(m) });
  const entities = extractDataEntities(listHtml, 'icmsTable-personList');

  if (!entities.length) {
    throw new Error(
      'Keine Datensätze im Attribut «data-entities» gefunden — die Struktur der Quellseite hat sich vermutlich geändert.',
    );
  }
  log(`  ${entities.length} Datensätze gefunden (inkl. ehemaliger Mitglieder)`);

  let listMembers = entities
    .filter(isActiveMandate)
    .map((entity) => parseListEntity(entity, meta))
    .filter((member) => {
      if (!member.id) {
        warn(`Mitglied ohne ID übersprungen: «${member.displayName}»`);
        return false;
      }
      return true;
    });

  // Doppelte Einträge (mehrere Mandate derselben Person) zusammenführen.
  const byId = new Map();
  for (const member of listMembers) {
    const existing = byId.get(member.id);
    if (!existing) {
      byId.set(member.id, member);
      continue;
    }
    existing.commissions.push(...member.commissions.filter((c) => !existing.commissions.some((e) => e.id === c.id)));
  }
  listMembers = [...byId.values()];

  log(`  ${listMembers.length} aktive Mitglieder`);
  if (listMembers.length !== EXPECTED_MEMBERS) {
    warn(`Erwartet wurden ${EXPECTED_MEMBERS} aktive Mitglieder, gefunden ${listMembers.length}`);
  }

  if (options.limit) {
    listMembers = listMembers.slice(0, options.limit);
    log(`  Begrenzt auf ${listMembers.length} Mitglieder (--limit)`);
  }

  log('Lade Fraktionen …');
  const { assignments, fractions } = await fetchFractionAssignments(meta);
  log(`  ${fractions.length} aktive Fraktionen`);

  log(`Lade ${listMembers.length} Personenseiten …`);
  const members = [];
  for (const [index, listMember] of listMembers.entries()) {
    verbose(`  [${index + 1}/${listMembers.length}] ${listMember.displayName}`);
    let detail = null;
    try {
      detail = await fetchMemberDetail(listMember);
    } catch (err) {
      warn(`Personenseite ${listMember.profileUrl} nicht lesbar: ${err.message}`);
    }

    const firstName = detail?.firstName || listMember.firstName;
    const lastName = detail?.lastName || listMember.lastName;
    const displayName = `${firstName} ${lastName}`.trim();

    const fractionId =
      assignments.get(`id:${listMember.id}`) ||
      assignments.get(normalizeName(displayName)) ||
      assignments.get(normalizeName(`${lastName} ${firstName}`)) ||
      meta.parties.find((party) => party.id === listMember.partyId)?.fractionId ||
      null;

    if (!fractionId) warn(`Keine Fraktion für ${displayName} gefunden`);

    const inquiries = detail?.inquiries || [];
    const member = {
      id: listMember.id,
      firstName,
      lastName,
      displayName,
      email: detail?.email || listMember.email || null,
      address: detail?.address || null,
      partyId: listMember.partyId,
      fractionId,
      birthYear: detail?.birthYear || null,
      profession: detail?.profession || null,
      firstEntryDate: listMember.firstEntryDate || detail?.entryDate || null,
      currentMandateStart: listMember.currentMandateStart || detail?.entryDate || null,
      district: listMember.district || detail?.district || null,
      gender: 'unbekannt',
      genderSource: 'unknown',
      commissions: listMember.commissions,
      inquiries,
      inquiryCounts: countInquiries(inquiries),
      profileUrl: listMember.profileUrl,
      photoUrl: listMember.photoUrl,
    };

    const override = findGenderOverride(genderOverrides, member);
    if (override && override.gender && override.gender !== 'unbekannt') {
      member.gender = override.gender;
      member.genderSource = 'override';
    }

    members.push(member);
  }

  members.sort(compareMembers(meta));

  const usedPartyIds = new Set(members.map((m) => m.partyId).filter(Boolean));
  const usedFractionIds = new Set(members.map((m) => m.fractionId).filter(Boolean));

  const commissionMap = new Map();
  for (const member of members) {
    for (const entry of member.commissions) {
      if (!commissionMap.has(entry.id)) {
        commissionMap.set(entry.id, {
          id: entry.id,
          name: entry.name,
          shortName: shortenCommission(entry.name),
          url: `${BASE_URL}/behoerden/${entry.id}`,
        });
      }
    }
  }

  const database = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    generatedBy: 'scripts/scrape-members.mjs',
    source: BASE_URL,
    sources: SOURCES,
    dataQuality: {
      complete: true,
      note: 'Vollständig aus den Quellseiten erhoben. Das Geschlecht stammt aus data/gender-overrides.json.',
      warnings: warnings.length,
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
    commissions: [...commissionMap.values()].sort((a, b) => a.name.localeCompare(b.name, 'de')),
    members,
  };

  const enriched = members.filter((m) => m.birthYear || m.profession).length;
  log(`\nZusammenfassung:`);
  log(`  Mitglieder:        ${members.length}`);
  log(`  mit Detaildaten:   ${enriched}`);
  log(`  Kommissionen:      ${database.commissions.length}`);
  log(`  Vorstösse gesamt:  ${members.reduce((sum, m) => sum + m.inquiryCounts.total, 0)}`);
  log(`  Warnungen:         ${warnings.length}`);

  if (options.dryRun) {
    log('\n--dry-run: data/members.json wurde NICHT geschrieben.');
    return;
  }

  await writeJson('data/members.json', database);
  log('\ndata/members.json geschrieben.');
}

function shortenCommission(name) {
  if (!name) return null;
  const abbreviated = name
    .replace(/Sachkommission/i, 'SK')
    .replace(/Aufsichtskommission/i, 'AK')
    .replace(/Spezialkommission/i, 'SpK')
    .replace(/Geschäftsprüfungskommission/i, 'GPK')
    .replace(/Kommission/i, 'K.')
    .trim();
  return abbreviated.length > 32 ? abbreviated.slice(0, 31) + '…' : abbreviated;
}

main().catch((err) => {
  console.error(`\nFehler: ${err.message}`);
  process.exitCode = 1;
});
