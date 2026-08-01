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

/**
 * Guaranteed income that starts LATER than the FIRE date -- the statutory
 * pension plus private policies, straight out of `projectPension`.
 *
 * This is the piece that makes the FIRE number honest for anyone who is not
 * self-employed. Someone retiring at 45 does not need to fund the rest of
 * their life from the portfolio: they need to fund it until the pension
 * starts, and after that only whatever the pension fails to cover. Ignoring it
 * overstates the target by a large multiple -- the same class of error as
 * planning the pension while ignoring the portfolio.
 */
export interface PensionBridge {
  /** Annual guaranteed income once it starts, base currency, today's money. */
  annualIncome: number;
  /** Years from TODAY until the first payment. */
  yearsUntilStart: number;
}

/** Present value of `amount` paid once a year for `years` years, discounted at
 *  `rate`. The withdrawal rate doubles as the discount rate on purpose: it is
 *  already this module's statement about what a portfolio sustainably earns. */
function annuityPresentValue(amount: number, years: number, rate: number): number {
  if (amount <= 0 || years <= 0) return 0;
  if (rate <= 0) return amount * years;
  return (amount * (1 - Math.pow(1 + rate, -years))) / rate;
}

/**
 * The FIRE number when a pension starts `bridgeYears` after you stop working.
 *
 * Two pieces, and they are the two phases of the plan:
 *   bridge     -- the portfolio alone funds the FULL expenses until the
 *                 pension starts
 *   perpetuity -- from then on it funds only what the pension leaves over,
 *                 discounted back to the FIRE date
 *
 * With no pension (or one already flowing and covering everything) this
 * collapses to `annualExpenses / withdrawalRate`, i.e. exactly `fireNumber`.
 */
export function fireNumberWithPension(
  annualExpenses: number,
  withdrawalRate: number,
  pensionAnnual: number,
  bridgeYears: number,
): number {
  if (withdrawalRate <= 0) return Infinity;
  const expenses = Math.max(0, annualExpenses);
  const pension = Math.max(0, pensionAnnual);
  if (pension <= 0) return expenses / withdrawalRate;
  const bridge = Math.max(0, bridgeYears);
  const residual = Math.max(0, expenses - pension);
  const discount = Math.pow(1 + withdrawalRate, -bridge);
  return (
    annuityPresentValue(expenses, bridge, withdrawalRate) + (residual / withdrawalRate) * discount
  );
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
  /** Annual pension income folded in, or 0 when none was supplied. */
  pensionAnnual: number;
  /** Years the portfolio must carry the FULL expenses alone before the pension
   *  starts, for the regular target. 0 without a pension. */
  bridgeYears: number;
  /** The regular target IGNORING the pension, so the page can say what
   *  accounting for it is worth. Equals `regular` when there is none. */
  regularWithoutPension: number;
}

/** How many times to chase the fixed point below. It converges in two or three
    -- a lower target retires you sooner, which lengthens the bridge, which
    raises the target again, by less each time. */
const BRIDGE_ITERATIONS = 8;

/**
 * The target and the date it is reached, solved together.
 *
 * They depend on each other: the capital needed depends on how long the
 * portfolio has to carry the expenses alone, and that depends on when you stop
 * working, which depends on the capital needed. So this starts from the
 * pension-free target and iterates until the answer stops moving.
 */
function solveTarget(
  currentNetWorth: number,
  annualExpenses: number,
  monthlyContribution: number,
  annualReturnRate: number,
  withdrawalRate: number,
  pension: PensionBridge | undefined,
): { target: number; years: number | null; bridgeYears: number } {
  const plain = fireNumber(annualExpenses, withdrawalRate);
  if (!pension || pension.annualIncome <= 0) {
    return {
      target: plain,
      years: yearsToFire(currentNetWorth, plain, monthlyContribution, annualReturnRate),
      bridgeYears: 0,
    };
  }

  let years = yearsToFire(currentNetWorth, plain, monthlyContribution, annualReturnRate) ?? 0;
  let target = plain;
  let bridgeYears = Math.max(0, pension.yearsUntilStart - years);

  for (let i = 0; i < BRIDGE_ITERATIONS; i++) {
    bridgeYears = Math.max(0, pension.yearsUntilStart - years);
    target = fireNumberWithPension(
      annualExpenses,
      withdrawalRate,
      pension.annualIncome,
      bridgeYears,
    );
    const next = yearsToFire(currentNetWorth, target, monthlyContribution, annualReturnRate);
    // Never reached: the bridge cannot be pinned down, so report the target
    // computed from the last usable estimate rather than a fabricated date.
    if (next === null) return { target, years: null, bridgeYears };
    if (Math.abs(next - years) < 0.01) {
      years = next;
      break;
    }
    years = next;
  }
  return { target, years, bridgeYears };
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
  /** Guaranteed later income. Omitted (or zero) reproduces the pension-free
   *  numbers exactly, so a user with no pension record sees no change. */
  pension?: PensionBridge,
): FirePlan {
  const solve = (expenses: number) =>
    solveTarget(
      currentNetWorth,
      expenses,
      monthlyContribution,
      annualReturnRate,
      withdrawalRate,
      pension,
    );
  // Lean and Fat scale the EXPENSES, not the target, so the pension is netted
  // against the budget each variant actually assumes -- a leaner budget is
  // covered by the same pension to a greater extent, which is the whole point.
  const regular = solve(annualExpenses);
  const lean = solve(annualExpenses * LEAN_FIRE_EXPENSE_RATIO);
  const fat = solve(annualExpenses * FAT_FIRE_EXPENSE_RATIO);

  return {
    regular: regular.target,
    lean: lean.target,
    fat: fat.target,
    yearsToRegular: regular.years,
    yearsToLean: lean.years,
    yearsToFat: fat.years,
    withdrawalRate,
    pensionAnnual: pension?.annualIncome ?? 0,
    bridgeYears: regular.bridgeYears,
    regularWithoutPension: fireNumber(annualExpenses, withdrawalRate),
  };
}
