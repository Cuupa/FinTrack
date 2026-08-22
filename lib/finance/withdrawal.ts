// Decumulation: how much you actually take out each year, and what a bad
// sequence of returns does to that. Pure, no React, no lib/server imports --
// this runs inside the Monte Carlo worker.
//
// The simulation used to know exactly one answer: a fixed percentage of the
// portfolio's value on the day you retire, drawn unchanged forever. That is
// the 4% rule, and it is the only strategy nobody actually follows -- it
// ignores the portfolio entirely once retirement starts, so it either leaves a
// fortune untouched or runs dry while the retiree watches it happen.
//
// The strategies below are the real alternatives, and the point of having them
// side by side is that they trade the SAME risk against each other: a strategy
// that never depletes pays for it with an income that swings, and a strategy
// that guarantees the income pays for it with depletion risk. Neither is
// "better", which is why the UI compares them rather than recommending one.
//
// Sequence-of-returns risk is the other half. Two portfolios with identical
// average returns end in completely different places if one of them takes its
// losses early, because withdrawals lock those losses in. An average is not a
// plan, so the stress scenarios force the bad ordering instead of waiting for
// the random draw to produce it.

/** How the annual withdrawal is decided each year of retirement. */
export type WithdrawalStrategyId =
  | "fixed"
  | "percentOfPortfolio"
  | "guardrails"
  | "floorCeiling"
  | "vpw"
  | "vanguard";

export const WITHDRAWAL_STRATEGIES: WithdrawalStrategyId[] = [
  "fixed",
  "percentOfPortfolio",
  "guardrails",
  "floorCeiling",
  "vpw",
  "vanguard",
];

/** Inflation assumed when the caller states none. Withdrawals that never rise
    are not a plan: 30 years at 2% halves what the same amount buys. */
export const DEFAULT_INFLATION = 0.02;

/** The classic Guyton-Klinger band: adjust once the current rate has drifted
    this far from the target, in either direction. */
export const DEFAULT_GUARDRAIL_BAND = 0.2;
/** How much the income moves when a guardrail is hit. */
export const DEFAULT_GUARDRAIL_ADJUST = 0.1;
/** Floor/ceiling defaults, relative to the first retirement year's income. */
export const DEFAULT_FLOOR = 0.85;
export const DEFAULT_CEILING = 1.25;

/** Vanguard's own published defaults for the dynamic spending rule (AAII,
    citing Vanguard's "Dynamic Spending: A Better Way to Budget in
    Retirement"): a 5% ceiling and a 2.5% floor gave an 85% portfolio survival
    rate over a 35-year horizon in their study. Unlike `DEFAULT_FLOOR`/
    `DEFAULT_CEILING` above, these are YEAR-OVER-YEAR deltas, not absolute
    fractions of year one. */
export const DEFAULT_VANGUARD_CEILING = 0.05;
export const DEFAULT_VANGUARD_FLOOR = 0.025;

export interface WithdrawalPlan {
  strategy: WithdrawalStrategyId;
  /** Target annual rate as a fraction (0.04 = 4%), applied to the portfolio's
      value at retirement to set the first year's income. */
  rate: number;
  /** `guardrails`: drift allowed before the income is adjusted. */
  band?: number;
  /** `guardrails`: size of that adjustment. */
  adjust?: number;
  /** `floorCeiling`: bounds relative to the first year's income. */
  floor?: number;
  ceiling?: number;
  /** `vanguard`: bounds relative to LAST year's actual withdrawal, as a
      fraction (0.05 = 5%) -- see the strategy's own doc below. */
  vanguardCeiling?: number;
  vanguardFloor?: number;
  /** Annual inflation as a fraction. Every strategy that carries an amount
      forward raises it by this, because the 4% rule is an INFLATION-ADJUSTED
      rule: holding the first year's euros flat for 30 years quietly cuts the
      real income in half and calls the plan a success. */
  inflation?: number;
  /** `vpw`: the return assumption its annuity factor is computed at. */
  expectedReturn?: number;
}

export interface WithdrawalContext {
  /** rate x portfolio value on the day of retirement -- the first year's income
      and, for `floorCeiling`, the anchor the bounds are relative to. */
  initialWithdrawal: number;
  /** Portfolio value at the start of the year being decided. */
  portfolioValue: number;
  /** What was withdrawn in the year just ended. */
  previousWithdrawal: number;
  /** 0 for the first retirement year. */
  yearsIntoRetirement: number;
  /** Retirement years still to fund, including this one. `vpw` spreads the
      portfolio over exactly these. */
  yearsRemaining: number;
}

/**
 * The annual withdrawal for the coming year. Called once per simulated
 * retirement year, so a strategy can react to what the portfolio just did.
 *
 * A depleted portfolio pays nothing: every strategy returns 0 rather than a
 * notional amount that cannot be drawn.
 */
export function annualWithdrawal(plan: WithdrawalPlan, ctx: WithdrawalContext): number {
  if (ctx.portfolioValue <= 0) return 0;
  const inflation = plan.inflation ?? DEFAULT_INFLATION;
  // What the first year's income has to become to buy the same basket now.
  const indexed = (amount: number) =>
    amount * Math.pow(1 + inflation, ctx.yearsIntoRetirement);
  // The first year is the target rate under every strategy -- they differ in
  // what happens NEXT, not in where they start.
  if (ctx.yearsIntoRetirement === 0) return Math.max(0, ctx.initialWithdrawal);

  switch (plan.strategy) {
    case "fixed":
      return Math.max(0, indexed(ctx.initialWithdrawal));

    // Always the same slice of what is actually there. Mathematically it can
    // never deplete the portfolio; the price is that the income follows the
    // market down with no floor under it.
    case "percentOfPortfolio":
      return Math.max(0, plan.rate * ctx.portfolioValue);

    // Percent-of-portfolio with the swing clipped: the income tracks the
    // portfolio but is never allowed below `floor` or above `ceiling` of the
    // first year's. Depletion becomes possible again, because the floor keeps
    // paying out of a shrinking pot -- that is the trade, stated plainly.
    case "floorCeiling": {
      const floor = (plan.floor ?? DEFAULT_FLOOR) * indexed(ctx.initialWithdrawal);
      const ceiling = (plan.ceiling ?? DEFAULT_CEILING) * indexed(ctx.initialWithdrawal);
      const target = plan.rate * ctx.portfolioValue;
      return Math.max(0, Math.min(ceiling, Math.max(floor, target)));
    }

    // Vanguard's dynamic spending rule: the same percent-of-CURRENT-portfolio
    // base as `floorCeiling`, but the band is anchored to what was actually
    // paid LAST year, not to year one. A `floorCeiling` band never moves from
    // its year-one anchor; this one resets every year, so spending can drift
    // far from year one across a long retirement instead of snapping back
    // toward it. No separate inflation step on the anchor -- the cited source
    // applies the ceiling/floor percentages directly to last year's nominal
    // payout, inflation reaches this strategy only through the portfolio's
    // own (nominal) growth. Source: AAII, citing Vanguard's own paper --
    // worked example: $1M portfolio, 4% -> $40,000 year one; year two at
    // 4% x $1.06M = $42,400 base, but the ceiling ($40,000 x 1.05 = $42,000)
    // clamps it to $42,000.
    case "vanguard": {
      const ceilingPct = plan.vanguardCeiling ?? DEFAULT_VANGUARD_CEILING;
      const floorPct = plan.vanguardFloor ?? DEFAULT_VANGUARD_FLOOR;
      const anchor = Math.max(0, ctx.previousWithdrawal);
      const target = plan.rate * ctx.portfolioValue;
      const ceiling = anchor * (1 + ceilingPct);
      const floor = anchor * (1 - floorPct);
      return Math.max(0, Math.min(ceiling, Math.max(floor, target)));
    }

    // Guyton-Klinger: keep last year's income unless the portfolio has moved
    // far enough that the CURRENT rate has drifted outside the band, then step
    // the income by `adjust`. Small, infrequent changes rather than an income
    // that moves every single year.
    case "guardrails": {
      const band = plan.band ?? DEFAULT_GUARDRAIL_BAND;
      const adjust = plan.adjust ?? DEFAULT_GUARDRAIL_ADJUST;
      // Guyton-Klinger raises last year's income with inflation FIRST, then
      // asks whether the guardrails were breached.
      const previous = Math.max(0, ctx.previousWithdrawal) * (1 + inflation);
      const currentRate = previous / ctx.portfolioValue;
      if (currentRate > plan.rate * (1 + band)) return previous * (1 - adjust);
      if (currentRate < plan.rate * (1 - band)) return previous * (1 + adjust);
      return previous;
    }

    // Variable percentage withdrawal: spread what is actually there over the
    // years actually left, as an annuity at the expected return. The rate
    // therefore RISES with age (a 90-year-old funding five years may draw far
    // more than 4%), which is the honest answer to "how much can I take" and
    // the reason a flat rate leaves so many people dying rich. It cannot
    // deplete the portfolio; the price is an income that moves with the market.
    case "vpw": {
      const n = Math.max(1, Math.round(ctx.yearsRemaining));
      const r = plan.expectedReturn ?? 0;
      const factor = r <= 0 ? 1 / n : r / (1 - Math.pow(1 + r, -n));
      return Math.max(0, ctx.portfolioValue * factor);
    }
  }
}

// --- Sequence-of-returns stress ---------------------------------------------

/**
 * A forced bad ordering of returns, applied from the run's ANCHOR month.
 *
 * The anchor is the first month of decumulation when the run has one, because
 * that is where the ordering of returns stops being cosmetic and starts
 * destroying capital. A run that only accumulates has no such month, and the
 * scenarios used to do nothing at all there -- so the anchor falls back to
 * month zero and a crash right after you invest is simulated too, which is the
 * risk anyone still saving actually carries.
 */
export type StressScenario = "none" | "earlyCrash" | "lostDecade" | "highInflation";

export const STRESS_SCENARIOS: StressScenario[] = [
  "none",
  "earlyCrash",
  "lostDecade",
  "highInflation",
];

/** A crash of this size in the anchor month. */
export const EARLY_CRASH_DROP = 0.35;
/** How long the "lost decade" suppresses the drift. */
export const LOST_DECADE_YEARS = 10;
/** Percentage points of extra inflation the inflation shock assumes -- taken
    off the real return AND added to what the withdrawals have to rise by. */
export const HIGH_INFLATION_EXTRA = 0.03;

/** Extra annual inflation the scenario forces on the withdrawals. */
export function stressInflation(scenario: StressScenario): number {
  return scenario === "highInflation" ? HIGH_INFLATION_EXTRA : 0;
}

/**
 * Adjusts one month's return for the chosen scenario.
 *
 * `monthsFromAnchor` is 0 in the anchor month and negative before it.
 *
 * `monthlyDrift` is the simulation's geometric monthly mean, subtracted out for
 * the lost decade so those years have no expected growth at all rather than an
 * arbitrary negative number.
 */
export function stressedReturn(
  scenario: StressScenario,
  monthReturn: number,
  monthsFromAnchor: number,
  monthlyDrift: number,
): number {
  if (scenario === "none" || monthsFromAnchor < 0) return monthReturn;
  if (scenario === "earlyCrash") {
    return monthsFromAnchor === 0 ? monthReturn - EARLY_CRASH_DROP : monthReturn;
  }
  if (scenario === "highInflation") {
    // Inflation eats the real return for the rest of the run, not for a window:
    // a price level does not come back down.
    return monthReturn - HIGH_INFLATION_EXTRA / 12;
  }
  return monthsFromAnchor < LOST_DECADE_YEARS * 12 ? monthReturn - monthlyDrift : monthReturn;
}

// --- Comparing strategies ----------------------------------------------------

/** What one strategy did, across every run of a simulation. */
export interface StrategyOutcome {
  strategy: WithdrawalStrategyId;
  /** Share of runs whose portfolio never hit zero, as a fraction. */
  successRate: number;
  /** Median annual income across every run and every retirement year. */
  medianIncome: number;
  /** Median across runs of that run's WORST year -- the income you have to be
      able to live on, which an average conceals. */
  medianWorstYearIncome: number;
  /** Median total drawn over the whole retirement. */
  medianTotalIncome: number;
  /** Median portfolio value left at the end. */
  medianEndValue: number;
}

/** Per-run figures the comparison reduces. Collected by the simulation. */
export interface StrategyRunTally {
  incomes: number[];
  endValue: number;
  depleted: boolean;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Reduce per-run tallies into the comparison row for one strategy.
 *
 * Reported as medians rather than means throughout: a handful of runs where a
 * percent-of-portfolio strategy rides a bull market to an enormous income drags
 * a mean far away from anything a retiree would experience.
 */
export function summarizeStrategy(
  strategy: WithdrawalStrategyId,
  runs: readonly StrategyRunTally[],
): StrategyOutcome {
  if (runs.length === 0) {
    return {
      strategy,
      successRate: 0,
      medianIncome: 0,
      medianWorstYearIncome: 0,
      medianTotalIncome: 0,
      medianEndValue: 0,
    };
  }
  const everyIncome: number[] = [];
  const worstYears: number[] = [];
  const totals: number[] = [];
  const endValues: number[] = [];
  let survived = 0;
  for (const run of runs) {
    for (const income of run.incomes) everyIncome.push(income);
    worstYears.push(run.incomes.length > 0 ? Math.min(...run.incomes) : 0);
    totals.push(run.incomes.reduce((s, x) => s + x, 0));
    endValues.push(run.endValue);
    if (!run.depleted) survived++;
  }
  return {
    strategy,
    successRate: survived / runs.length,
    medianIncome: median(everyIncome),
    medianWorstYearIncome: median(worstYears),
    medianTotalIncome: median(totals),
    medianEndValue: median(endValues),
  };
}
