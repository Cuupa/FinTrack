// Monte Carlo wealth-accumulation simulation (PRD §3.3).
//
// Pure and side-effect-free so it can run inside a Web Worker. Simulates
// monthly compounding with normally-distributed returns plus monthly
// contributions, then reduces many runs into percentile bands per year.
//
// Decumulation is delegated to `./withdrawal.ts`: which strategy decides the
// annual income, and whether a forced bad sequence of returns is applied. The
// strategy is asked once per retirement YEAR (not per month), because that is
// how the rules are actually stated and followed -- nobody recalculates their
// guardrails in March.

import {
  annualWithdrawal,
  stressedReturn,
  summarizeStrategy,
  WITHDRAWAL_STRATEGIES,
  type StrategyOutcome,
  type StrategyRunTally,
  stressInflation,
  DEFAULT_INFLATION,
  type StressScenario,
  type WithdrawalPlan,
  type WithdrawalStrategyId,
} from "./withdrawal";

/** The strategy knobs shared by both simulation entry points. */
export interface WithdrawalOptions {
  /** Absent = the historical behaviour: a fixed nominal amount set at
      retirement, i.e. the `fixed` strategy. */
  withdrawalStrategy?: WithdrawalStrategyId;
  guardrailBand?: number;
  guardrailAdjust?: number;
  floor?: number;
  ceiling?: number;
  /** Forced sequence-of-returns stress. Absent = "none". */
  stress?: StressScenario;
  /** Annual inflation the withdrawals are indexed to (fraction). Absent uses
      `DEFAULT_INFLATION`: an unindexed withdrawal is not a plan. */
  inflation?: number;
  /** Run EVERY strategy over the same market paths and report the comparison.
      Same seed, same draws, so the rows differ only by the strategy. */
  compareStrategies?: boolean;
  /** Annual guaranteed pension income, in today's nominal base currency. */
  annualPensionIncome?: number;
  /** Years from the start of accumulation until the pension begins. */
  pensionYearsUntilStart?: number;
  /** Monthly amount withdrawn during the decumulation phase (base currency),
      flat and UNindexed -- the legacy path, kept for backward compatibility.
      Lowest precedence of the three withdrawal inputs. */
  monthlyWithdrawal?: number;
  /**
   * Annual withdrawal RATE (fraction, e.g. 0.04 for 4%). When set, each run
   * withdraws a fixed nominal monthly amount of `rate × (that run's value at
   * retirement) / 12` — so the withdrawn amount scales with how the portfolio
   * actually grew. Takes precedence over `monthlyWithdrawal`.
   */
  withdrawalRate?: number;
  /**
   * A fixed ANNUAL amount (base currency, today's money) withdrawn in the
   * first retirement year, then carried forward inflation-indexed exactly
   * like `withdrawalStrategy: "fixed"`'s rate-derived amount -- the two
   * differ only in how year one is seeded (a stated amount vs. rate ×
   * portfolio value), not in how later years are indexed. Takes precedence
   * over `withdrawalRate` when both are set (mutually exclusive: an amount
   * plan states no rate). Distinct from `monthlyWithdrawal`, which stays a
   * flat, UNindexed amount for backward compatibility.
   */
  fixedAnnualAmount?: number;
}

export interface MonteCarloParams extends WithdrawalOptions {
  initialCapital: number;
  monthlyContribution: number;
  years: number;
  /** Expected average annual return, e.g. 0.07 for 7%. */
  expectedReturn: number;
  /** Annual volatility (standard deviation), e.g. 0.15. */
  volatility: number;
  /** Number of simulation runs (PRD requires >= 1000). */
  runs: number;
  /** Seed for the PRNG, so a run is reproducible/auditable. */
  seed: number;
  /** Optional decumulation phase after the `years` accumulation phase. */
  withdrawalYears?: number;
}

/** Distribution of the (per-run) annual withdrawal amount, when a rate is used. */
export interface WithdrawalSummary {
  /** Sorted annual withdrawal amounts across runs. */
  distribution: number[];
  p10: number;
  median: number;
  p90: number;
}

export interface YearBand {
  year: number;
  p10: number;
  p25: number;
  median: number;
  p75: number;
  p90: number;
  best: number;
  worst: number;
  mean: number;
  /** Total contributed by this year (initial + monthly), for reference. */
  contributed: number;
}

export interface MonteCarloResult {
  params: MonteCarloParams;
  bands: YearBand[];
  /** Sorted final-value distribution across all runs. */
  finalDistribution: number[];
  /** Present only when a decumulation phase used a withdrawal RATE. */
  withdrawal?: WithdrawalSummary;
  /** Every strategy over the SAME market paths. Present only when asked for. */
  strategyComparison?: StrategyOutcome[];
}

/** Reads the strategy knobs off the params, defaulting to today's behaviour. */
function planOf(
  params: WithdrawalOptions,
  /** Return assumption for `vpw`'s annuity factor. */
  expectedReturn: number,
): WithdrawalPlan {
  return {
    strategy: params.withdrawalStrategy ?? "fixed",
    rate: Math.max(0, params.withdrawalRate ?? 0),
    band: params.guardrailBand,
    adjust: params.guardrailAdjust,
    floor: params.floor,
    ceiling: params.ceiling,
    // The inflation shock raises what the same basket costs, so it lands on
    // the withdrawals as well as on the returns.
    inflation: (params.inflation ?? DEFAULT_INFLATION) + stressInflation(params.stress ?? "none"),
    expectedReturn,
  };
}

/** Deterministic, seedable PRNG (mulberry32) — reproducible runs for auditing. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

/** One run's outcome along an already-drawn path of monthly returns. */
interface PathWalk {
  /** Value at the end of each year 1..totalYears. */
  yearEnd: number[];
  final: number;
  /** Income drawn in each retirement year. */
  annualIncomes: number[];
  /** rate x value at retirement -- the first year's income. */
  initialWithdrawal: number;
  /** True when the portfolio hit zero during decumulation. */
  depleted: boolean;
}

interface WalkOptions
  extends Pick<WithdrawalOptions, "annualPensionIncome" | "pensionYearsUntilStart"> {
  initialCapital: number;
  monthlyContribution: number;
  accMonths: number;
  months: number;
  plan: WithdrawalPlan;
  flatWithdrawal: number;
  usesRate: boolean;
  /** A stated first-year amount instead of a rate; see `fixedAnnualAmount`
      on `WithdrawalOptions`. Mutually exclusive with `usesRate`. */
  fixedAnnualAmount: number;
  usesFixedAmount: boolean;
  stress: StressScenario;
  monthlyDrift: number;
  /** Retirement years the run funds, for `vpw`'s remaining-horizon rate. */
  withdrawalYears: number;
}

/**
 * Where the stress starts biting: the first month of decumulation, or month
 * zero when the run never draws down. A crash while you are still buying is a
 * different risk, but it is a risk -- leaving accumulation-only runs
 * unstressed meant the scenarios silently did nothing on the main simulation.
 */
function stressAnchor(monthsIntoRetirement: number, month: number, usesWithdrawal: boolean): number {
  return usesWithdrawal ? monthsIntoRetirement : month - 1;
}

/** The portfolio's expected annual return, weighted -- what `vpw` annuitises. */
function blendedAnnualReturn(assets: readonly { weight: number; mean: number }[]): number {
  const total = assets.reduce((s, a) => s + a.weight, 0) || 1;
  return assets.reduce((s, a) => s + a.weight * a.mean, 0) / total;
}

/**
 * The strategy sets the retiree's gross annual income. Once the guaranteed
 * pension is flowing, only the remainder has to come from the portfolio.
 * Pension income is already stated in today's nominal amount, so it is not
 * inflation-indexed a second time here.
 */
function portfolioWithdrawalAfterPension(
  grossAnnual: number,
  yearsIntoRetirement: number,
  accumulationYears: number,
  options: WithdrawalOptions,
): number {
  const annualPension = Math.max(0, options.annualPensionIncome ?? 0);
  const yearsUntilStart = options.pensionYearsUntilStart;
  if (annualPension <= 0 || yearsUntilStart == null || !Number.isFinite(yearsUntilStart)) {
    return grossAnnual;
  }
  const pensionStartInRetirement = Math.max(0, yearsUntilStart - accumulationYears);
  return yearsIntoRetirement >= pensionStartInRetirement
    ? Math.max(0, grossAnnual - annualPension)
    : grossAnnual;
}

/**
 * Walk one already-drawn return path. Split out from the draw so that the
 * strategy comparison can replay the SAME market on every strategy: comparing
 * strategies across different random paths would measure the draw, not the
 * strategy.
 *
 * The income is decided once per retirement year rather than per month,
 * matching how the rules are actually written.
 */
function walkPath(path: readonly number[], o: WalkOptions): PathWalk {
  let value = o.initialCapital;
  const yearEnd: number[] = [];
  const annualIncomes: number[] = [];
  // A stated amount and a rate are mutually exclusive ways to seed the
  // strategy engine; either one means the flat, unindexed legacy path is
  // NOT used this run.
  const usesStrategy = o.usesRate || o.usesFixedAmount;
  let monthlyWithdrawal = usesStrategy ? 0 : o.flatWithdrawal;
  let initialWithdrawal = 0;
  let previousAnnual = 0;
  let depleted = false;

  for (let m = 1; m <= o.months; m++) {
    // 0 in the first month of decumulation, negative while accumulating.
    const monthsIntoRetirement = m - o.accMonths - 1;

    if (monthsIntoRetirement >= 0 && monthsIntoRetirement % 12 === 0) {
      const yearsIntoRetirement = monthsIntoRetirement / 12;
      if (yearsIntoRetirement === 0) {
        initialWithdrawal = o.usesFixedAmount ? o.fixedAnnualAmount : o.plan.rate * value;
      }
      const grossAnnual = usesStrategy
        ? annualWithdrawal(o.plan, {
            initialWithdrawal,
            portfolioValue: value,
            previousWithdrawal: previousAnnual,
            yearsIntoRetirement,
            yearsRemaining: Math.max(1, o.withdrawalYears - yearsIntoRetirement),
          })
        : o.flatWithdrawal * 12;
      annualIncomes.push(grossAnnual);
      previousAnnual = grossAnnual;
      monthlyWithdrawal =
        portfolioWithdrawalAfterPension(
          grossAnnual,
          yearsIntoRetirement,
          o.accMonths / 12,
          o,
        ) / 12;
    }

    const monthReturn = stressedReturn(
      o.stress,
      path[m - 1],
      stressAnchor(monthsIntoRetirement, m, o.months > o.accMonths),
      o.monthlyDrift,
    );
    // Accumulate, then draw down (never below 0 — a depleted portfolio simply
    // has nothing left to withdraw).
    const cashflow = m <= o.accMonths ? o.monthlyContribution : -monthlyWithdrawal;
    value = value * (1 + monthReturn) + cashflow;
    if (value <= 0) {
      value = 0;
      if (monthsIntoRetirement >= 0) depleted = true;
    }
    if (m % 12 === 0) yearEnd.push(value);
  }

  return { yearEnd, final: value, annualIncomes, initialWithdrawal, depleted };
}

export function runMonteCarlo(params: MonteCarloParams): MonteCarloResult {
  const {
    initialCapital,
    monthlyContribution,
    years,
    expectedReturn,
    volatility,
    runs,
  } = params;

  const wYears = Math.max(0, Math.round(params.withdrawalYears ?? 0));
  const totalYears = years + wYears;
  const accMonths = Math.max(1, Math.round(years * 12));
  const months = Math.max(1, Math.round(totalYears * 12));
  const flatWithdrawal = Math.max(0, params.monthlyWithdrawal ?? 0);
  const fixedAnnualAmount = Math.max(0, params.fixedAnnualAmount ?? 0);
  const usesFixedAmount = fixedAnnualAmount > 0 && wYears > 0;
  // A stated amount takes precedence over a rate -- the two are mutually
  // exclusive ways to seed the strategy engine (see `fixedAnnualAmount` on
  // `WithdrawalOptions`).
  const withdrawalRate = usesFixedAmount ? 0 : Math.max(0, params.withdrawalRate ?? 0);
  const usesRate = withdrawalRate > 0 && wYears > 0;
  const monthlyMean =
    Math.pow(1 + expectedReturn, 1 / 12) - 1; // geometric monthly drift
  const monthlyVol = volatility / Math.sqrt(12);
  const rng = mulberry32(params.seed >>> 0);
  const plan = planOf(params, expectedReturn);
  const stress = params.stress ?? "none";
  const walkOptions: Omit<WalkOptions, "plan"> = {
    initialCapital,
    monthlyContribution,
    accMonths,
    months,
    flatWithdrawal,
    usesRate,
    fixedAnnualAmount,
    usesFixedAmount,
    stress,
    monthlyDrift: monthlyMean,
    withdrawalYears: wYears,
    annualPensionIncome: params.annualPensionIncome,
    pensionYearsUntilStart: params.pensionYearsUntilStart,
  };

  // yearValues[y] collects every run's value at the end of year y.
  const yearValues: number[][] = Array.from({ length: totalYears + 1 }, () => []);
  const finals: number[] = [];
  const withdrawals: number[] = []; // per-run annual withdrawal amount (rate mode)
  const compare = params.compareStrategies === true && usesRate;
  const tallies = new Map<WithdrawalStrategyId, StrategyRunTally[]>(
    compare ? WITHDRAWAL_STRATEGIES.map((s) => [s, [] as StrategyRunTally[]]) : [],
  );
  const path = new Array<number>(months);

  for (let r = 0; r < runs; r++) {
    // Draw the market once per run; every strategy below sees this same one.
    for (let m = 0; m < months; m++) path[m] = monthlyMean + monthlyVol * gaussian(rng);

    const walk = walkPath(path, { ...walkOptions, plan });
    yearValues[0].push(initialCapital);
    for (let y = 1; y <= totalYears && y <= walk.yearEnd.length; y++) {
      yearValues[y].push(walk.yearEnd[y - 1]);
    }
    finals.push(walk.final);
    if (usesRate || usesFixedAmount) withdrawals.push(walk.initialWithdrawal);

    if (compare) {
      for (const strategy of WITHDRAWAL_STRATEGIES) {
        const alt =
          strategy === plan.strategy
            ? walk
            : walkPath(path, { ...walkOptions, plan: { ...plan, strategy } });
        tallies.get(strategy)!.push({
          incomes: alt.annualIncomes,
          endValue: alt.final,
          depleted: alt.depleted,
        });
      }
    }
  }

  const result = reduceRuns(
    params,
    yearValues,
    finals,
    initialCapital,
    monthlyContribution,
    withdrawals,
  );
  if (compare) {
    result.strategyComparison = WITHDRAWAL_STRATEGIES.map((s) =>
      summarizeStrategy(s, tallies.get(s) ?? []),
    );
  }
  return result;
}

/** Reduce per-year run snapshots into percentile bands + a final distribution. */
function reduceRuns(
  params: MonteCarloParams,
  yearValues: number[][],
  finals: number[],
  initialCapital: number,
  monthlyContribution: number,
  withdrawals: number[] = [],
): MonteCarloResult {
  const accYears = params.years;
  // Median per-run withdrawal amount (rate mode), used by the withdrawal
  // summary below.
  const sortedW = [...withdrawals].sort((a, b) => a - b);
  const bands: YearBand[] = yearValues.map((vals, year) => {
    const sorted = [...vals].sort((a, b) => a - b);
    const mean = sorted.reduce((s, x) => s + x, 0) / (sorted.length || 1);
    // Total paid in: grows during accumulation, then plateaus — withdrawals
    // draw down the portfolio's value, not what was ever contributed.
    const contributed = initialCapital + monthlyContribution * 12 * Math.min(year, accYears);
    return {
      year,
      worst: sorted[0] ?? 0,
      p10: percentile(sorted, 10),
      p25: percentile(sorted, 25),
      median: percentile(sorted, 50),
      p75: percentile(sorted, 75),
      p90: percentile(sorted, 90),
      best: sorted[sorted.length - 1] ?? 0,
      mean,
      contributed,
    };
  });
  const withdrawal: WithdrawalSummary | undefined =
    sortedW.length > 0
      ? {
          distribution: sortedW,
          p10: percentile(sortedW, 10),
          median: percentile(sortedW, 50),
          p90: percentile(sortedW, 90),
        }
      : undefined;
  return { params, bands, finalDistribution: finals.sort((a, b) => a - b), withdrawal };
}

// --- Portfolio-aware simulation ---------------------------------------------

export interface PortfolioAsset {
  weight: number;
  /** Annualised expected return, as a fraction. */
  mean: number;
  /** Annualised volatility, as a fraction. */
  vol: number;
}

export interface PortfolioMonteCarloParams extends WithdrawalOptions {
  initialCapital: number;
  monthlyContribution: number;
  years: number;
  runs: number;
  assets: PortfolioAsset[];
  /** Correlation matrix aligned to `assets`. */
  corr: number[][];
  /** Seed for the PRNG, so a run is reproducible/auditable. */
  seed: number;
  /** Optional decumulation phase after the `years` accumulation phase. */
  withdrawalYears?: number;
  /** Rebalance back to target weights at each year boundary. */
  rebalanceYearly?: boolean;
}

/** Cholesky factor (lower triangular) of a correlation matrix; null if not
 * positive-definite. */
function cholesky(m: number[][]): number[][] | null {
  const n = m.length;
  const L = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = m[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 0) return null;
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  return L;
}

/**
 * Monte Carlo over the actual portfolio: each asset evolves with its own
 * monthly mean/volatility and the holdings' correlation structure (via a
 * Cholesky factor of the correlation matrix), aggregated into a portfolio
 * value. Monthly contributions are split across assets by target weight.
 * Falls back to independent assets if the correlation matrix isn't
 * positive-definite.
 */
export function runPortfolioMonteCarlo(
  params: PortfolioMonteCarloParams,
): MonteCarloResult {
  const { initialCapital, monthlyContribution, years, runs, assets, corr } = params;
  const n = assets.length;
  const wYears = Math.max(0, Math.round(params.withdrawalYears ?? 0));
  const totalYears = years + wYears;
  const accMonths = Math.max(1, Math.round(years * 12));
  const months = Math.max(1, Math.round(totalYears * 12));
  const flatWithdrawal = Math.max(0, params.monthlyWithdrawal ?? 0);
  const fixedAnnualAmount = Math.max(0, params.fixedAnnualAmount ?? 0);
  const usesFixedAmount = fixedAnnualAmount > 0 && wYears > 0;
  const withdrawalRate = usesFixedAmount ? 0 : Math.max(0, params.withdrawalRate ?? 0);
  const usesRate = withdrawalRate > 0 && wYears > 0;
  const usesStrategy = usesRate || usesFixedAmount;
  const rebalanceYearly = !!params.rebalanceYearly;
  const rng = mulberry32(params.seed >>> 0);

  const monthlyMean = assets.map((a) => Math.pow(1 + a.mean, 1 / 12) - 1);
  const monthlyVol = assets.map((a) => a.vol / Math.sqrt(12));
  const weights = assets.map((a) => a.weight);
  // Identity fallback when correlation isn't usable.
  const L =
    cholesky(corr) ??
    Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
    );

  const plan = planOf(params, blendedAnnualReturn(assets));
  const stress = params.stress ?? "none";
  // Weighted drift, so the lost-decade scenario removes the PORTFOLIO's
  // expected growth rather than one asset's.
  const blendedDrift = assets.reduce((s, a, i) => s + weights[i] * monthlyMean[i], 0);

  const yearValues: number[][] = Array.from({ length: totalYears + 1 }, () => []);
  const finals: number[] = [];
  const withdrawals: number[] = []; // per-run annual withdrawal amount (rate mode)
  const z = new Array<number>(n);
  const compare = params.compareStrategies === true && usesRate;
  const tallies = new Map<WithdrawalStrategyId, StrategyRunTally[]>(
    compare ? WITHDRAWAL_STRATEGIES.map((s) => [s, [] as StrategyRunTally[]]) : [],
  );
  // One run's correlated per-asset monthly returns, drawn once and replayed for
  // every strategy under comparison (see walkPath's note: comparing across
  // different draws would measure the draw).
  const rets: number[][] = Array.from({ length: n }, () => new Array<number>(months).fill(0));

  /** Walk this run's already-drawn returns under one strategy. */
  const walk = (p: WithdrawalPlan): PathWalk => {
    const values = weights.map((w) => initialCapital * w);
    const yearEnd: number[] = [];
    const annualIncomes: number[] = [];
    let monthlyWithdrawal = usesStrategy ? 0 : flatWithdrawal;
    let initialWithdrawal = 0;
    let previousAnnual = 0;
    let depleted = false;

    for (let m = 1; m <= months; m++) {
      const monthsIntoRetirement = m - accMonths - 1;
      const accumulating = m <= accMonths;
      let portValue = 0;
      for (let i = 0; i < n; i++) portValue += values[i];

      if (monthsIntoRetirement >= 0 && monthsIntoRetirement % 12 === 0) {
        const yearsIntoRetirement = monthsIntoRetirement / 12;
        if (yearsIntoRetirement === 0) {
          initialWithdrawal = usesFixedAmount ? fixedAnnualAmount : p.rate * portValue;
        }
        const grossAnnual = usesStrategy
          ? annualWithdrawal(p, {
              initialWithdrawal,
              portfolioValue: portValue,
              previousWithdrawal: previousAnnual,
              yearsIntoRetirement,
              yearsRemaining: Math.max(1, wYears - yearsIntoRetirement),
            })
          : flatWithdrawal * 12;
        annualIncomes.push(grossAnnual);
        previousAnnual = grossAnnual;
        monthlyWithdrawal =
          portfolioWithdrawalAfterPension(
            grossAnnual,
            yearsIntoRetirement,
            accMonths / 12,
            params,
          ) / 12;
      }

      for (let i = 0; i < n; i++) {
        const ret = stressedReturn(
          stress,
          rets[i][m - 1],
          stressAnchor(monthsIntoRetirement, m, months > accMonths),
          blendedDrift,
        );
        const cash = accumulating
          ? monthlyContribution * weights[i]
          : -monthlyWithdrawal * (portValue > 0 ? values[i] / portValue : weights[i]);
        values[i] = values[i] * (1 + ret) + cash;
        if (values[i] < 0) values[i] = 0;
      }
      let total = 0;
      for (let i = 0; i < n; i++) total += values[i];
      if (total <= 0 && monthsIntoRetirement >= 0) depleted = true;
      if (m % 12 === 0) {
        // Optional annual rebalance back to target weights.
        if (rebalanceYearly && total > 0) {
          for (let i = 0; i < n; i++) values[i] = total * weights[i];
        }
        yearEnd.push(total);
      }
    }
    let final = 0;
    for (let i = 0; i < n; i++) final += values[i];
    return { yearEnd, final, annualIncomes, initialWithdrawal, depleted };
  };

  for (let r = 0; r < runs; r++) {
    // Draw the whole run's correlated market first.
    for (let m = 0; m < months; m++) {
      for (let i = 0; i < n; i++) z[i] = gaussian(rng);
      for (let i = 0; i < n; i++) {
        let c = 0; // correlated standard normal for asset i: (L · z)_i
        for (let k = 0; k <= i; k++) c += L[i][k] * z[k];
        rets[i][m] = monthlyMean[i] + monthlyVol[i] * c;
      }
    }

    const primary = walk(plan);
    yearValues[0].push(initialCapital);
    for (let y = 1; y <= totalYears && y <= primary.yearEnd.length; y++) {
      yearValues[y].push(primary.yearEnd[y - 1]);
    }
    finals.push(primary.final);
    if (usesStrategy) withdrawals.push(primary.initialWithdrawal);

    if (compare) {
      for (const strategy of WITHDRAWAL_STRATEGIES) {
        const alt = strategy === plan.strategy ? primary : walk({ ...plan, strategy });
        tallies.get(strategy)!.push({
          incomes: alt.annualIncomes,
          endValue: alt.final,
          depleted: alt.depleted,
        });
      }
    }
  }

  // Represent as the equivalent scalar params for display continuity.
  const equivParams: MonteCarloParams = {
    initialCapital,
    monthlyContribution,
    years,
    expectedReturn: assets.reduce((s, a) => s + a.weight * a.mean, 0),
    volatility: 0,
    runs,
    seed: params.seed,
    withdrawalYears: params.withdrawalYears,
    monthlyWithdrawal: params.monthlyWithdrawal,
    withdrawalRate: params.withdrawalRate,
    fixedAnnualAmount: params.fixedAnnualAmount,
    withdrawalStrategy: params.withdrawalStrategy,
    stress: params.stress,
    compareStrategies: params.compareStrategies,
    annualPensionIncome: params.annualPensionIncome,
    pensionYearsUntilStart: params.pensionYearsUntilStart,
  };
  const result = reduceRuns(
    equivParams,
    yearValues,
    finals,
    initialCapital,
    monthlyContribution,
    withdrawals,
  );
  if (compare) {
    result.strategyComparison = WITHDRAWAL_STRATEGIES.map((s) =>
      summarizeStrategy(s, tallies.get(s) ?? []),
    );
  }
  return result;
}
