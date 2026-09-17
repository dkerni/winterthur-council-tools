/**
 * Auswertungen zu den politischen Geschäften — reine Rechenlogik.
 *
 * Arbeitet ausschliesslich auf `data/inquiry-facts.json` (Feldbeschreibung im
 * Kopf jener Datei). Kein DOM-Zugriff, keine Abhängigkeiten — dadurch aus Node
 * testbar, gleich wie `assets/js/majority.js`.
 *
 * Alle Gruppierungen erfolgen **nach Partei**, nicht nach Fraktion.
 */

/** Rollenkennzahlen der Verfasserangaben (siehe `scripts/lib/inquiry-facts.mjs`). */
export const ROLE_FIRST = 1;
export const ROLE_CO = 2;

/** Ab diesem Jahr enthält die Quelle brauchbare Verfasserangaben. */
export const FIRST_AUTHOR_YEAR = 2002;

/** Ab diesem Jahr sind die abgeleiteten Sitzzahlen vollständig genug. */
export const FIRST_SEAT_YEAR = 2007;

/** Ab diesem Jahr erfasst die Quelle die Beschlussart des Stadtparlaments. */
export const FIRST_OUTCOME_YEAR = 2017;

/* ─── Grundlagen ───────────────────────────────────────────────────── */

/** Median einer Zahlenreihe; `null` bei leerer Reihe. */
export function median(values) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

/** Geschäfte eines Zeitraums (Grenzen eingeschlossen). */
export function inPeriod(inquiries, { from = -Infinity, to = Infinity } = {}) {
  return inquiries.filter((fact) => Number.isFinite(fact.y) && fact.y >= from && fact.y <= to);
}

/** Nur Vorstösse — Geschäftsarten, die von Ratsmitgliedern eingereicht werden. */
export function motionsOnly(inquiries, motionTypeIds) {
  const wanted = new Set(motionTypeIds ?? []);
  return inquiries.filter((fact) => wanted.has(fact.t));
}

/**
 * Parteizuordnungen eines Geschäfts.
 *
 * `first` zählt nur die erstunterzeichnende Person (ein Geschäft = eine Partei),
 * `all` jede unterzeichnende Person einzeln. Bei `all` wird eine Partei pro
 * Geschäft nur einmal gezählt, damit drei Unterschriften derselben Partei das
 * Bild nicht verzerren.
 * @returns {string[]} Partei-IDs
 */
export function partiesOf(fact, mode = 'first') {
  if (mode === 'first') return fact.p ? [fact.p] : [];
  const parties = new Set();
  for (const [, partyId] of fact.a ?? []) if (partyId) parties.add(partyId);
  return [...parties];
}

/** Reihenfolge und Darstellung der Parteien aus `party-meta.json`. */
export function orderedParties(parties, activeIds) {
  const wanted = activeIds ? new Set(activeIds) : null;
  return [...(parties ?? [])]
    .filter((party) => !wanted || wanted.has(party.id))
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
}

/** Parteien, die im Zeitraum überhaupt vorkommen. */
export function partiesPresent(inquiries, mode = 'all') {
  const seen = new Set();
  for (const fact of inquiries) for (const partyId of partiesOf(fact, mode)) seen.add(partyId);
  return seen;
}

/** Lückenlose Jahresliste. */
export function yearRange(inquiries) {
  const years = inquiries.map((fact) => fact.y).filter(Number.isFinite);
  if (!years.length) return [];
  const from = Math.min(...years);
  const to = Math.max(...years);
  return Array.from({ length: to - from + 1 }, (_, index) => from + index);
}

/** Wandelt Reihen in Anteile je Kategorie (Spaltensumme = 100). */
export function toShares(series, decimals = 1) {
  const length = series[0]?.values.length ?? 0;
  const totals = Array.from({ length }, (_, index) => series.reduce((sum, row) => sum + (row.values[index] || 0), 0));
  const factor = 10 ** decimals;
  return series.map((row) => ({
    ...row,
    values: row.values.map((value, index) =>
      totals[index] ? Math.round((value / totals[index]) * 100 * factor) / factor : 0,
    ),
  }));
}

/* ─── A · Überblick ────────────────────────────────────────────────── */

/**
 * Geschäfte je Jahr, getrennt nach Vorstössen und übrigen Geschäften.
 * @returns {{years: number[], series: Array<{id: string, label: string, color: string, values: number[]}>}}
 */
export function businessByYear(inquiries, motionTypeIds) {
  const years = yearRange(inquiries);
  const motions = new Set(motionTypeIds ?? []);
  const counts = new Map(years.map((year) => [year, { motion: 0, other: 0 }]));

  for (const fact of inquiries) {
    const entry = counts.get(fact.y);
    if (!entry) continue;
    if (motions.has(fact.t)) entry.motion++;
    else entry.other++;
  }

  return {
    years,
    series: [
      { id: 'vorstoesse', label: 'Vorstösse', color: '#2f5d8a', values: years.map((year) => counts.get(year).motion) },
      {
        id: 'uebrige',
        label: 'Übrige Geschäfte',
        color: '#b6bfcb',
        values: years.map((year) => counts.get(year).other),
      },
    ],
  };
}

/** Geschäftsarten mit Anzahl, absteigend. */
export function countByType(inquiries, types) {
  const labels = new Map((types ?? []).map((type) => [type.id, type.label]));
  const counts = new Map();
  for (const fact of inquiries) counts.set(fact.t, (counts.get(fact.t) ?? 0) + 1);
  return [...counts]
    .map(([id, count]) => ({ id, label: labels.get(id) ?? id, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Zeitverlauf der Vorstossarten. Selten genutzte Arten werden zu «Übrige»
 * zusammengefasst, damit das Diagramm lesbar bleibt.
 */
export function typesByYear(inquiries, types, { top = 6 } = {}) {
  const years = yearRange(inquiries);
  const ranked = countByType(inquiries, types);
  const keep = ranked.slice(0, top).map((entry) => entry.id);
  const palette = ['#2f5d8a', '#4b8fbd', '#7fb3d5', '#c0562f', '#e0a458', '#6a8f6b', '#b6bfcb'];

  const rows = new Map([...keep, 'uebrige'].map((id) => [id, new Map(years.map((year) => [year, 0]))]));
  for (const fact of inquiries) {
    const row = rows.get(keep.includes(fact.t) ? fact.t : 'uebrige');
    if (row?.has(fact.y)) row.set(fact.y, row.get(fact.y) + 1);
  }

  const labels = new Map(ranked.map((entry) => [entry.id, entry.label]));
  const series = [...keep, 'uebrige'].map((id, index) => ({
    id,
    label: id === 'uebrige' ? 'Übrige Arten' : labels.get(id) ?? id,
    color: palette[index % palette.length],
    values: years.map((year) => rows.get(id).get(year)),
  }));

  return { years, series: series.filter((row) => row.values.some(Boolean)) };
}

/* ─── B · Parteien ─────────────────────────────────────────────────── */

/**
 * Vorstösse je Partei und Jahr.
 * @param {Array<object>} motions bereits auf Vorstösse gefiltert
 * @param {{parties: Array<object>, mode?: 'first'|'all'}} options
 */
export function partyByYear(motions, { parties, mode = 'first' } = {}) {
  const years = yearRange(motions);
  const present = partiesPresent(motions, mode);
  const ordered = orderedParties(parties, present);

  const rows = new Map(ordered.map((party) => [party.id, new Map(years.map((year) => [year, 0]))]));
  for (const fact of motions) {
    for (const partyId of partiesOf(fact, mode)) {
      const row = rows.get(partyId);
      if (row?.has(fact.y)) row.set(fact.y, row.get(fact.y) + 1);
    }
  }

  return {
    years,
    series: ordered.map((party) => ({
      id: party.id,
      label: party.abbr ?? party.id,
      color: party.color,
      values: years.map((year) => rows.get(party.id).get(year)),
    })),
  };
}

/** Vorstösse je Partei über den ganzen Zeitraum. */
export function partyTotals(motions, { parties, mode = 'first' } = {}) {
  const counts = new Map();
  for (const fact of motions) {
    for (const partyId of partiesOf(fact, mode)) counts.set(partyId, (counts.get(partyId) ?? 0) + 1);
  }
  return orderedParties(parties, new Set(counts.keys())).map((party) => ({
    id: party.id,
    label: party.abbr ?? party.id,
    color: party.color,
    count: counts.get(party.id) ?? 0,
  }));
}

/**
 * Summe der Sitzjahre je Partei im Zeitraum — Grundlage der Normalisierung
 * «je Ratsmitglied». Nur Jahre mit plausibler Gesamtzahl fliessen ein.
 */
export function seatYears(seats, { from, to } = {}) {
  const totals = new Map();
  let years = 0;
  for (const entry of seats ?? []) {
    if (entry.year < from || entry.year > to || !entry.complete) continue;
    years++;
    for (const [partyId, count] of Object.entries(entry.byParty)) {
      totals.set(partyId, (totals.get(partyId) ?? 0) + count);
    }
  }
  return { totals, years };
}

/**
 * Vorstösse je Ratsmitglied und Jahr. Aussagekräftig erst ab {@link FIRST_SEAT_YEAR}.
 */
export function partyPerSeat(motions, { parties, seats, from, to, mode = 'first' } = {}) {
  const start = Math.max(from ?? FIRST_SEAT_YEAR, FIRST_SEAT_YEAR);
  const window = inPeriod(motions, { from: start, to });
  const { totals } = seatYears(seats, { from: start, to });

  return partyTotals(window, { parties, mode })
    .map((entry) => {
      const seatYearCount = totals.get(entry.id) ?? 0;
      return {
        ...entry,
        seatYears: seatYearCount,
        perSeat: seatYearCount ? Math.round((entry.count / seatYearCount) * 100) / 100 : null,
      };
    })
    .filter((entry) => entry.perSeat !== null);
}

/** Instrumenten-Mix: welche Vorstossart nutzt welche Partei? */
export function instrumentMix(motions, { parties, types, mode = 'first', top = 6 } = {}) {
  const ranked = countByType(motions, types);
  const keep = ranked.slice(0, top).map((entry) => entry.id);
  const labels = new Map(ranked.map((entry) => [entry.id, entry.label]));
  const palette = ['#2f5d8a', '#4b8fbd', '#7fb3d5', '#c0562f', '#e0a458', '#6a8f6b', '#b6bfcb'];

  const present = partiesPresent(motions, mode);
  const ordered = orderedParties(parties, present);
  const rows = new Map([...keep, 'uebrige'].map((id) => [id, new Map(ordered.map((party) => [party.id, 0]))]));

  for (const fact of motions) {
    const row = rows.get(keep.includes(fact.t) ? fact.t : 'uebrige');
    for (const partyId of partiesOf(fact, mode)) {
      if (row?.has(partyId)) row.set(partyId, row.get(partyId) + 1);
    }
  }

  const series = [...keep, 'uebrige']
    .map((id, index) => ({
      id,
      label: id === 'uebrige' ? 'Übrige Arten' : labels.get(id) ?? id,
      color: palette[index % palette.length],
      values: ordered.map((party) => rows.get(id).get(party.id)),
    }))
    .filter((row) => row.values.some(Boolean));

  return { categories: ordered.map((party) => party.abbr ?? party.id), partyIds: ordered.map((p) => p.id), series };
}

/**
 * Mitunterzeichnungen zwischen den Parteien.
 *
 * Zeile = Partei der erstunterzeichnenden Person, Spalte = Partei der
 * mitunterzeichnenden Person. `shares` normalisiert jede Zeile auf 100 %.
 */
export function coSignerMatrix(motions, { parties } = {}) {
  const relevant = motions.filter((fact) => fact.p && (fact.a ?? []).some((entry) => entry[2] === ROLE_CO));
  const present = new Set();
  for (const fact of relevant) {
    present.add(fact.p);
    for (const [, partyId, role] of fact.a ?? []) if (role === ROLE_CO && partyId) present.add(partyId);
  }

  const ordered = orderedParties(parties, present);
  const index = new Map(ordered.map((party, position) => [party.id, position]));
  const counts = ordered.map(() => ordered.map(() => 0));

  for (const fact of relevant) {
    const row = index.get(fact.p);
    if (row === undefined) continue;
    for (const [, partyId, role] of fact.a ?? []) {
      if (role !== ROLE_CO) continue;
      const column = index.get(partyId);
      if (column !== undefined) counts[row][column]++;
    }
  }

  const shares = counts.map((row) => {
    const total = row.reduce((sum, value) => sum + value, 0);
    return row.map((value) => (total ? Math.round((value / total) * 1000) / 10 : 0));
  });

  return { parties: ordered, counts, shares };
}

/**
 * Beschlüsse des Stadtparlaments je Partei. Erst ab {@link FIRST_OUTCOME_YEAR}
 * aussagekräftig.
 */
export function outcomeByParty(motions, { parties, outcomeGroups, mode = 'first', from, to } = {}) {
  const start = Math.max(from ?? FIRST_OUTCOME_YEAR, FIRST_OUTCOME_YEAR);
  const window = inPeriod(motions, { from: start, to }).filter((fact) => fact.o);

  const present = partiesPresent(window, mode);
  const ordered = orderedParties(parties, present);
  const colors = {
    angenommen: '#4a7c59',
    kenntnisnahme: '#7fa8c9',
    abgeschrieben: '#d8a13a',
    zurueckgewiesen: '#c0782f',
    abgelehnt: '#b4443a',
    zurueckgezogen: '#8d8d8d',
    andere: '#c9ced6',
  };

  const groups = outcomeGroups ?? [];
  const rows = new Map(groups.map((group) => [group.id, new Map(ordered.map((party) => [party.id, 0]))]));
  for (const fact of window) {
    const row = rows.get(fact.o);
    for (const partyId of partiesOf(fact, mode)) {
      if (row?.has(partyId)) row.set(partyId, row.get(partyId) + 1);
    }
  }

  const series = groups
    .map((group) => ({
      id: group.id,
      label: group.label,
      color: colors[group.id] ?? '#c9ced6',
      values: ordered.map((party) => rows.get(group.id).get(party.id)),
    }))
    .filter((row) => row.values.some(Boolean));

  return { categories: ordered.map((party) => party.abbr ?? party.id), partyIds: ordered.map((p) => p.id), series };
}

/** Mediane Behandlungsdauer je Partei in Tagen. */
export function durationByParty(motions, { parties, mode = 'first' } = {}) {
  const buckets = new Map();
  for (const fact of motions) {
    if (!Number.isFinite(fact.d)) continue;
    for (const partyId of partiesOf(fact, mode)) {
      if (!buckets.has(partyId)) buckets.set(partyId, []);
      buckets.get(partyId).push(fact.d);
    }
  }

  return orderedParties(parties, new Set(buckets.keys()))
    .map((party) => ({
      id: party.id,
      label: party.abbr ?? party.id,
      color: party.color,
      count: buckets.get(party.id).length,
      median: median(buckets.get(party.id)),
    }))
    .filter((entry) => entry.median !== null);
}

/* ─── C · Personen ─────────────────────────────────────────────────── */

/** Aktivste Ratsmitglieder nach Erst- bzw. allen Unterzeichnungen. */
export function topPeople(motions, { people, parties, mode = 'first', limit = 20 } = {}) {
  const counts = new Map();
  for (const fact of motions) {
    for (const [personId, , role] of fact.a ?? []) {
      if (mode === 'first' && role !== ROLE_FIRST) continue;
      counts.set(personId, (counts.get(personId) ?? 0) + 1);
    }
  }

  const byId = new Map((people ?? []).map((person) => [person.id, person]));
  const colors = new Map((parties ?? []).map((party) => [party.id, party.color]));
  const abbr = new Map((parties ?? []).map((party) => [party.id, party.abbr ?? party.id]));

  return [...counts]
    .map(([id, count]) => {
      const person = byId.get(id);
      return {
        id,
        name: person?.name ?? id,
        partyId: person?.partyId ?? null,
        party: person?.partyId ? abbr.get(person.partyId) ?? person.partyId : '—',
        color: colors.get(person?.partyId) ?? '#b6bfcb',
        from: person?.from ?? null,
        to: person?.to ?? null,
        count,
      };
    })
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'de'))
    .slice(0, limit);
}

/* ─── D · Datenqualität ────────────────────────────────────────────── */

/** Kennzahlen für den Transparenzkasten. */
export function qualitySummary(facts, { from, to } = {}) {
  const rows = (facts.coverage ?? []).filter(
    (entry) => entry.year >= (from ?? -Infinity) && entry.year <= (to ?? Infinity),
  );
  const sum = (key) => rows.reduce((total, entry) => total + entry[key], 0);
  const motions = sum('motions');

  return {
    years: rows.map((entry) => entry.year),
    total: sum('total'),
    motions,
    withAuthors: sum('withAuthors'),
    authorShare: motions ? Math.round((sum('withAuthors') / motions) * 1000) / 10 : 0,
    withDuration: sum('withDuration'),
    withOutcome: sum('withOutcome'),
    coverage: rows,
  };
}
