// Monte Carlo wealth-accumulation simulation (PRD §3.3).
//
// Pure and side-effect-free so it can run inside a Web Worker. Simulates
// monthly compounding with normally-distributed returns plus monthly
// contributions, then reduces many runs into percentile bands per year.

export interface MonteCarloParams {
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
  /** Monthly amount withdrawn during the decumulation phase (base currency). */
  monthlyWithdrawal?: number;
  /**
   * Annual withdrawal RATE (fraction, e.g. 0.04 for 4%). When set, each run
   * withdraws a fixed nominal monthly amount of `rate × (that run's value at
   * retirement) / 12` — so the withdrawn amount scales with how the portfolio
   * actually grew. Takes precedence over `monthlyWithdrawal`.
   */
  withdrawalRate?: number;
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
  const withdrawalRate = Math.max(0, params.withdrawalRate ?? 0);
  const usesRate = withdrawalRate > 0 && wYears > 0;
  const monthlyMean =
    Math.pow(1 + expectedReturn, 1 / 12) - 1; // geometric monthly drift
  const monthlyVol = volatility / Math.sqrt(12);
  const rng = mulberry32(params.seed >>> 0);

  // yearValues[y] collects every run's value at the end of year y.
  const yearValues: number[][] = Array.from({ length: totalYears + 1 }, () => []);
  const finals: number[] = [];
  const withdrawals: number[] = []; // per-run annual withdrawal amount (rate mode)

  for (let r = 0; r < runs; r++) {
    let value = initialCapital;
    yearValues[0].push(value);
    // Fixed nominal monthly withdrawal for this run, set at retirement.
    let runMonthlyWithdrawal = usesRate ? 0 : flatWithdrawal;
    for (let m = 1; m <= months; m++) {
      // Lock in the rate-based withdrawal from the value at retirement.
      if (usesRate && m === accMonths + 1) {
        runMonthlyWithdrawal = (withdrawalRate * value) / 12;
        withdrawals.push(withdrawalRate * value);
      }
      const monthReturn = monthlyMean + monthlyVol * gaussian(rng);
      // Accumulate, then draw down in the withdrawal phase (never below 0 — a
      // depleted portfolio simply has nothing left to withdraw).
      const cashflow = m <= accMonths ? monthlyContribution : -runMonthlyWithdrawal;
      value = value * (1 + monthReturn) + cashflow;
      if (value < 0) value = 0;
      if (m % 12 === 0) {
        const y = m / 12;
        if (y <= totalYears) yearValues[y].push(value);
      }
    }
    finals.push(value);
  }

  return reduceRuns(params, yearValues, finals, initialCapital, monthlyContribution, withdrawals);
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
  // Annual withdrawal reference line: either the flat amount, or (rate mode) the
  // median of the per-run withdrawal amounts.
  const sortedW = [...withdrawals].sort((a, b) => a - b);
  const annualWithdrawalRef =
    sortedW.length > 0
      ? percentile(sortedW, 50)
      : Math.max(0, params.monthlyWithdrawal ?? 0) * 12;
  const bands: YearBand[] = yearValues.map((vals, year) => {
    const sorted = [...vals].sort((a, b) => a - b);
    const mean = sorted.reduce((s, x) => s + x, 0) / (sorted.length || 1);
    // Net contributed: paid-in during accumulation, drawn-down thereafter.
    // Never below 0 — you can't have withdrawn more than was ever there.
    const contributed = Math.max(
      0,
      initialCapital +
        monthlyContribution * 12 * Math.min(year, accYears) -
        annualWithdrawalRef * Math.max(0, year - accYears),
    );
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

export interface PortfolioMonteCarloParams {
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
  /** Monthly amount withdrawn during the decumulation phase (base currency). */
  monthlyWithdrawal?: number;
  /**
   * Annual withdrawal RATE (fraction). When set, each run withdraws a fixed
   * nominal monthly amount of `rate × (that run's value at retirement) / 12`.
   * Takes precedence over `monthlyWithdrawal`.
   */
  withdrawalRate?: number;
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
  const withdrawalRate = Math.max(0, params.withdrawalRate ?? 0);
  const usesRate = withdrawalRate > 0 && wYears > 0;
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

  const yearValues: number[][] = Array.from({ length: totalYears + 1 }, () => []);
  const finals: number[] = [];
  const withdrawals: number[] = []; // per-run annual withdrawal amount (rate mode)
  const z = new Array<number>(n);

  for (let r = 0; r < runs; r++) {
    const values = weights.map((w) => initialCapital * w);
    yearValues[0].push(initialCapital);
    // Fixed nominal monthly withdrawal for this run, set at retirement.
    let runMonthlyWithdrawal = usesRate ? 0 : flatWithdrawal;

    for (let m = 1; m <= months; m++) {
      for (let i = 0; i < n; i++) z[i] = gaussian(rng);
      // Accumulate then draw down; withdrawals come proportionally from assets.
      const accumulating = m <= accMonths;
      let portValue = 0;
      for (let i = 0; i < n; i++) portValue += values[i];
      // Lock in the rate-based withdrawal from the value at retirement.
      if (usesRate && m === accMonths + 1) {
        runMonthlyWithdrawal = (withdrawalRate * portValue) / 12;
        withdrawals.push(withdrawalRate * portValue);
      }
      for (let i = 0; i < n; i++) {
        let c = 0; // correlated standard normal for asset i: (L · z)_i
        for (let k = 0; k <= i; k++) c += L[i][k] * z[k];
        const ret = monthlyMean[i] + monthlyVol[i] * c;
        const cash = accumulating
          ? monthlyContribution * weights[i]
          : -runMonthlyWithdrawal * (portValue > 0 ? values[i] / portValue : weights[i]);
        values[i] = values[i] * (1 + ret) + cash;
        if (values[i] < 0) values[i] = 0;
      }
      if (m % 12 === 0) {
        let total = 0;
        for (let i = 0; i < n; i++) total += values[i];
        // Optional annual rebalance back to target weights.
        if (rebalanceYearly && total > 0) {
          for (let i = 0; i < n; i++) values[i] = total * weights[i];
        }
        const y = m / 12;
        if (y <= totalYears) yearValues[y].push(total);
      }
    }
    let total = 0;
    for (let i = 0; i < n; i++) total += values[i];
    finals.push(total);
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
  };
  return reduceRuns(equivParams, yearValues, finals, initialCapital, monthlyContribution, withdrawals);
}
