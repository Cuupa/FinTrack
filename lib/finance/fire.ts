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
import { runMonteCarlo } from "./monte-carlo";
import {
  planToFireAssumption,
  planToWithdrawalOptions,
  type WithdrawalPlan,
} from "./withdrawal-plan";

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

/**
 * The `fixedRealAmount` strategy's target: how large a portfolio, growing at
 * `nominalReturn`, sustains a withdrawal of `annualAmount` forever, where
 * that withdrawal itself rises with `inflation` each year (or stays flat
 * when `inflation` is 0). This is the standard growing-perpetuity discount
 * rate -- the rate at which the portfolio outgrows the withdrawal's own
 * escalation -- not the withdrawal RATE `fireNumber` divides by, because a
 * fixed-amount plan states no rate. A non-positive real return has no
 * finite answer (the withdrawal grows at least as fast as the portfolio).
 */
export function realReturn(nominalReturn: number, inflation: number): number {
  return (1 + nominalReturn) / (1 + Math.max(-0.99, inflation)) - 1;
}

/** `fireNumber`'s counterpart for a stated amount instead of a rate. */
export function fixedAmountFireNumber(annualAmount: number, discountRate: number): number {
  if (discountRate <= 0) return Infinity;
  return Math.max(0, annualAmount) / discountRate;
}

/** `fireNumberWithPension`'s counterpart for a stated amount instead of a
    rate, mirroring its bridge + perpetuity split exactly. */
export function fixedAmountFireNumberWithPension(
  annualAmount: number,
  discountRate: number,
  pensionAnnual: number,
  bridgeYears: number,
): number {
  if (discountRate <= 0) return Infinity;
  const amount = Math.max(0, annualAmount);
  const pension = Math.max(0, pensionAnnual);
  if (pension <= 0) return amount / discountRate;
  const bridge = Math.max(0, bridgeYears);
  const residual = Math.max(0, amount - pension);
  const discount = Math.pow(1 + discountRate, -bridge);
  return (
    annuityPresentValue(amount, bridge, discountRate) + (residual / discountRate) * discount
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

/**
 * The other half of a withdrawal rate: how often it runs out.
 *
 * A higher rate LOWERS the target (expenses / rate), which reads as nonsense
 * until the risk it buys is on screen next to it. So each target is retired
 * into straight away and drawn down at that same rate, and the share of runs
 * whose portfolio hits zero is reported beside the number.
 *
 * The same pure engine the simulator runs (`runMonteCarlo`), at a fraction of
 * the paths and a fixed seed: this is a figure that has to appear instantly
 * while a slider moves, and a risk that jitters on every render is a risk
 * nobody trusts. The full run with strategies, stress and a chart stays on
 * /simulation.
 */
const RISK_RUNS = 600;
const RISK_SEED = 0x5f1e;

export function shortfallRisk(input: {
  /** Capital retired into: the target this tile prints. */
  target: number;
  /** Measured expected return, fraction. */
  expectedReturn: number;
  /** Measured volatility, fraction. */
  volatility: number;
  /** The user's actual chosen plan -- the risk shown must match the
   *  strategy the plan is FOR, not a strategy hardcoded independently of
   *  it (a `percentOfPortfolio` plan cannot deplete the same way a `fixed`
   *  one can, and showing the `fixed` figure next to it would be wrong). */
  plan: WithdrawalPlan;
  /** Retirement length to test, years. */
  years?: number;
}): number | null {
  if (!Number.isFinite(input.target) || input.target <= 0) return null;
  const options = planToWithdrawalOptions(input.plan);
  const hasWithdrawal = (options.withdrawalRate ?? 0) > 0 || (options.fixedAnnualAmount ?? 0) > 0;
  if (!hasWithdrawal) return null;
  const result = runMonteCarlo({
    initialCapital: input.target,
    monthlyContribution: 0,
    // The engine always accumulates at least one month; starting AT the target
    // is what makes the risk comparable across the three tiles.
    years: 0,
    expectedReturn: input.expectedReturn,
    volatility: input.volatility,
    runs: RISK_RUNS,
    seed: RISK_SEED,
    withdrawalYears: input.years ?? RETIREMENT_YEARS,
    ...options,
  });
  const finals = result.finalDistribution;
  if (finals.length === 0) return null;
  return finals.filter((v) => v <= 0).length / finals.length;
}

/** The retirement length the risk is measured over -- the span the "4% rule"
    (Trinity study) was calibrated against. */
export const RETIREMENT_YEARS = 30;

export interface FirePlan {
  /** Regular FIRE number: annualExpenses / withdrawalRate (rate strategies),
   *  or the amount-based perpetuity target (`fixedRealAmount`). */
  regular: number;
  /** Lean FIRE number: reduced-need variant. */
  lean: number;
  /** Fat FIRE number: increased-need variant. */
  fat: number;
  yearsToRegular: number | null;
  yearsToLean: number | null;
  yearsToFat: number | null;
  /** The withdrawal rate (fraction) this plan was computed at, for display.
   *  0 for an amount-based (`fixedRealAmount`) plan -- it states no rate. */
  withdrawalRate: number;
  /** False when the target does not mean "this portfolio lasts forever" in
   *  the classic sense -- only `currentPortfolioShare` today, whose rate is
   *  re-evaluated against the CURRENT value every year rather than held to
   *  this target. The UI must show a caveat instead of the usual framing
   *  when this is false. */
  hasStableTarget: boolean;
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
 *
 * `targetFor` computes the perpetuity target for a given bridge length and
 * pension income -- callers supply either the rate-based formula
 * (`fireNumberWithPension`) or the amount-based one
 * (`fixedAmountFireNumberWithPension`), already closed over their own
 * rate/amount. The bridge iteration itself does not care which.
 */
function solveTarget(
  currentNetWorth: number,
  monthlyContribution: number,
  annualReturnRate: number,
  pension: PensionBridge | undefined,
  targetFor: (bridgeYears: number, pensionAnnual: number) => number,
): { target: number; years: number | null; bridgeYears: number } {
  const plain = targetFor(0, 0);
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
    target = targetFor(bridgeYears, pension.annualIncome);
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

/** Picks the perpetuity formula for a plan's assumption, closed over the
    return/inflation figures it needs -- the bridge iteration in
    `solveTarget` then only ever calls `(need, bridgeYears, pensionAnnual)`,
    unaware of which formula world it is in. */
function targetFormula(
  assumption: ReturnType<typeof planToFireAssumption>,
  annualReturnRate: number,
): (need: number, bridgeYears: number, pensionAnnual: number) => number {
  if (assumption.kind === "amountPerpetuity") {
    // Unindexed: a flat withdrawal is sustained by the plain nominal return.
    // Indexed: the withdrawal itself grows with inflation, so only the
    // REAL return (the growth ABOVE that escalation) funds it forever.
    const discountRate = assumption.inflationIndexed
      ? realReturn(annualReturnRate, assumption.assumedInflation)
      : annualReturnRate;
    return (need, bridgeYears, pensionAnnual) =>
      fixedAmountFireNumberWithPension(need, discountRate, pensionAnnual, bridgeYears);
  }
  return (need, bridgeYears, pensionAnnual) =>
    fireNumberWithPension(need, assumption.rate, pensionAnnual, bridgeYears);
}

/**
 * Single entry point mirroring `computeFinancialHealth`'s shape: takes the
 * primitives the UI already has in hand (current net worth, trailing annual
 * expenses from `trailingAnnualExpenses`, a monthly contribution estimate,
 * the measured annual return from `stats.ts`, and the chosen withdrawal
 * plan) and returns the three FIRE targets plus a deterministic years-to-FI
 * for each.
 *
 * Guaranteed income rides on `plan.guaranteedIncome` (not a separate
 * parameter): FIRE and the simulation must read the SAME plan for the SAME
 * pension figure, and a second parameter next to it is exactly the kind of
 * duplicate state that let the two pages drift before. Omitted (or zero)
 * reproduces the pension-free numbers exactly, so a user with no pension
 * record sees no change.
 */
export function computeFirePlan(
  currentNetWorth: number,
  annualExpenses: number,
  monthlyContribution: number,
  annualReturnRate: number,
  plan: WithdrawalPlan,
): FirePlan {
  const assumption = planToFireAssumption(plan);
  const formula = targetFormula(assumption, annualReturnRate);
  const pension: PensionBridge | undefined = plan.guaranteedIncome
    ? {
        annualIncome: plan.guaranteedIncome.annualAmount,
        yearsUntilStart: plan.guaranteedIncome.yearsUntilStart,
      }
    : undefined;
  // `fixedRealAmount` states its own need directly; every other strategy
  // scales the measured expenses -- the plan's rate applies to whatever
  // budget it is retiring into, lean/regular/fat included.
  const baseNeed =
    assumption.kind === "amountPerpetuity" ? assumption.annualAmount : annualExpenses;

  const solve = (need: number) =>
    solveTarget(currentNetWorth, monthlyContribution, annualReturnRate, pension, (bridgeYears, pensionAnnual) =>
      formula(need, bridgeYears, pensionAnnual),
    );
  // Lean and Fat scale the NEED, not the target, so the pension is netted
  // against the budget each variant actually assumes -- a leaner budget is
  // covered by the same pension to a greater extent, which is the whole point.
  const regular = solve(baseNeed);
  const lean = solve(baseNeed * LEAN_FIRE_EXPENSE_RATIO);
  const fat = solve(baseNeed * FAT_FIRE_EXPENSE_RATIO);

  return {
    regular: regular.target,
    lean: lean.target,
    fat: fat.target,
    yearsToRegular: regular.years,
    yearsToLean: lean.years,
    yearsToFat: fat.years,
    withdrawalRate: assumption.kind === "rate" ? assumption.rate : 0,
    hasStableTarget: assumption.kind === "rate" ? assumption.hasStableTarget : true,
    pensionAnnual: pension?.annualIncome ?? 0,
    bridgeYears: regular.bridgeYears,
    regularWithoutPension: formula(baseNeed, 0, 0),
  };
}
