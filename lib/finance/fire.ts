// Retirement / FIRE planner (ROADMAP item #8, flag `firePlanner`) -- pure, no
// React, no lib/server imports. Reframes two ALREADY-EXISTING engines as a
// goal rather than a free-form projection:
//   - lib/finance/monte-carlo.ts already supports a withdrawal PHASE driven
//     by a withdrawal RATE (the classic "4% rule") -- this module supplies
//     the deterministic goal math the UI seeds that worker call with.
//   - lib/finance/stats.ts already measures expected return/volatility from
//     the user's real historical holdings (benchmark fallback) -- the UI
//     feeds that into `computeFirePlan` instead of a hardcoded assumption.
// The full-distribution Monte Carlo run itself stays a worker call driven
// from the component (ROADMAP's "keep it in the worker"); this module only
// holds the deterministic, instant-feedback goal math (FIRE number,
// years-to-FI) plus the trailing-expense figure it's derived from.

import type { SpendingTransaction } from "../types";
import { byCategoryAndMonth, incomeExpenseSplit } from "./spending";
import { shiftMonth } from "./dates";

/** Trailing window size for the expense average, in calendar months -- same
 *  convention as `computeFinancialHealth` (lib/finance/health.ts). */
const TRAILING_MONTHS = 12;

/**
 * Trailing-12-month annualised expense magnitude from spending transactions.
 * Mirrors `computeFinancialHealth`'s windowing exactly (duplicated rather
 * than imported -- same precedent as `HealthValuation`/`GoalValuation` in
 * health.ts/goals.ts): the denominator is the number of DISTINCT months that
 * actually have a transaction in the window (capped at 12, floored at 1)
 * rather than a flat 12, so a brand-new user's one month of history isn't
 * diluted toward zero by eleven empty months they haven't lived through yet.
 * Reuses the exported `byCategoryAndMonth`/`incomeExpenseSplit` pure
 * primitives from spending.ts rather than re-deriving the income/expense
 * split.
 */
export function trailingAnnualExpenses(
  spendingTransactions: SpendingTransaction[],
  todayIso: string,
): number {
  const currentMonth = todayIso.slice(0, 7);
  const startMonth = shiftMonth(currentMonth, -(TRAILING_MONTHS - 1));
  const windowed = spendingTransactions.filter((t) => {
    const m = t.date.slice(0, 7);
    return m >= startMonth && m <= currentMonth;
  });
  const monthTotals = byCategoryAndMonth(windowed);
  const distinctMonths = new Set(monthTotals.map((m) => m.month)).size;
  const denominator = Math.max(1, Math.min(TRAILING_MONTHS, distinctMonths));
  const { expense } = incomeExpenseSplit(windowed);
  return (expense / denominator) * 12;
}

/**
 * The classic "safe withdrawal rate" FIRE number: how large a portfolio, at
 * `withdrawalRate` (a fraction, e.g. 0.04 for the "4% rule"), sustains
 * `annualExpenses` indefinitely -- the familiar "25x expenses" result falls
 * straight out of `1 / 0.04`. A zero/negative rate has no finite answer (an
 * infinite portfolio would be needed), so this returns `Infinity` rather
 * than dividing by zero -- callers should treat a non-finite result as "not
 * computable at this rate" (see the UI's guard).
 */
export function fireNumber(annualExpenses: number, withdrawalRate: number): number {
  if (withdrawalRate <= 0) return Infinity;
  return Math.max(0, annualExpenses) / withdrawalRate;
}

// FIRE-community convention multipliers applied to annual expenses BEFORE
// dividing by the withdrawal rate (so a more conservative rate scales every
// target up together): "Lean FIRE" targets a stripped-down budget, commonly
// cited around 70% of current spend; "Fat FIRE" targets a more comfortable
// one, commonly cited around 130%. These are the widely-used community
// reference ratios, not an arbitrary guess.
export const LEAN_FIRE_EXPENSE_RATIO = 0.7;
export const FAT_FIRE_EXPENSE_RATIO = 1.3;

/** Lean FIRE number: `fireNumber` on a reduced (`LEAN_FIRE_EXPENSE_RATIO`) expense base. */
export function leanFireNumber(annualExpenses: number, withdrawalRate: number): number {
  return fireNumber(annualExpenses * LEAN_FIRE_EXPENSE_RATIO, withdrawalRate);
}

/** Fat FIRE number: `fireNumber` on an increased (`FAT_FIRE_EXPENSE_RATIO`) expense base. */
export function fatFireNumber(annualExpenses: number, withdrawalRate: number): number {
  return fireNumber(annualExpenses * FAT_FIRE_EXPENSE_RATIO, withdrawalRate);
}

/** Iteration cap for `yearsToFire` -- 100 years of monthly compounding, so the
 *  loop is always bounded rather than running unbounded when the target is
 *  never reached. */
const MAX_MONTHS_TO_FIRE = 1200;

/**
 * Deterministic (non-Monte-Carlo) compound-growth projection: how many years
 * of `annualReturnRate` growth plus `monthlyContribution` savings until
 * `currentNetWorth` reaches `targetNumber`. This is the simple "will I get
 * there" answer the tiles show instantly; the worker-run Monte Carlo (see
 * the /fire UI) is the probabilistic complement that accounts for sequence-
 * of-returns risk.
 *
 * Returns:
 * - `0` when the target is already met (not `null` -- "0 years to go" is a
 *   real, valid answer, distinct from "never").
 * - `null` when `targetNumber` isn't finite (a 0%/negative withdrawal rate
 *   has no finite FIRE number) or the target is never reached within
 *   `MAX_MONTHS_TO_FIRE` (100 years) -- e.g. a non-positive contribution
 *   combined with a non-positive return.
 * - Otherwise the number of years (2 decimal places) as a monthly-compounded
 *   iterative loop, capped at 100 years so this never runs unbounded.
 */
export function yearsToFire(
  currentNetWorth: number,
  targetNumber: number,
  monthlyContribution: number,
  annualReturnRate: number,
): number | null {
  if (!Number.isFinite(targetNumber)) return null;
  if (currentNetWorth >= targetNumber) return 0;
  // Clamp to avoid NaN from Math.pow of a negative base to a fractional
  // power (a >= -100%/yr return is nonsensical anyway).
  const safeRate = Math.max(-0.99, annualReturnRate);
  const monthlyRate = Math.pow(1 + safeRate, 1 / 12) - 1;
  let value = currentNetWorth;
  for (let m = 1; m <= MAX_MONTHS_TO_FIRE; m++) {
    value = value * (1 + monthlyRate) + monthlyContribution;
    if (value >= targetNumber) return Math.round((m / 12) * 100) / 100;
  }
  return null;
}

export interface FirePlan {
  /** Regular FIRE number: annualExpenses / withdrawalRate. */
  regular: number;
  /** Lean FIRE number: reduced-expense variant. */
  lean: number;
  /** Fat FIRE number: increased-expense variant. */
  fat: number;
  yearsToRegular: number | null;
  yearsToLean: number | null;
  yearsToFat: number | null;
  /** The withdrawal rate (fraction) this plan was computed at, for display. */
  withdrawalRate: number;
}

/**
 * Single entry point mirroring `computeFinancialHealth`'s shape: takes the
 * primitives the UI already has in hand (current net worth, trailing annual
 * expenses from `trailingAnnualExpenses`, a monthly contribution estimate,
 * the measured annual return from `stats.ts`, and the chosen withdrawal
 * rate) and returns the three FIRE targets plus a deterministic years-to-FI
 * for each.
 */
export function computeFirePlan(
  currentNetWorth: number,
  annualExpenses: number,
  monthlyContribution: number,
  annualReturnRate: number,
  withdrawalRate: number,
): FirePlan {
  const regular = fireNumber(annualExpenses, withdrawalRate);
  const lean = leanFireNumber(annualExpenses, withdrawalRate);
  const fat = fatFireNumber(annualExpenses, withdrawalRate);
  return {
    regular,
    lean,
    fat,
    yearsToRegular: yearsToFire(currentNetWorth, regular, monthlyContribution, annualReturnRate),
    yearsToLean: yearsToFire(currentNetWorth, lean, monthlyContribution, annualReturnRate),
    yearsToFat: yearsToFire(currentNetWorth, fat, monthlyContribution, annualReturnRate),
    withdrawalRate,
  };
}
