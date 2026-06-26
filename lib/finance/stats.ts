// Statistical estimation of expected return and volatility from historical
// price data — so the Monte Carlo simulation uses measured parameters rather
// than an assumed "7% p.a.".
//
// When real history is supplied (HistoryMap from /api/history) the estimation
// runs on MONTHLY returns: each asset uses its own real history where available
// and falls back to the synthetic series otherwise. Without real history it
// runs on the synthetic DAILY series. Annualisation is resolution-aware.

import { assetPriceKey, type Asset } from "../types";
import { dailyPrices } from "./prices";
import type { HistoryMap, HistoryPoint } from "../history/history";

const DAILY_PPY = 365; // synthetic series is calendar-daily
const MONTHLY_PPY = 12;
// Real history is used for an asset only with at least this many months.
const MIN_REAL_MONTHS = 24;

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
  /** True when (some) real market history was used rather than synthetic. */
  real: boolean;
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

/** Geometric annualised return from a simple-return series at `ppy`/year. */
function annualizeReturn(rets: number[], ppy: number): number {
  if (rets.length === 0) return 0;
  const logs = rets.map((r) => Math.log(1 + r));
  return Math.exp(mean(logs) * ppy) - 1;
}

function annualizeVol(rets: number[], ppy: number): number {
  return std(rets) * Math.sqrt(ppy);
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

// --- Return-series sourcing --------------------------------------------------

/** Last `years` of daily synthetic returns for an asset (empty for cash). */
function assetDailyReturns(asset: Asset, years: number): number[] {
  if (asset.type === "CASH") return [];
  const prices = dailyPrices(assetPriceKey(asset));
  const want = Math.round(years * DAILY_PPY) + 1;
  return simpleReturns(prices.slice(Math.max(0, prices.length - want)));
}

/** One close per calendar month from a real (date-ascending) history series. */
function monthlyFromHistory(hist: HistoryPoint[]): number[] {
  const byMonth = new Map<string, number>();
  for (const p of hist) byMonth.set(p.date.slice(0, 7), p.close); // last in month wins
  return Array.from(byMonth.values());
}

/** Resample the synthetic daily series to ~`months`+1 monthly points. */
function monthlyFromDaily(daily: number[], months: number): number[] {
  const step = 30;
  const out: number[] = [];
  for (let i = Math.max(0, daily.length - 1 - months * step); i <= daily.length - 1; i += step) {
    out.push(daily[i]);
  }
  return out;
}

/**
 * Last `years` of monthly returns for an asset: real history where available
 * (>= MIN_REAL_MONTHS months), otherwise the synthetic series resampled to
 * monthly. Returns { rets, real } so callers can report the source.
 */
function assetMonthlyReturns(
  asset: Asset,
  history: HistoryMap,
  years: number,
): { rets: number[]; real: boolean } {
  if (asset.type === "CASH") return { rets: [], real: false };
  const key = assetPriceKey(asset);
  const months = Math.round(years * MONTHLY_PPY);
  const real = history[key];
  let closes: number[];
  let isReal = false;
  if (real && real.length >= MIN_REAL_MONTHS) {
    closes = monthlyFromHistory(real);
    isReal = true;
  } else {
    closes = monthlyFromDaily(dailyPrices(key), months);
  }
  closes = closes.slice(Math.max(0, closes.length - (months + 1)));
  return { rets: simpleReturns(closes), real: isReal };
}

// --- Models ------------------------------------------------------------------

export interface AssetModel {
  name: string;
  weight: number;
  mean: number; // annualised, fraction
  vol: number; // annualised, fraction
}

export interface PortfolioModel {
  assets: AssetModel[];
  corr: number[][];
  sampleYears: number;
  real: boolean;
}

interface AssetReturns {
  rets: number[];
  real: boolean;
}

/** Per-asset return series + the resolution to annualise at. */
function gatherReturns(
  valued: StatHolding[],
  years: number,
  history?: HistoryMap,
): { series: AssetReturns[]; ppy: number; useReal: boolean } {
  const useReal = !!history && Object.keys(history).length > 0;
  if (useReal) {
    return {
      series: valued.map((h) => assetMonthlyReturns(h.asset, history, years)),
      ppy: MONTHLY_PPY,
      useReal: true,
    };
  }
  return {
    series: valued.map((h) => ({ rets: assetDailyReturns(h.asset, years), real: false })),
    ppy: DAILY_PPY,
    useReal: false,
  };
}

/**
 * Per-asset model for the portfolio-aware Monte Carlo: each asset's annualised
 * mean/volatility/weight (from its own history) plus the correlation matrix
 * (from the common overlapping window).
 */
export function estimatePortfolioModel(
  holdings: StatHolding[],
  years = 5,
  history?: HistoryMap,
): PortfolioModel | null {
  const valued = holdings.filter((h) => h.marketValue > 0);
  if (valued.length === 0) return null;
  const total = valued.reduce((s, h) => s + h.marketValue, 0);

  const { series, ppy } = gatherReturns(valued, years, history);
  const lengths = series.filter((r) => r.rets.length).map((r) => r.rets.length);
  if (lengths.length === 0) return null;
  const L = Math.min(...lengths);

  // Per-asset μ/σ from each asset's full series; correlation from last L.
  const assets: AssetModel[] = valued.map((h, i) => ({
    name: h.asset.name,
    weight: h.marketValue / total,
    mean: annualizeReturn(series[i].rets, ppy),
    vol: annualizeVol(series[i].rets, ppy),
  }));
  const aligned = series.map((r) =>
    r.rets.length >= L ? r.rets.slice(r.rets.length - L) : new Array<number>(L).fill(0),
  );

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

  return {
    assets,
    corr,
    sampleYears: L / ppy,
    real: series.some((r) => r.real),
  };
}

/**
 * Aggregate expected return + volatility from the value-weighted portfolio's
 * historical returns.
 */
export function estimatePortfolioStats(
  holdings: StatHolding[],
  years = 5,
  history?: HistoryMap,
): PortfolioStats | null {
  const valued = holdings.filter((h) => h.marketValue > 0);
  if (valued.length === 0) return null;
  const total = valued.reduce((s, h) => s + h.marketValue, 0);

  const { series, ppy } = gatherReturns(valued, years, history);
  const lengths = series.filter((r) => r.rets.length).map((r) => r.rets.length);
  if (lengths.length === 0) return null;
  const L = Math.min(...lengths);

  const portfolio = new Array<number>(L).fill(0);
  const perAsset: AssetStat[] = [];
  for (let i = 0; i < valued.length; i++) {
    const weight = valued[i].marketValue / total;
    const rets = series[i].rets;
    const aligned =
      rets.length >= L ? rets.slice(rets.length - L) : new Array<number>(L).fill(0);
    for (let t = 0; t < L; t++) portfolio[t] += weight * aligned[t];
    perAsset.push({
      name: valued[i].asset.name,
      weight,
      annualReturn: annualizeReturn(rets, ppy),
      annualVol: annualizeVol(rets, ppy),
    });
  }

  return {
    expectedReturn: annualizeReturn(portfolio, ppy),
    volatility: annualizeVol(portfolio, ppy),
    sampleYears: L / ppy,
    perAsset,
    fromBenchmark: false,
    real: series.some((r) => r.real),
  };
}

// FTSE All-World — diversified default used when the user has no holdings yet.
const BENCHMARK_KEY = "IE00BK5BQT80";
const BENCHMARK_NAME = "FTSE All-World (benchmark)";

export function benchmarkStats(years = 5): PortfolioStats {
  const prices = dailyPrices(BENCHMARK_KEY);
  const want = Math.round(years * DAILY_PPY) + 1;
  const rets = simpleReturns(prices.slice(Math.max(0, prices.length - want)));
  const expectedReturn = annualizeReturn(rets, DAILY_PPY);
  const volatility = annualizeVol(rets, DAILY_PPY);
  return {
    expectedReturn,
    volatility,
    sampleYears: rets.length / DAILY_PPY,
    perAsset: [{ name: BENCHMARK_NAME, weight: 1, annualReturn: expectedReturn, annualVol: volatility }],
    fromBenchmark: true,
    real: false,
  };
}

/** Stats for the user's holdings, falling back to the benchmark. */
export function portfolioOrBenchmarkStats(
  holdings: StatHolding[],
  years = 5,
  history?: HistoryMap,
): PortfolioStats {
  return estimatePortfolioStats(holdings, years, history) ?? benchmarkStats(years);
}
