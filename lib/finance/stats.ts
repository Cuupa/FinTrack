// Statistical estimation of expected return and volatility from historical
// price data — so the Monte Carlo simulation uses measured parameters rather
// than an assumed "7% p.a.".
//
// When real history is supplied (HistoryMap from /api/history) the estimation
// runs on MONTHLY returns: each asset uses its own real history where available
// and falls back to the synthetic series otherwise. Without real history it
// runs on the synthetic DAILY series. Annualisation is resolution-aware.

import { assetPriceKey, type Asset, type AssetType } from "../types";
import { dailyPrices } from "./prices";
import type { HistoryMap, HistoryPoint } from "../history/history";

const DAILY_PPY = 365; // synthetic series is calendar-daily
const MONTHLY_PPY = 12;
// Real history is used for an asset only when at least this much total history
// exists; the window is then sliced to the requested (horizon) length.
const MIN_REAL_MONTHS = 6;

// Commodities/precious metals (e.g. a gold ETC, or an asset typed COMMODITY
// directly) have an equity-like vol but a far lower long-run real return —
// nowhere near 10% over decades. A COMMODITY-typed asset is caught directly;
// a commodity ETC/ETF typed ETF/STOCK is caught by name (the asset record
// carries no sector). Used as the prior for such holdings instead of the
// equity-like ETF assumption.
const COMMODITY = { mean: 0.03, vol: 0.16 };
const COMMODITY_RE = /\b(gold|silver|platin|palladium|silber|commodit|rohstoff|edelmetall|bullion|precious\s*metal)/i;

function isCommodity(asset: Asset): boolean {
  return asset.type === "COMMODITY" || COMMODITY_RE.test(asset.name || "");
}

// General long-run capital-market assumptions per asset type (annualised
// NOMINAL fractions), used as the prior an asset's measured return regresses
// toward — and the sole source when there's no usable real history. These are
// conservative long-run averages: broad equities ~7%, not a hot recent window.
const GENERAL: Record<AssetType, { mean: number; vol: number }> = {
  ETF: { mean: 0.07, vol: 0.16 },
  STOCK: { mean: 0.07, vol: 0.2 },
  CRYPTO: { mean: 0.08, vol: 0.7 },
  COMMODITY,
  CASH: { mean: 0.02, vol: 0.005 },
  // Manual-valuation assets (real estate, collectibles): illiquid, low measured
  // volatility, modest long-run appreciation. A conservative prior only.
  OTHER: { mean: 0.03, vol: 0.1 },
};

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
  /** True when any figure is a general guesstimate (insufficient real history). */
  estimated: boolean;
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
  /** Years of real return history backing this asset's estimate. */
  years: number;
  /** True when real market history backed the estimate (vs. a pure assumption). */
  real: boolean;
  /** True when the figures lean on the long-run assumption (no/short history). */
  estimated: boolean;
}

export interface PortfolioModel {
  assets: AssetModel[];
  corr: number[][];
  /** Longest per-asset history used for the μ/σ estimates (years). */
  sampleYears: number;
  /** Overlapping window the correlations are estimated from (years). */
  corrYears: number;
  real: boolean;
  /** True when any holding's figures are a rough guess (limited/synthetic data). */
  estimated: boolean;
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
 * Leverage multiplier parsed from a fund's name — e.g. "2x Leveraged" → 2,
 * "Daily Short" / "-1x" → -1. Defaults to 1. Used to scale the guesstimate so a
 * leveraged fund isn't modelled like a plain index.
 */
function leverageFactor(name: string): number {
  const s = (name || "").toLowerCase();
  const inverse = /\b(inverse|short|bear)\b/.test(s) || /-\s*\d+\s*x/.test(s);
  let mag = 1;
  const m = s.match(/(\d+(?:[.,]\d+)?)\s*x\b/);
  if (m) mag = parseFloat(m[1].replace(",", "."));
  else if (/ultrapro/.test(s)) mag = 3;
  else if (/\b(leverage|leveraged|ultra)\b/.test(s)) mag = 2;
  if (!Number.isFinite(mag) || mag <= 0) mag = 1;
  return inverse ? -mag : mag;
}

/**
 * General long-run assumption for an asset's type, scaled for leverage/inverse
 * funds: vol ≈ |L|·σ and drift ≈ L·μ − ½·L·(L−1)·σ² (daily-rebalance vol drag).
 */
function generalFor(asset: Asset): { mean: number; vol: number } {
  const g = isCommodity(asset) ? COMMODITY : (GENERAL[asset.type] ?? GENERAL.ETF);
  const L = leverageFactor(asset.name);
  if (L === 1) return { mean: g.mean, vol: g.vol };
  return { mean: L * g.mean - 0.5 * L * (L - 1) * g.vol * g.vol, vol: Math.abs(L) * g.vol };
}

/**
 * Annualised mean/vol for one asset: the measured average over the requested
 * window (the caller passes a window matching the investment horizon, so the
 * figures change with it). Only when there's no usable real history does it
 * fall back to the general long-run assumption.
 *
 * `horizonYears` enables **regression to the mean**: a recent high (or low)
 * return isn't sustainable over a long projection, so the measured mean is
 * shrunk toward the asset type's long-run baseline. We trust the data more with
 * more history and less over longer horizons — w = years / (years + τ), where
 * τ grows with the horizon. `horizonYears <= 0` disables it (pure measurement,
 * e.g. for a historical Sharpe ratio).
 */
function assetMeanVol(
  asset: Asset,
  rets: number[],
  real: boolean,
  ppy: number,
  horizonYears = 0,
): { mean: number; vol: number; years: number; real: boolean; estimated: boolean } {
  const years = rets.length / ppy;
  if (real && rets.length >= 2) {
    const measured = annualizeReturn(rets, ppy);
    const vol = annualizeVol(rets, ppy);
    if (horizonYears <= 0) {
      return { mean: measured, vol, years, real: true, estimated: false };
    }
    const prior = generalFor(asset).mean;
    // τ grows with the horizon so a long projection leans on the long-run prior,
    // not a hot recent window. (A 30y plan must not assume the market keeps
    // compounding at a bull-run pace.)
    const tau = Math.max(2, horizonYears);
    const w = years / (years + tau);
    let mean = w * measured + (1 - w) * prior;
    // Over long horizons, anchor hard to the long-run prior: a strong run (or
    // slump) can't imply a decade-plus at that pace. Keeps the projection within
    // a tight band of the capital-market assumption (e.g. equities ≈ 7%, never 9%
    // over 30y; a gold ETC ≈ 3%, never 10%).
    if (horizonYears >= 15) {
      const band = 0.015;
      mean = Math.min(prior + band, Math.max(prior - band, mean));
    }
    // Flag as a blended estimate once the long-run prior carries real weight.
    return { mean, vol, years, real: true, estimated: w < 0.85 };
  }
  const g = generalFor(asset);
  return { mean: g.mean, vol: g.vol, years, real: false, estimated: true };
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
  horizonYears = years,
): PortfolioModel | null {
  const valued = holdings.filter((h) => h.marketValue > 0);
  if (valued.length === 0) return null;
  const total = valued.reduce((s, h) => s + h.marketValue, 0);

  const { series, ppy } = gatherReturns(valued, years, history);
  const lengths = series.filter((r) => r.rets.length).map((r) => r.rets.length);
  if (lengths.length === 0) return null;
  const L = Math.min(...lengths);

  // Per-asset μ/σ (measured when enough real history, else a general guess);
  // correlation from the last L overlapping points.
  const assets: AssetModel[] = valued.map((h, i) => ({
    name: h.asset.name,
    weight: h.marketValue / total,
    // `years` is both the lookback window and the projection horizon (the panel
    // couples them), so it drives the regression-to-mean shrinkage.
    ...assetMeanVol(h.asset, series[i].rets, series[i].real, ppy, horizonYears),
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
    // Headline = the longest history actually backing a μ/σ estimate (each
    // asset uses its own full series); correlations use only the overlap.
    sampleYears: Math.max(...assets.map((a) => a.years)),
    corrYears: L / ppy,
    real: series.some((r) => r.real),
    estimated: assets.some((a) => a.estimated),
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
  const model = estimatePortfolioModel(holdings, years, history);
  if (!model) return null;

  // Aggregate from the per-asset (measured-or-general) μ/σ + the measured
  // correlations, so the blended figures match the per-asset model exactly.
  const { assets, corr } = model;
  const expectedReturn = assets.reduce((s, a) => s + a.weight * a.mean, 0);
  let variance = 0;
  for (let i = 0; i < assets.length; i++) {
    for (let j = 0; j < assets.length; j++) {
      variance += assets[i].weight * assets[j].weight * assets[i].vol * assets[j].vol * corr[i][j];
    }
  }

  return {
    expectedReturn,
    volatility: Math.sqrt(Math.max(0, variance)),
    sampleYears: model.sampleYears,
    perAsset: assets.map((a) => ({
      name: a.name,
      weight: a.weight,
      annualReturn: a.mean,
      annualVol: a.vol,
    })),
    fromBenchmark: false,
    real: model.real,
    estimated: model.estimated,
  };
}

// Long-run risk-free proxy (annualised) used for risk-adjusted metrics.
export const RISK_FREE_RATE = 0.02;

/**
 * Annualised Sharpe ratio: excess return per unit of volatility. null when
 * volatility is zero/undefined (ratio is meaningless).
 */
export function sharpeRatio(
  annualReturn: number,
  annualVol: number,
  riskFree = RISK_FREE_RATE,
): number | null {
  if (!(annualVol > 0)) return null;
  return (annualReturn - riskFree) / annualVol;
}

/**
 * Annualised return/volatility (and Sharpe) for a single asset, measured from
 * its real history when available (>= MIN_REAL_MONTHS) and falling back to the
 * general long-run assumption. For the per-asset detail view.
 */
export function assetAnnualStats(
  asset: Asset,
  history: HistoryMap | undefined,
  years = 5,
): { mean: number; vol: number; sharpe: number | null; years: number; real: boolean } {
  if (history && Object.keys(history).length > 0) {
    const { rets, real } = assetMonthlyReturns(asset, history, years);
    const mv = assetMeanVol(asset, rets, real, MONTHLY_PPY);
    return { mean: mv.mean, vol: mv.vol, sharpe: sharpeRatio(mv.mean, mv.vol), years: mv.years, real: mv.real };
  }
  const rets = assetDailyReturns(asset, years);
  const mv = assetMeanVol(asset, rets, false, DAILY_PPY);
  return { mean: mv.mean, vol: mv.vol, sharpe: sharpeRatio(mv.mean, mv.vol), years: mv.years, real: false };
}

export interface PortfolioRiskStats {
  /** Value-weighted annualised return (pure measurement, no horizon shrinkage). */
  annualReturn: number;
  /** Annualised portfolio volatility from the per-asset σ + measured correlations. */
  volatility: number;
  /** Annualised downside deviation of the value-weighted return path. */
  downsideDeviation: number;
  sharpe: number | null;
  sortino: number | null;
  /** Length of the overlapping sample window actually used, in months. */
  sampleMonths: number;
  /** True when (some) real market history was used rather than synthetic. */
  real: boolean;
}

/**
 * Unified portfolio-level risk stats: reuses the exact same per-asset return
 * series, μ/σ estimation and correlation machinery as `estimatePortfolioModel`
 * (rather than a separate TWR-based path), so the KPI tiles and the
 * risk-by-holding table share one computation basis.
 */
export function portfolioRiskStats(
  holdings: StatHolding[],
  years = 5,
  history?: HistoryMap,
  rf = RISK_FREE_RATE,
): PortfolioRiskStats | null {
  const valued = holdings.filter((h) => h.marketValue > 0);
  if (valued.length === 0) return null;
  const total = valued.reduce((s, h) => s + h.marketValue, 0);
  const weights = valued.map((h) => h.marketValue / total);

  const { series, ppy } = gatherReturns(valued, years, history);
  // horizon 0 = pure measurement (no regression-to-mean), matching assetAnnualStats.
  const stats = valued.map((h, i) => assetMeanVol(h.asset, series[i].rets, series[i].real, ppy, 0));
  const annualReturn = weights.reduce((s, w, i) => s + w * stats[i].mean, 0);

  const lengths = series.filter((r) => r.rets.length).map((r) => r.rets.length);
  if (lengths.length === 0) return null;
  const L = Math.min(...lengths);
  const aligned = series.map((r) =>
    r.rets.length >= L ? r.rets.slice(r.rets.length - L) : new Array<number>(L).fill(0),
  );

  const n = valued.length;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      variance += weights[i] * weights[j] * stats[i].vol * stats[j].vol * corrcoef(aligned[i], aligned[j]);
    }
  }
  const volatility = Math.sqrt(Math.max(0, variance));

  const port: number[] = [];
  for (let t = 0; t < L; t++) port.push(weights.reduce((s, w, i) => s + w * aligned[i][t], 0));
  const downVar = mean(port.map((r) => (r < 0 ? r * r : 0)));
  const downsideDeviation = Math.sqrt(downVar) * Math.sqrt(ppy);

  const sharpe = sharpeRatio(annualReturn, volatility, rf);
  const sortino = downsideDeviation > 0 ? (annualReturn - rf) / downsideDeviation : null;

  return {
    annualReturn,
    volatility,
    downsideDeviation,
    sharpe,
    sortino,
    sampleMonths: Math.round((L / ppy) * MONTHLY_PPY),
    real: series.some((s) => s.real),
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
    estimated: true,
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
