// Statistical estimation of expected return and volatility from historical
// price data — so the Monte Carlo simulation uses measured parameters rather
// than an assumed "7% p.a.".
//
// The portfolio's expected return and volatility are estimated from the actual
// holdings: we build the portfolio's historical daily return series (weighted
// by current market value) and annualise its mean and standard deviation. This
// captures diversification/correlation directly, since it works on the real
// co-movement of the holdings rather than treating them independently.

import { assetPriceKey, type Asset } from "../types";
import { dailyPrices } from "./prices";

const PERIODS_PER_YEAR = 365; // synthetic series is calendar-daily

export interface AssetStat {
  name: string;
  weight: number;
  annualReturn: number;
  annualVol: number;
}

export interface PortfolioStats {
  /** Annualised expected return (geometric), as a fraction. */
  expectedReturn: number;
  /** Annualised volatility (std. dev.), as a fraction. */
  volatility: number;
  /** Length of the sample window actually used, in years. */
  sampleYears: number;
  perAsset: AssetStat[];
  /** True when derived from a benchmark because there are no holdings. */
  fromBenchmark: boolean;
}

export interface StatHolding {
  asset: Asset;
  marketValue: number;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

function simpleReturns(prices: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < prices.length; i++) r.push(prices[i] / prices[i - 1] - 1);
  return r;
}

/** Geometric annualised return from a daily simple-return series. */
function annualizeReturn(daily: number[]): number {
  if (daily.length === 0) return 0;
  const logs = daily.map((r) => Math.log(1 + r));
  return Math.exp(mean(logs) * PERIODS_PER_YEAR) - 1;
}

function annualizeVol(daily: number[]): number {
  return std(daily) * Math.sqrt(PERIODS_PER_YEAR);
}

/** Last `years` of daily simple returns for an asset (empty for cash). */
function assetDailyReturns(asset: Asset, years: number): number[] {
  if (asset.type === "CASH") return [];
  const prices = dailyPrices(assetPriceKey(asset));
  const want = Math.round(years * PERIODS_PER_YEAR) + 1;
  return simpleReturns(prices.slice(Math.max(0, prices.length - want)));
}

function corrcoef(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a);
  const mb = mean(b);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  if (va === 0 || vb === 0) return 0;
  return cov / Math.sqrt(va * vb);
}

export interface AssetModel {
  name: string;
  weight: number;
  /** Annualised expected return, as a fraction. */
  mean: number;
  /** Annualised volatility, as a fraction. */
  vol: number;
}

export interface PortfolioModel {
  assets: AssetModel[];
  /** Correlation matrix aligned to `assets`. */
  corr: number[][];
  sampleYears: number;
}

/**
 * Per-asset model for a portfolio-aware Monte Carlo: each asset's annualised
 * mean/volatility/weight plus the correlation matrix, estimated from aligned
 * historical daily returns.
 */
export function estimatePortfolioModel(
  holdings: StatHolding[],
  years = 5,
): PortfolioModel | null {
  const valued = holdings.filter((h) => h.marketValue > 0);
  if (valued.length === 0) return null;
  const total = valued.reduce((s, h) => s + h.marketValue, 0);

  const raw = valued.map((h) => assetDailyReturns(h.asset, years));
  const lengths = raw.filter((r) => r.length).map((r) => r.length);
  if (lengths.length === 0) return null;
  const L = Math.min(...lengths);

  // Align every series to the last L samples (cash → flat zeros).
  const aligned = raw.map((r) =>
    r.length >= L ? r.slice(r.length - L) : new Array<number>(L).fill(0),
  );

  const assets: AssetModel[] = valued.map((h, i) => ({
    name: h.asset.name,
    weight: h.marketValue / total,
    mean: annualizeReturn(aligned[i]),
    vol: annualizeVol(aligned[i]),
  }));

  const n = assets.length;
  const corr = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    corr[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const c = corrcoef(aligned[i], aligned[j]);
      corr[i][j] = c;
      corr[j][i] = c;
    }
  }

  return { assets, corr, sampleYears: L / PERIODS_PER_YEAR };
}

/**
 * Estimate expected return + volatility for a set of holdings by replaying the
 * value-weighted portfolio's historical daily returns. Returns null if no
 * holding has any price history.
 */
export function estimatePortfolioStats(
  holdings: StatHolding[],
  years = 5,
): PortfolioStats | null {
  const valued = holdings.filter((h) => h.marketValue > 0);
  if (valued.length === 0) return null;

  const total = valued.reduce((s, h) => s + h.marketValue, 0);
  const returnsByAsset = valued.map((h) => ({
    h,
    rets: assetDailyReturns(h.asset, years),
  }));

  // Align all series to the shortest non-empty length.
  const lengths = returnsByAsset.filter((a) => a.rets.length).map((a) => a.rets.length);
  if (lengths.length === 0) return null;
  const L = Math.min(...lengths);

  const portfolio = new Array<number>(L).fill(0);
  const perAsset: AssetStat[] = [];

  for (const { h, rets } of returnsByAsset) {
    const weight = h.marketValue / total;
    // Cash (or missing history) contributes a flat zero-return series.
    const aligned =
      rets.length >= L ? rets.slice(rets.length - L) : new Array<number>(L).fill(0);
    for (let t = 0; t < L; t++) portfolio[t] += weight * aligned[t];
    perAsset.push({
      name: h.asset.name,
      weight,
      annualReturn: annualizeReturn(rets),
      annualVol: annualizeVol(rets),
    });
  }

  return {
    expectedReturn: annualizeReturn(portfolio),
    volatility: annualizeVol(portfolio),
    sampleYears: L / PERIODS_PER_YEAR,
    perAsset,
    fromBenchmark: false,
  };
}

// FTSE All-World — diversified default used when the user has no holdings yet.
const BENCHMARK_KEY = "IE00BK5BQT80";
const BENCHMARK_NAME = "FTSE All-World (benchmark)";

export function benchmarkStats(years = 5): PortfolioStats {
  const prices = dailyPrices(BENCHMARK_KEY);
  const want = Math.round(years * PERIODS_PER_YEAR) + 1;
  const rets = simpleReturns(prices.slice(Math.max(0, prices.length - want)));
  const expectedReturn = annualizeReturn(rets);
  const volatility = annualizeVol(rets);
  return {
    expectedReturn,
    volatility,
    sampleYears: rets.length / PERIODS_PER_YEAR,
    perAsset: [{ name: BENCHMARK_NAME, weight: 1, annualReturn: expectedReturn, annualVol: volatility }],
    fromBenchmark: true,
  };
}

/** Stats for the user's holdings, falling back to the benchmark. */
export function portfolioOrBenchmarkStats(
  holdings: StatHolding[],
  years = 5,
): PortfolioStats {
  return estimatePortfolioStats(holdings, years) ?? benchmarkStats(years);
}
