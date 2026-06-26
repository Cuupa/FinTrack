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
}

function gaussian(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
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

  const months = Math.max(1, Math.round(years * 12));
  const monthlyMean =
    Math.pow(1 + expectedReturn, 1 / 12) - 1; // geometric monthly drift
  const monthlyVol = volatility / Math.sqrt(12);

  // yearValues[y] collects every run's value at the end of year y (0..years).
  const yearValues: number[][] = Array.from({ length: years + 1 }, () => []);
  const finals: number[] = [];

  for (let r = 0; r < runs; r++) {
    let value = initialCapital;
    yearValues[0].push(value);
    for (let m = 1; m <= months; m++) {
      const monthReturn = monthlyMean + monthlyVol * gaussian();
      value = value * (1 + monthReturn) + monthlyContribution;
      if (value < 0) value = 0;
      if (m % 12 === 0) {
        const y = m / 12;
        if (y <= years) yearValues[y].push(value);
      }
    }
    finals.push(value);
  }

  return reduceRuns(params, yearValues, finals, initialCapital, monthlyContribution);
}

/** Reduce per-year run snapshots into percentile bands + a final distribution. */
function reduceRuns(
  params: MonteCarloParams,
  yearValues: number[][],
  finals: number[],
  initialCapital: number,
  monthlyContribution: number,
): MonteCarloResult {
  const bands: YearBand[] = yearValues.map((vals, year) => {
    const sorted = [...vals].sort((a, b) => a - b);
    const mean = sorted.reduce((s, x) => s + x, 0) / (sorted.length || 1);
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
      contributed: initialCapital + monthlyContribution * 12 * year,
    };
  });
  return { params, bands, finalDistribution: finals.sort((a, b) => a - b) };
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
  const months = Math.max(1, Math.round(years * 12));

  const monthlyMean = assets.map((a) => Math.pow(1 + a.mean, 1 / 12) - 1);
  const monthlyVol = assets.map((a) => a.vol / Math.sqrt(12));
  const weights = assets.map((a) => a.weight);
  // Identity fallback when correlation isn't usable.
  const L =
    cholesky(corr) ??
    Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
    );

  const yearValues: number[][] = Array.from({ length: years + 1 }, () => []);
  const finals: number[] = [];
  const z = new Array<number>(n);

  for (let r = 0; r < runs; r++) {
    const values = weights.map((w) => initialCapital * w);
    yearValues[0].push(initialCapital);

    for (let m = 1; m <= months; m++) {
      for (let i = 0; i < n; i++) z[i] = gaussian();
      for (let i = 0; i < n; i++) {
        // Correlated standard normal for asset i: (L · z)_i
        let c = 0;
        for (let k = 0; k <= i; k++) c += L[i][k] * z[k];
        const ret = monthlyMean[i] + monthlyVol[i] * c;
        values[i] = values[i] * (1 + ret) + monthlyContribution * weights[i];
        if (values[i] < 0) values[i] = 0;
      }
      if (m % 12 === 0) {
        const y = m / 12;
        if (y <= years) {
          let total = 0;
          for (let i = 0; i < n; i++) total += values[i];
          yearValues[y].push(total);
        }
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
  };
  return reduceRuns(equivParams, yearValues, finals, initialCapital, monthlyContribution);
}
