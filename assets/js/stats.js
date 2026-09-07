/**
 * Statistik — Aggregationen über die Mitgliederdaten (ohne DOM).
 *
 * Alle Kennzahlen berücksichtigen, dass Felder fehlen können: Geburtsjahr,
 * Beruf oder Stadtkreis sind erst nach einem Scraper-Lauf vollständig. Jede
 * Auswertung liefert deshalb zusätzlich die Anzahl bekannter Werte (`known`).
 */

import { ageOf, tenureYears, groupsFor } from './data.js';

export const GENDER_LABELS = { m: 'männlich', w: 'weiblich', d: 'divers', unbekannt: 'unbekannt' };

const AGE_BUCKETS = [
  { label: 'unter 30', min: 0, max: 29 },
  { label: '30–39', min: 30, max: 39 },
  { label: '40–49', min: 40, max: 49 },
  { label: '50–59', min: 50, max: 59 },
  { label: '60–69', min: 60, max: 69 },
  { label: '70 und älter', min: 70, max: Infinity },
];

const TENURE_BUCKETS = [
  { label: 'unter 4 Jahren', min: 0, max: 4 },
  { label: '4–8 Jahre', min: 4, max: 8 },
  { label: '8–12 Jahre', min: 8, max: 12 },
  { label: '12–16 Jahre', min: 12, max: 16 },
  { label: 'über 16 Jahre', min: 16, max: Infinity },
];

/** Arithmetisches Mittel (auf eine Nachkommastelle gerundet) oder `null`. */
export function average(values) {
  if (!values.length) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

/** Median oder `null`. */
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(value * 10) / 10;
}

function bucketize(entries, buckets) {
  return buckets.map((bucket) => ({
    label: bucket.label,
    count: entries.filter((value) => value >= bucket.min && value <= bucket.max).length,
  }));
}

function frequencies(values) {
  const map = new Map();
  for (const value of values) {
    const key = String(value).trim();
    if (!key) continue;
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'));
}

/**
 * Aggregiert eine Mitgliedermenge.
 * @param {Array<object>} members
 * @param {Date} [referenceDate]
 */
export function aggregate(members, referenceDate = new Date()) {
  const ages = members.map((member) => ageOf(member, referenceDate)).filter((value) => value != null);
  const tenures = members.map((member) => tenureYears(member, referenceDate)).filter((value) => value != null);

  const gender = { m: 0, w: 0, d: 0, unbekannt: 0 };
  for (const member of members) {
    const key = Object.prototype.hasOwnProperty.call(gender, member.gender) ? member.gender : 'unbekannt';
    gender[key]++;
  }

  return {
    count: members.length,
    gender: {
      counts: gender,
      known: members.length - gender.unbekannt,
      shareKnown: members.length ? Math.round(((members.length - gender.unbekannt) / members.length) * 100) : 0,
    },
    age: {
      known: ages.length,
      average: average(ages),
      median: median(ages),
      histogram: bucketize(ages, AGE_BUCKETS),
    },
    tenure: {
      known: tenures.length,
      average: average(tenures),
      median: median(tenures),
      histogram: bucketize(tenures, TENURE_BUCKETS),
    },
    districts: frequencies(members.map((member) => member.district).filter(Boolean)),
    districtsKnown: members.filter((member) => member.district).length,
    professions: frequencies(members.map((member) => member.profession).filter(Boolean)),
    professionsKnown: members.filter((member) => member.profession).length,
    inquiries: {
      total: members.reduce((sum, member) => sum + (member.inquiryCount || 0), 0),
    },
  };
}

/**
 * Gesamtauswertung plus Auswertung je Gruppe.
 * @param {object} db
 * @param {'party'|'fraction'} mode
 * @param {Date} [referenceDate]
 */
export function computeStats(db, mode = 'party', referenceDate = new Date()) {
  const groups = groupsFor(db, mode);
  return {
    mode,
    total: aggregate(db.members, referenceDate),
    groups: groups.map((group) => ({ group, stats: aggregate(group.members, referenceDate) })),
    seats: groups.map((group) => ({
      id: group.id,
      label: group.shortName || group.name,
      color: group.color,
      seats: group.seats,
    })),
  };
}
