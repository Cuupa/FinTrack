// Statutory + private retirement provision (flag `pension`) -- pure, no React,
// no lib/server imports, like every other module in this folder.
//
// The German statutory pension is a points system: a year of work earns
// Entgeltpunkte (1.0 = exactly the average income that year), and the monthly
// gross pension is
//
//   points x Zugangsfaktor x aktueller Rentenwert
//
// The Rentenwert (euro per point per month) and the Rentenniveau are REFERENCE
// DATA, seeded in the `pension_reference` table and read through
// `usePensionReference` -- never hardcoded here, same rule as `basiszins` for
// the Vorabpauschale. This module only does arithmetic on what it is handed,
// which is also why it can be unit-tested without a database.
//
// Everything is computed in TODAY's money: no inflation, no wage growth, no
// return assumption on the private policies. A projection that quietly grew
// the Rentenwert by an assumed 2% a year would look precise and be fiction --
// this way the user sees what the entitlement is worth at today's value and
// can compare it against today's costs.

import type { PensionContract, PensionPoint, PensionSettings } from "../types";

/** One year of the seeded reference table. */
export interface PensionReference {
  year: number;
  /** Aktueller Rentenwert: gross monthly euro per Entgeltpunkt. */
  pensionValue: number;
  /** Sicherungsniveau vor Steuern in percent, or null when not recorded. */
  levelPct: number | null;
}

/** Deduction per month of drawing the pension before the standard age (0.3%). */
const EARLY_FACTOR_PER_MONTH = 0.003;
/** Bonus per month of drawing it later than the standard age (0.5%). */
const LATE_FACTOR_PER_MONTH = 0.005;

/**
 * The Rentenwert in force in `year`: the newest row at or before it
 * (carry-forward, exactly like a balance reading), falling back to the oldest
 * row for a year that predates the whole table. Null when there is no
 * reference data at all -- the caller then shows no euro figure rather than
 * inventing one.
 */
export function pensionValueOn(rows: readonly PensionReference[], year: number): number | null {
  if (rows.length === 0) return null;
  let best: PensionReference | null = null;
  let oldest: PensionReference = rows[0];
  for (const r of rows) {
    if (r.year < oldest.year) oldest = r;
    if (r.year <= year && (best === null || r.year > best.year)) best = r;
  }
  return (best ?? oldest).pensionValue;
}

/** The Rentenniveau recorded for `year` (carry-forward like the Rentenwert). */
export function pensionLevelOn(rows: readonly PensionReference[], year: number): number | null {
  if (rows.length === 0) return null;
  let best: PensionReference | null = null;
  for (const r of rows) {
    if (r.levelPct == null) continue;
    if (r.year <= year && (best === null || r.year > best.year)) best = r;
  }
  return best?.levelPct ?? null;
}

/** Entgeltpunkte recorded so far. */
export function totalPensionPoints(entries: readonly PensionPoint[]): number {
  return entries.reduce((s, e) => s + (Number.isFinite(e.points) ? e.points : 0), 0);
}

/**
 * Average points per year over the most recent `window` recorded years -- the
 * default assumption for every year still to come. Measured from the user's
 * own history rather than assumed (same reasoning as `stats.ts` deriving mu/
 * sigma from real returns instead of textbook figures). 0 with no history.
 */
export function averageAnnualPoints(entries: readonly PensionPoint[], window = 5): number {
  const recent = [...entries].sort((a, b) => b.year - a.year).slice(0, Math.max(1, window));
  if (recent.length === 0) return 0;
  return totalPensionPoints(recent) / recent.length;
}

/**
 * Regelaltersgrenze for a birth cohort, in years: 65 up to 1946, rising by one
 * month per cohort to 66 (1947-1957), then by two months per cohort to 67
 * (1958-1963), and 67 from 1964 on. Returned as a fraction of a year so the
 * Zugangsfaktor can be computed in months.
 */
export function standardRetirementAge(birthYear: number): number {
  if (!Number.isFinite(birthYear) || birthYear <= 1946) return 65;
  if (birthYear >= 1964) return 67;
  if (birthYear <= 1957) return 65 + (birthYear - 1946) / 12;
  return 66 + ((birthYear - 1957) * 2) / 12;
}

/**
 * Zugangsfaktor: 1.0 at the standard age, minus 0.3% per month drawn early,
 * plus 0.5% per month drawn later. Floored at 0 so a nonsensical input can
 * never produce a negative pension.
 */
export function accessFactor(retirementAge: number, standardAge: number): number {
  const months = Math.round((retirementAge - standardAge) * 12);
  if (months === 0) return 1;
  const factor =
    months < 0 ? 1 + months * EARLY_FACTOR_PER_MONTH : 1 + months * LATE_FACTOR_PER_MONTH;
  return Math.max(0, factor);
}

export interface PensionProjection {
  /** Entgeltpunkte recorded so far. */
  currentPoints: number;
  /** Points still expected between `currentYear` and retirement. */
  futurePoints: number;
  totalPoints: number;
  /** Points assumed per remaining year (explicit setting or measured average). */
  annualPoints: number;
  /** Calendar year the pension starts, or null without a birth year. */
  retirementYear: number | null;
  /** Regelaltersgrenze for the cohort, or null without a birth year. */
  standardAge: number | null;
  /** Zugangsfaktor applied to the projected pension. */
  accessFactor: number;
  /** Gross monthly statutory pension at retirement, in today's money. Null
   *  when there is no reference Rentenwert to value the points with. */
  monthlyStatutory: number | null;
  /** What the points earned SO FAR are worth per month at today's Rentenwert
   *  (no Zugangsfaktor -- it is the entitlement, not a projection). */
  monthlyEarned: number | null;
  /** Sum of the private policies' expected monthly payouts. */
  monthlyPrivate: number;
  /** Statutory plus private, null while the statutory half is unknown. */
  monthlyTotal: number | null;
  /** Shortfall against `settings.targetMonthly`, 0 when covered or untargeted. */
  gap: number;
}

/**
 * Projects the monthly retirement income: the points already earned plus one
 * assumed year's worth for every year left, valued at the current Rentenwert
 * and adjusted by the Zugangsfaktor, plus whatever the private policies pay.
 *
 * With no birth year there is no retirement date, so nothing is extrapolated
 * and the projection reports the entitlement earned so far -- an honest "here
 * is where you stand" instead of a projection resting on a guess.
 */
export function projectPension(input: {
  entries: readonly PensionPoint[];
  contracts: readonly PensionContract[];
  reference: readonly PensionReference[];
  settings: PensionSettings;
  currentYear: number;
}): PensionProjection {
  const { entries, contracts, reference, settings, currentYear } = input;
  const currentPoints = totalPensionPoints(entries);
  const pensionValue = pensionValueOn(reference, currentYear);
  const monthlyEarned = pensionValue != null ? currentPoints * pensionValue : null;

  const birthYear = settings.birthYear;
  const standardAge = birthYear != null ? standardRetirementAge(birthYear) : null;
  const retirementAge = settings.retirementAge ?? standardAge;
  const retirementYear =
    birthYear != null && retirementAge != null ? Math.round(birthYear + retirementAge) : null;

  const annualPoints = settings.annualPoints ?? averageAnnualPoints(entries);
  const yearsLeft = retirementYear != null ? Math.max(0, retirementYear - currentYear) : 0;
  const futurePoints = annualPoints * yearsLeft;
  const totalPoints = currentPoints + futurePoints;

  const factor =
    retirementAge != null && standardAge != null ? accessFactor(retirementAge, standardAge) : 1;

  const monthlyStatutory = pensionValue != null ? totalPoints * pensionValue * factor : null;
  const monthlyPrivate = contracts.reduce((s, c) => s + (c.expectedMonthlyPension ?? 0), 0);
  const monthlyTotal = monthlyStatutory != null ? monthlyStatutory + monthlyPrivate : null;

  const target = settings.targetMonthly;
  const gap = target != null && monthlyTotal != null ? Math.max(0, target - monthlyTotal) : 0;

  return {
    currentPoints,
    futurePoints,
    totalPoints,
    annualPoints,
    retirementYear,
    standardAge,
    accessFactor: factor,
    monthlyStatutory,
    monthlyEarned,
    monthlyPrivate,
    monthlyTotal,
    gap,
  };
}
