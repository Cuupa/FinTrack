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
  /** Most Entgeltpunkte one year of work can possibly earn: the
   *  Beitragsbemessungsgrenze divided by the Durchschnittsentgelt, which the
   *  legislator keeps at roughly 2.0. Null when not recorded. */
  maxPoints: number | null;
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

/** The maximum Entgeltpunkte a year can earn in `year` (carry-forward like the
 *  Rentenwert). Null with no reference data, which disables the cap entirely
 *  rather than falling back to a constant. */
export function maxPointsOn(rows: readonly PensionReference[], year: number): number | null {
  let best: PensionReference | null = null;
  let newest: PensionReference | null = null;
  for (const r of rows) {
    if (r.maxPoints == null) continue;
    if (newest === null || r.year > newest.year) newest = r;
    if (r.year <= year && (best === null || r.year > best.year)) best = r;
  }
  // A year before the table starts still gets a cap: the ratio is structural
  // (the BBG is set at ~2x the average wage), not a figure that trends.
  return (best ?? newest)?.maxPoints ?? null;
}

/** Entgeltpunkte recorded so far. */
export function totalPensionPoints(entries: readonly PensionPoint[]): number {
  return entries.reduce((s, e) => s + (Number.isFinite(e.points) ? e.points : 0), 0);
}

/**
 * Entgeltpunkte earned to date.
 *
 * A Renteninformation leads with a CUMULATIVE total ("Sie haben bisher 17,0322
 * Entgeltpunkte erworben"); the year-by-year split is buried in the
 * Versicherungsverlauf. So the total is what the user has in hand, and
 * `settings.totalPoints` is where it goes. Per-year rows are the optional
 * detail: while a total is on record, only the years AFTER it add on top, the
 * same way the next statement will count them.
 */
export function currentPensionPoints(
  entries: readonly PensionPoint[],
  settings: Pick<PensionSettings, "totalPoints" | "totalPointsYear">,
): number {
  if (settings.totalPoints == null) return totalPensionPoints(entries);
  const asOf = settings.totalPointsYear;
  const after = asOf == null ? [] : entries.filter((e) => e.year > asOf);
  return settings.totalPoints + totalPensionPoints(after);
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

/** How far above the typical year a row has to sit to be called out. A real
    career step change is well under this; a cumulative total is far over it. */
const OUTLIER_FACTOR = 3;

/** How far past the measured window the fitted slope may be carried before the
    level is held flat. See the note in `projectPension`. */
const TREND_EXTRAPOLATION_FACTOR = 2;

/**
 * The recorded years that a year could actually have produced.
 *
 * `maxPoints` is the Beitragsbemessungsgrenze expressed in Entgeltpunkte: no
 * single year can exceed it, so a row that does is not a year at all -- it is
 * the Renteninformation's cumulative total in the wrong field. Dropping it is
 * the honest reading, and it beats bending the estimator around it: once the
 * impossible rows are gone the remaining ones can be modelled properly,
 * including their TREND.
 *
 * With no reference data there is no physical cap, so the same row is caught
 * statistically instead: anything a multiple above the median of the record.
 * Some filter has to survive here, because what comes next is a TREND, and a
 * trend fitted through a cumulative total does not merely overstate one year --
 * it makes every remaining year worse than the last.
 */
export function plausibleEntries(
  entries: readonly PensionPoint[],
  maxPoints: number | null,
): PensionPoint[] {
  const real = entries.filter((e) => Number.isFinite(e.points) && e.points > 0);
  if (maxPoints != null) return real.filter((e) => e.points <= maxPoints);
  const typical = typicalAnnualPoints(real, real.length || 1);
  if (typical <= 0) return real;
  return real.filter((e) => e.points <= typical * OUTLIER_FACTOR);
}

/** A straight line through the recorded years: what a year earns now, and how
 *  fast that is moving. */
export interface PointsTrend {
  /** Points in `baseYear`, from the fit. */
  base: number;
  /** Change per calendar year. Zero when there is nothing to fit. */
  slope: number;
  /** The year `base` refers to -- the most recent one in the sample. */
  baseYear: number;
  /** How many rows the fit rests on. */
  sampleSize: number;
}

/**
 * Least-squares trend over the most recent `window` plausible years.
 *
 * Entgeltpunkte are your salary divided by the national average, so they are
 * not a flat line for anyone whose career is still going: promotions and
 * above-average raises push them up year after year. Holding the latest value
 * flat to retirement therefore understates a rising biography badly -- for a
 * 30-year horizon it was worth about a thousand euros a month against the
 * Renteninformation.
 *
 * One row cannot define a slope and two rows define one far too confidently on
 * noise, so a slope is only fitted from three years up; below that the level
 * is carried flat, which is what the DRV's own "if you carry on as before"
 * figure does.
 */
export function pointsTrend(
  entries: readonly PensionPoint[],
  maxPoints: number | null,
  window = 5,
): PointsTrend {
  const recent = plausibleEntries(entries, maxPoints)
    .sort((a, b) => b.year - a.year)
    .slice(0, Math.max(1, window))
    .sort((a, b) => a.year - b.year);

  if (recent.length === 0) return { base: 0, slope: 0, baseYear: 0, sampleSize: 0 };
  const baseYear = recent[recent.length - 1].year;
  if (recent.length < 3) {
    return {
      base: recent[recent.length - 1].points,
      slope: 0,
      baseYear,
      sampleSize: recent.length,
    };
  }

  const n = recent.length;
  const meanYear = recent.reduce((s, e) => s + e.year, 0) / n;
  const meanPoints = recent.reduce((s, e) => s + e.points, 0) / n;
  let num = 0;
  let den = 0;
  for (const e of recent) {
    num += (e.year - meanYear) * (e.points - meanPoints);
    den += (e.year - meanYear) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return {
    base: meanPoints + slope * (baseYear - meanYear),
    slope,
    baseYear,
    sampleSize: n,
  };
}

/**
 * The assumption for every year still to come: the MEDIAN of the recent
 * window, not the mean.
 *
 * A year's Entgeltpunkte barely move from one year to the next, so the median
 * and the mean agree on real data. They disagree in exactly one situation, and
 * it is the situation that keeps happening: a Renteninformation leads with a
 * CUMULATIVE total, and that total gets typed into a single year's row. One
 * row of 17 among rows of 1.2 drags the mean to ~6.4, every remaining year
 * inherits it, and the projection lands near 200 points and a five-figure
 * monthly pension against a statement saying 2.640 EUR. The median ignores it.
 *
 * `maxPointsOn` is the other half of that defence, but it is reference data:
 * absent (a lagging migration, no Supabase) there is no cap at all, and a
 * projection must not depend on a row existing in order to not be absurd.
 */
export function typicalAnnualPoints(entries: readonly PensionPoint[], window = 5): number {
  const recent = [...entries]
    .sort((a, b) => b.year - a.year)
    .slice(0, Math.max(1, window))
    .map((e) => (Number.isFinite(e.points) ? e.points : 0))
    .sort((a, b) => a - b);
  if (recent.length === 0) return 0;
  const mid = Math.floor(recent.length / 2);
  // Even counts take the LOWER of the two middles rather than their average:
  // with two rows, one of which may be a mistyped cumulative total, averaging
  // reintroduces exactly the problem the median is here to remove.
  return recent.length % 2 === 1 ? recent[mid] : recent[mid - 1];
}

/**
 * A recorded year far above the typical one -- the signature of a cumulative
 * total in a per-year row. Null when nothing stands out.
 *
 * Reported rather than silently dropped: the row is the user's data and only
 * they can say whether it is wrong, but a projection resting on it has to say
 * so out loud.
 */
export function annualPointsOutlier(
  entries: readonly PensionPoint[],
  maxPoints: number | null = null,
  window = 5,
): PensionPoint | null {
  const recent = [...entries].sort((a, b) => b.year - a.year).slice(0, Math.max(1, window));
  // With a Beitragsbemessungsgrenze the test is not statistical at all: a year
  // above it is impossible, full stop.
  if (maxPoints != null) {
    let worst: PensionPoint | null = null;
    for (const e of recent) {
      if (e.points > maxPoints && (worst === null || e.points > worst.points)) worst = e;
    }
    return worst;
  }
  const typical = typicalAnnualPoints(entries, window);
  if (typical <= 0) return null;
  let worst: PensionPoint | null = null;
  for (const e of recent) {
    if (e.points > typical * OUTLIER_FACTOR && (worst === null || e.points > worst.points)) {
      worst = e;
    }
  }
  return worst;
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
  /** Points assumed per remaining year, after the plausibility cap. */
  annualPoints: number;
  /** What was assumed before the cap, so the UI can say what it corrected. */
  rawAnnualPoints: number;
  /** The cap in force, or null when there is no reference data to cap with. */
  maxAnnualPoints: number | null;
  /** True when the assumption had to be capped -- the signature of a
   *  cumulative total typed into a single year's row. */
  annualPointsCapped: boolean;
  /** Points assumed for the FIRST remaining year, after the cap. */
  annualPointsStart: number;
  /** Points assumed for the LAST remaining year -- above `annualPointsStart`
   *  whenever the recorded years are rising. */
  annualPointsEnd: number;
  /** Fitted change per calendar year. 0 when the user typed an assumption, or
   *  when there are too few years to fit one. */
  annualPointsSlope: number;
  /** How many recorded years the trend rests on. 0 with a typed assumption. */
  trendSampleSize: number;
  /** A recorded year that no year could have produced (above the
   *  Beitragsbemessungsgrenze), or null. Excluded from the trend, but the row
   *  itself is still wrong and only the user can correct it. */
  outlierYear: PensionPoint | null;
  /** Calendar year the pension starts, or null without a birth year. */
  retirementYear: number | null;
  /** Regelaltersgrenze for the cohort, or null without a birth year. */
  standardAge: number | null;
  /** Zugangsfaktor applied to the projected pension. */
  accessFactor: number;
  /** The Rentenwert the points were valued at, or null with no reference data.
   *  Surfaced so the page can show its own arithmetic: one opaque number is
   *  impossible to argue with when it disagrees with the official statement. */
  pensionValue: number | null;
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
 * The per-year assumption is capped at what a year can physically earn (see
 * `maxPointsOn`), so a cumulative total in the wrong field cannot multiply.
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
  const currentPoints = currentPensionPoints(entries, settings);
  const pensionValue = pensionValueOn(reference, currentYear);
  const monthlyEarned = pensionValue != null ? currentPoints * pensionValue : null;

  const birthYear = settings.birthYear;
  const standardAge = birthYear != null ? standardRetirementAge(birthYear) : null;
  const retirementAge = settings.retirementAge ?? standardAge;
  const retirementYear =
    birthYear != null && retirementAge != null ? Math.round(birthYear + retirementAge) : null;

  // The per-remaining-year assumption is CAPPED at what a year can physically
  // earn. Without it, one wrong row poisoned every figure on the page: a user
  // who copied their statement's cumulative total (17 points) into a single
  // year got 17 points assumed for each of the ~32 years left, i.e. ~530 points
  // and a ~20.000 EUR monthly pension. The cap is reference data, not a
  // constant here (same rule as the Rentenwert), and no reference data means no
  // cap rather than an invented one.
  const maxAnnualPoints = maxPointsOn(reference, currentYear);
  const trend = pointsTrend(entries, maxAnnualPoints);
  const yearsLeft = retirementYear != null ? Math.max(0, retirementYear - currentYear) : 0;

  // A ceiling for the fitted trend when there is no Beitragsbemessungsgrenze to
  // clamp against. A three-year slope carried thirty years is an extrapolation
  // well past what the sample supports, and Entgeltpunkte are a RATIO to the
  // national average wage -- earning twice the average every year for the rest
  // of a career is already the extreme end.
  const trendCeiling = maxAnnualPoints ?? Math.max(trend.base * 2, trend.base);

  // A typed assumption is one number, so it is held flat: the user said what
  // they expect per year and the app does not then argue with a trend.
  const manual = settings.annualPoints;
  const rawAnnualPoints = manual ?? trend.base;

  let futurePoints = 0;
  let annualPointsStart = 0;
  let annualPointsEnd = 0;
  let capped = false;
  // How long the fitted slope is carried before the level is held flat. A
  // three-year sample does not license a thirty-year straight line: extended
  // that far it reaches the Beitragsbemessungsgrenze within a few years and
  // then quietly assumes the MAXIMUM for the rest of the career, which is the
  // same overstatement as before wearing a different hat. Careers do rise, but
  // they also plateau. Twice the measured window is as far as the data reaches.
  const trendYears = trend.sampleSize * TREND_EXTRAPOLATION_FACTOR;

  for (let i = 0; i < yearsLeft; i++) {
    const year = currentYear + i;
    const advanced = Math.min(Math.max(0, year - trend.baseYear), trendYears);
    const raw = manual ?? trend.base + trend.slope * advanced;
    const value = Math.max(0, Math.min(raw, trendCeiling));
    if (value < raw) capped = true;
    if (i === 0) annualPointsStart = value;
    annualPointsEnd = value;
    futurePoints += value;
  }
  // The flat-equivalent, so every existing display keeps meaning what it said.
  const annualPoints =
    yearsLeft > 0
      ? futurePoints / yearsLeft
      : Math.max(0, Math.min(rawAnnualPoints, trendCeiling));
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
    rawAnnualPoints,
    maxAnnualPoints,
    annualPointsCapped: capped,
    annualPointsStart,
    annualPointsEnd,
    annualPointsSlope: manual != null ? 0 : trend.slope,
    trendSampleSize: manual != null ? 0 : trend.sampleSize,
    outlierYear: annualPointsOutlier(entries, maxAnnualPoints),
    retirementYear,
    standardAge,
    accessFactor: factor,
    pensionValue,
    monthlyStatutory,
    monthlyEarned,
    monthlyPrivate,
    monthlyTotal,
    gap,
  };
}
