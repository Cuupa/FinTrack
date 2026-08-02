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

import type {
  PensionContract,
  PensionContractValue,
  PensionPoint,
  PensionSettings,
  PensionStatement,
} from "../types";
import { xirr, type CashFlow } from "./irr";
import { addMonthsToDate } from "./dates";

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
 * Every Renteninformation on record, newest first.
 *
 * The legacy single "Gesamtstand" pair in the settings is folded in as one more
 * letter, so data entered before the list existed keeps working unchanged. A
 * listed statement for the same year wins: it is the newer input.
 */
export function allStatements(
  statements: readonly PensionStatement[],
  settings?: Pick<PensionSettings, "totalPoints" | "totalPointsYear">,
): PensionStatement[] {
  const rows = statements.filter((s) => Number.isFinite(s.totalPoints) && Number.isFinite(s.year));
  const legacyYear = settings?.totalPointsYear;
  const legacyTotal = settings?.totalPoints;
  if (legacyTotal != null && legacyYear != null && !rows.some((s) => s.year === legacyYear)) {
    rows.push({ year: legacyYear, totalPoints: legacyTotal, note: null });
  }
  return rows.sort((a, b) => b.year - a.year);
}

/** The most recent Renteninformation, or null when there is none. */
export function latestStatement(
  statements: readonly PensionStatement[],
  settings?: Pick<PensionSettings, "totalPoints" | "totalPointsYear">,
): PensionStatement | null {
  return allStatements(statements, settings)[0] ?? null;
}

/**
 * Entgeltpunkte earned to date.
 *
 * A Renteninformation states a CUMULATIVE total ("Sie haben bisher insgesamt
 * 13,2739 Entgeltpunkte erworben") and nothing per year -- the year-by-year
 * split only exists in the Versicherungsverlauf. So the newest letter's total
 * is the stock, and per-year rows are the optional detail: only the years AFTER
 * that letter add on top, the same way the next letter will count them.
 */
export function currentPensionPoints(
  entries: readonly PensionPoint[],
  statements: readonly PensionStatement[],
  settings?: Pick<PensionSettings, "totalPoints" | "totalPointsYear">,
): number {
  const latest = latestStatement(statements, settings);
  // A legacy total with no as-of year cannot be placed in time, so nothing can
  // be added on top of it -- but it is still the stock the user typed in, and
  // dropping it would quietly zero their entitlement.
  if (latest == null) {
    return settings?.totalPoints ?? totalPensionPoints(entries);
  }
  const after = entries.filter((e) => e.year > latest.year);
  return latest.totalPoints + totalPensionPoints(after);
}

/** The accrual rate two Renteninformationen imply, and the span it was measured
 *  over -- so the page can show its own arithmetic instead of one opaque rate. */
export interface StatementRate {
  /** Entgeltpunkte per year between the two letters. */
  points: number;
  /** The older letter's year. */
  fromYear: number;
  /** The newer letter's year. */
  toYear: number;
  /** Points accumulated between them. */
  gainedPoints: number;
}

/** The window the DRV itself averages over on the Renteninformation. */
const STATEMENT_WINDOW_YEARS = 5;

/**
 * Points per year, measured from the letters themselves.
 *
 * This is the ONLY per-year figure a Renteninformation contains, and it is
 * contained implicitly: two letters, a difference in total points, the years
 * between them. Deriving it is arithmetic on the user's own documents; asking
 * for a per-year value instead asks for a number the letter does not print.
 *
 * The older letter is chosen to mirror the DRV's own five-year window: the
 * shortest span that reaches five years, so the rate is an average over a
 * comparable stretch rather than one noisy year. When no pair reaches five
 * years the widest available span is used -- more data beats less. Null with
 * fewer than two letters, or when the totals go backwards: a cumulative total
 * can only grow, so that is a typo, not a rate.
 */
export function statementAnnualPoints(
  statements: readonly PensionStatement[],
  settings?: Pick<PensionSettings, "totalPoints" | "totalPointsYear">,
): StatementRate | null {
  const rows = allStatements(statements, settings);
  if (rows.length < 2) return null;
  const newest = rows[0];
  const older = rows.slice(1);
  const wideEnough = older.filter((s) => newest.year - s.year >= STATEMENT_WINDOW_YEARS);
  // Shortest span that still covers the window, else the widest span there is.
  const pick = wideEnough.length > 0 ? wideEnough[0] : older[older.length - 1];
  const years = newest.year - pick.year;
  const gained = newest.totalPoints - pick.totalPoints;
  if (years <= 0 || gained < 0) return null;
  return { points: gained / years, fromYear: pick.year, toYear: newest.year, gainedPoints: gained };
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

/**
 * Whether the per-year rows are in fact cumulative totals from several
 * Renteninformationen, typed into the only table that existed for them.
 *
 * Two signatures together, because either alone has honest explanations: the
 * values never go DOWN across the years (a real career has weaker years), and
 * the newest one is above what a single year can physically earn. Reported to
 * the user as an offer to move them, never acted on silently -- they are the
 * user's rows and only they can say what they meant.
 */
export function looksLikeStatements(
  entries: readonly PensionPoint[],
  maxPoints: number | null,
): boolean {
  const sorted = [...entries]
    .filter((e) => Number.isFinite(e.points))
    .sort((a, b) => a.year - b.year);
  if (sorted.length < 2) return false;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].points < sorted[i - 1].points) return false;
  }
  const cap = maxPoints ?? typicalAnnualPoints(sorted, sorted.length) * OUTLIER_FACTOR;
  if (!(cap > 0)) return false;
  return sorted[sorted.length - 1].points > cap;
}

/** The capital a Rentenfaktor is quoted against: monthly pension per 10.000 of
 *  capital, the convention every German policy prints. */
export const RENTENFAKTOR_BASE = 10000;

/** What a private policy is worth, and how it got there -- so the page can show
 *  the arithmetic instead of one derived number nobody can check. */
export interface ContractProjection {
  /** Capital at the start of the payout, in today's money. */
  capital: number;
  /** Monthly pension: `capital / 10.000 x Rentenfaktor`, or the typed figure
   *  when the policy states no Rentenfaktor. */
  monthly: number;
  /** True when `monthly` follows from the Rentenfaktor rather than being typed. */
  derived: boolean;
  /** Premiums still to be paid, summed with the Dynamik applied. */
  contributionsToCome: number;
  /** Years of premiums left before the payout starts. */
  yearsToPayout: number;
}

/**
 * What a private Rentenversicherung will pay, from how it actually works.
 *
 * A policy does not state a monthly pension: it states a RENTENFAKTOR -- so
 * much monthly pension per 10.000 of capital at the start of the payout. The
 * payout is therefore the end of a chain: today's value, plus the premiums
 * still to come (raised every year by the Beitragsdynamik if the policy has
 * one), grown at the assumed return, times the factor. Asking the user for the
 * monthly figure instead asks them to do that arithmetic in their head, and to
 * redo it whenever they change a premium.
 *
 * Premiums count as paid mid-year (the half-year convention), which is what a
 * monthly premium averages out to and avoids crediting a full year of growth to
 * money that arrives in December. Everything is in today's money, like the rest
 * of this module: no inflation, no wage growth.
 *
 * With no Rentenfaktor the typed `expectedMonthlyPension` is returned unchanged
 * -- a policy whose factor the user does not have still belongs in the total.
 */
export function projectContract(
  contract: PensionContract,
  currentYear: number,
  /** Year the payout starts when the policy names no date of its own. */
  fallbackRetirementYear: number | null,
): ContractProjection {
  const startYear = contract.startsOn
    ? Number(contract.startsOn.slice(0, 4))
    : fallbackRetirementYear;
  const yearsToPayout =
    startYear != null && Number.isFinite(startYear) ? Math.max(0, startYear - currentYear) : 0;

  const rate = (contract.expectedReturnPct ?? 0) / 100;
  const dynamic = (contract.contributionDynamicPct ?? 0) / 100;

  let capital = contract.currentValue ?? 0;
  let annualPremium = (contract.monthlyContribution ?? 0) * 12;
  let contributionsToCome = 0;
  for (let i = 0; i < yearsToPayout; i++) {
    capital = capital * (1 + rate) + annualPremium * (1 + rate / 2);
    contributionsToCome += annualPremium;
    annualPremium *= 1 + dynamic;
  }

  const factor = contract.rentenfaktor;
  const derived = factor != null && Number.isFinite(factor) && factor > 0;
  return {
    capital,
    monthly: derived
      ? (capital / RENTENFAKTOR_BASE) * factor
      : (contract.expectedMonthlyPension ?? 0),
    derived,
    contributionsToCome,
    yearsToPayout,
  };
}

/** Shortest span two readings may be apart before their difference is
 *  annualised. Below it the annualisation multiplies a few weeks of noise into
 *  a headline rate -- the same reason a trend needs three years, not two. */
export const MIN_RETURN_SPAN_DAYS = 180;

const DAY_MS = 24 * 60 * 60 * 1000;

/** What the recorded readings say a policy actually earned, and what that
 *  measurement rests on -- so the page can show the subtraction rather than
 *  one derived percentage nobody can check. */
export interface ContractReturn {
  /** Annualised return in percent (money-weighted, XIRR over the premiums). */
  pct: number;
  from: PensionContractValue;
  to: PensionContractValue;
  /** Premiums the measurement charged between the two readings. */
  contributions: number;
  /** Whole days between the two readings. */
  spanDays: number;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / DAY_MS);
}

/**
 * Measures a policy's return from its recorded values: the oldest reading is
 * money put in, every monthly premium in between is money put in, and the
 * newest reading is what came out. That is exactly an XIRR, and it answers the
 * question the typed "expected return" only ever guessed at.
 *
 * Null when it cannot be measured honestly: fewer than two readings, a span
 * under {@link MIN_RETURN_SPAN_DAYS}, or flows a rate cannot be solved for.
 * Intermediate readings are not cash and therefore not flows -- they are kept
 * for the chart of the record, not for the arithmetic.
 */
export function contractReturn(
  contract: Pick<PensionContract, "id" | "monthlyContribution">,
  values: readonly PensionContractValue[],
): ContractReturn | null {
  const own = values
    .filter((v) => v.contractId === contract.id && Number.isFinite(v.value))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (own.length < 2) return null;

  const from = own[0];
  const to = own[own.length - 1];
  const spanDays = daysBetween(from.date, to.date);
  if (spanDays < MIN_RETURN_SPAN_DAYS) return null;

  const premium = contract.monthlyContribution ?? 0;
  const flows: CashFlow[] = [{ amount: -from.value, date: from.date }];
  let contributions = 0;
  if (premium > 0) {
    for (let k = 1; ; k++) {
      const date = addMonthsToDate(from.date, k);
      if (date > to.date) break;
      flows.push({ amount: -premium, date });
      contributions += premium;
    }
  }
  flows.push({ amount: to.value, date: to.date });

  const rate = xirr(flows);
  if (rate == null || !Number.isFinite(rate)) return null;
  return { pct: rate * 100, from, to, contributions, spanDays };
}

/**
 * The policy as the projection should read it. Two substitutions, both because
 * a dated record beats a field typed once and never revisited:
 *
 * - the newest reading IS the capital, so `currentValue` follows the record;
 * - a MEASURED return fills in for the assumed one, but never overrides it --
 *   a typed figure is the user's own assumption about the future and wins,
 *   the same rule `annualPoints` follows against the fitted trend.
 *
 * With no readings the contract is returned unchanged, so everything entered
 * before this existed keeps projecting exactly as it did.
 */
export function resolveContract(
  contract: PensionContract,
  values: readonly PensionContractValue[],
): PensionContract {
  const own = values.filter((v) => v.contractId === contract.id);
  if (own.length === 0) return contract;
  const latest = own.reduce((a, b) => (b.date > a.date ? b : a));
  const measured = contract.expectedReturnPct == null ? contractReturn(contract, values) : null;
  return {
    ...contract,
    currentValue: latest.value,
    expectedReturnPct: measured ? measured.pct : contract.expectedReturnPct,
  };
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
  /** How many recorded years a trend could rest on. */
  trendSampleSize: number;
  /** True when following the record's trend is on offer at all. */
  trendAvailable: boolean;
  /** The rate measured between two Renteninformationen, or null when fewer
   *  than two are on record. Surfaced so the page can show the subtraction the
   *  assumption rests on. */
  statementRate: StatementRate | null;
  /** The newest Renteninformation the points-so-far figure rests on. */
  latestStatement: PensionStatement | null;
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
  /** The Renteninformationen. Omitted reproduces the pre-list behaviour. */
  statements?: readonly PensionStatement[];
  contracts: readonly PensionContract[];
  /** Recorded policy values. Omitted keeps every contract exactly as typed. */
  contractValues?: readonly PensionContractValue[];
  reference: readonly PensionReference[];
  settings: PensionSettings;
  currentYear: number;
}): PensionProjection {
  const { entries, reference, settings, currentYear } = input;
  const contractValues = input.contractValues ?? [];
  const contracts = input.contracts.map((c) => resolveContract(c, contractValues));
  const statements = input.statements ?? [];
  const currentPoints = currentPensionPoints(entries, statements, settings);
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
  const usable = plausibleEntries(entries, maxAnnualPoints);
  const trend = pointsTrend(entries, maxAnnualPoints);
  // THE DEFAULT IS THE DRV'S OWN METHOD: "wenn Sie so weitermachen wie bisher"
  // carries the flat average of the last five years forward and assumes NO
  // career progression. That is the figure printed on the Renteninformation,
  // so it has to be the figure this page reproduces -- a projection the user
  // cannot reconcile with their own letter is worthless however well argued.
  // Assuming a rising career on top of it overstated the pension by about 12
  // points, i.e. ~490 EUR a month (reported 2026-08).
  // ... and when the user only has their letters, "wie bisher" is measured
  // BETWEEN two of them: the letter prints no per-year figure at all, so the
  // difference in totals over the years between is the only honest reading of
  // the same sentence. It beats the per-year rows when both exist, because
  // those rows are typically a partial Versicherungsverlauf while the totals
  // cover the whole record.
  const rate = statementAnnualPoints(statements, settings);
  const flatAssumption = rate?.points ?? averageAnnualPoints(usable, 5);
  const useTrend = settings.assumeTrend === true && rate == null && trend.slope !== 0;
  const yearsLeft = retirementYear != null ? Math.max(0, retirementYear - currentYear) : 0;

  // A typed assumption is one number, so it is held flat: the user said what
  // they expect per year and the app does not then argue with a trend.
  const manual = settings.annualPoints;
  const rawAnnualPoints = manual ?? (useTrend ? trend.base : flatAssumption);

  // A ceiling for the fitted trend when there is no Beitragsbemessungsgrenze to
  // clamp against. A three-year slope carried thirty years is an extrapolation
  // well past what the sample supports, and Entgeltpunkte are a RATIO to the
  // national average wage -- earning twice the average every year for the rest
  // of a career is already the extreme end.
  //
  // It is measured against the assumption ACTUALLY in force, not against the
  // per-year trend alone: with the assumption coming from the letters there are
  // no per-year rows at all, so a trend-derived ceiling is 0 and would clamp
  // every remaining year to nothing.
  const trendCeiling = maxAnnualPoints ?? Math.max(rawAnnualPoints, trend.base) * 2;

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
    const raw =
      manual ?? (useTrend ? trend.base + trend.slope * advanced : flatAssumption);
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
  // A policy with a Rentenfaktor is projected from its capital; one without
  // contributes the payout the user typed.
  const monthlyPrivate = contracts.reduce(
    (s, c) => s + projectContract(c, currentYear, retirementYear).monthly,
    0,
  );
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
    annualPointsSlope: useTrend && manual == null ? trend.slope : 0,
    trendSampleSize: trend.sampleSize,
    // Whether following the record's trend is even on offer: it needs three
    // plausible years and a slope that is not flat. Two letters already carry
    // the average of everything between them, so there is nothing to fit.
    trendAvailable: manual == null && rate == null && trend.slope !== 0,
    statementRate: rate,
    latestStatement: latestStatement(statements, settings),
    // A per-year row above the Beitragsbemessungsgrenze is only worth reporting
    // while those rows still drive something.
    outlierYear: rate == null ? annualPointsOutlier(entries, maxAnnualPoints) : null,
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
