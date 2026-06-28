// Period (quarter/year) portfolio returns, contribution-adjusted so deposits
// don't masquerade as gains. Uses a simplified modified-Dietz: for each period
// R = (V_end − V_start − F) / (V_start + ½F), where F is the net external cash
// added during the period.

import type { Asset, Transaction } from "../types";
import type { SeriesPoint, ValuationContext } from "./portfolio";

export type Period = "quarter" | "year";

/** Net external cash flow per day, in base currency (+ money in, − money out). */
export interface Flow {
  date: string;
  amount: number;
}

function rateOf(asset: Asset, v?: ValuationContext): number {
  const cur = asset.currency ?? v?.base ?? "";
  if (!v || !cur || cur === v.base) return 1;
  return v.fx?.[cur] ?? 1;
}

export function netFlows(assets: Asset[], txs: Transaction[], v?: ValuationContext): Flow[] {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const flows: Flow[] = [];
  for (const t of txs) {
    const a = byId.get(t.assetId);
    if (!a) continue;
    const rate = rateOf(a, v);
    const gross = t.quantity * t.price;
    const amount = t.type === "BUY" ? (gross + t.fee) * rate : -(gross - t.fee) * rate;
    flows.push({ date: t.date.slice(0, 10), amount });
  }
  return flows;
}

/**
 * Cumulative time-weighted return over a net-worth series, as a fraction from
 * the window start (0 at the first point). Each day's return excludes that day's
 * external cash flow (r = (V − V_prev − F) / V_prev) and is chained, so deposits
 * don't masquerade as performance. This is what the chart shows in "Return" mode.
 */
export function cumulativeReturnSeries(series: SeriesPoint[], flows: Flow[]): SeriesPoint[] {
  if (series.length === 0) return [];
  const sorted = [...flows].sort((a, b) => (a.date < b.date ? -1 : 1));
  // Skip flows on/before the window start (already baked into the first value).
  let fi = 0;
  while (fi < sorted.length && sorted[fi].date <= series[0].date) fi += 1;

  // A daily return on a near-empty portfolio is meaningless: dividing a normal
  // price move by a tiny base explodes the figure (e.g. €10 → €20 reads as
  // +100%), and one such step poisons the whole chained series. So we only
  // accrue return once the invested base is a meaningful fraction of the
  // portfolio's eventual peak — before that, the absolute P&L is negligible.
  const peak = series.reduce((m, p) => (p.value > m ? p.value : m), 0);
  const minBase = peak * 0.02;
  // When a step is dominated by external cash flow (a big buy/sell relative to
  // the base), its in-period return is unreliable: the flow rarely cancels the
  // valuation change to the cent (different price source/date, an asset with no
  // real history valued synthetically, FX), leaving a huge spurious step that
  // poisons the chained series. Standard linked-TWR practice is to break the
  // sub-period at a large flow — so we skip that step's return and resume from
  // the new base. Ordinary contributions (well under this fraction) are
  // unaffected and still handled by the (V − prev − F) term.
  const FLOW_DOMINANT = 0.1;

  const out: SeriesPoint[] = [{ date: series[0].date, value: 0 }];
  let cum = 1;
  for (let i = 1; i < series.length; i++) {
    // Sum every flow that falls in this step (prev < date <= current) — robust
    // to the series not sampling the exact flow date.
    let F = 0;
    while (fi < sorted.length && sorted[fi].date <= series[i].date) {
      F += sorted[fi].amount;
      fi += 1;
    }
    const prev = series[i - 1].value;
    if (prev > minBase && Math.abs(F) <= prev * FLOW_DOMINANT) {
      cum *= 1 + (series[i].value - prev - F) / prev;
    }
    out.push({ date: series[i].date, value: cum - 1 });
  }
  return out;
}

export interface RiskMetrics {
  /** Cumulative time-weighted return over the window (fraction). */
  twr: number;
  /** Annualised volatility (std. dev. of daily returns), fraction. */
  volatility: number;
  /** Max peak-to-trough decline over the window (positive fraction). */
  maxDrawdown: number;
  /** Longest stretch below a prior peak, in days. */
  maxDrawdownDays: number;
  /** Annualised downside deviation (semi-deviation of negative days), fraction. */
  downsideDeviation: number;
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) / 86_400_000,
  );
}

/**
 * Risk metrics for the selected window, derived from the cumulative-return
 * series (so they reflect performance, not deposits).
 *
 * Annualisation is **sampling-aware**: the net-worth series caps its point count
 * (so over long windows consecutive points span several days, not one). We
 * derive periods-per-year from the actual average spacing — ppy = 365·(n−1)/
 * spanDays — instead of assuming 365, otherwise volatility would be overstated
 * by √(stepDays) on any window longer than the point cap.
 */
export function riskMetrics(returnSeries: SeriesPoint[]): RiskMetrics {
  const n = returnSeries.length;
  const twr = n > 0 ? returnSeries[n - 1].value : 0;
  if (n < 2) {
    return { twr, volatility: 0, maxDrawdown: 0, maxDrawdownDays: 0, downsideDeviation: 0 };
  }
  const idx = returnSeries.map((p) => 1 + p.value);
  const daily: number[] = [];
  for (let i = 1; i < n; i++) daily.push(idx[i] / idx[i - 1] - 1);

  // Periods per year from the series' real spacing (robust to point capping).
  const spanDays = Math.max(1, daysBetween(returnSeries[0].date, returnSeries[n - 1].date));
  const ppy = (365 * (n - 1)) / spanDays;

  const mean = daily.reduce((s, x) => s + x, 0) / daily.length;
  const variance = daily.reduce((s, x) => s + (x - mean) ** 2, 0) / Math.max(1, daily.length - 1);
  const volatility = Math.sqrt(variance) * Math.sqrt(ppy);
  const downVar = daily.reduce((s, x) => s + (x < 0 ? x * x : 0), 0) / daily.length;
  const downsideDeviation = Math.sqrt(downVar) * Math.sqrt(ppy);

  let peak = idx[0];
  let peakDate = returnSeries[0].date;
  let maxDD = 0;
  let maxDays = 0;
  for (let i = 0; i < n; i++) {
    if (idx[i] >= peak) {
      peak = idx[i];
      peakDate = returnSeries[i].date;
    } else {
      const dd = (idx[i] - peak) / peak;
      if (dd < maxDD) maxDD = dd;
      const days = daysBetween(peakDate, returnSeries[i].date);
      if (days > maxDays) maxDays = days;
    }
  }
  return { twr, volatility, maxDrawdown: -maxDD, maxDrawdownDays: maxDays, downsideDeviation };
}

/** Linear-interpolated value of a (date-ascending) level series at `iso`. */
function sampleAt(series: SeriesPoint[], iso: string): number | null {
  if (series.length === 0 || iso < series[0].date) return null;
  let lo = 0;
  let hi = series.length - 1;
  let idx = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].date <= iso) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const a = series[idx];
  const b = series[idx + 1];
  if (!b || a.date === iso) return a.value;
  const t0 = Date.parse(a.date);
  const t1 = Date.parse(b.date);
  if (!(t1 > t0)) return a.value;
  return a.value + (b.value - a.value) * ((Date.parse(iso) - t0) / (t1 - t0));
}

export interface BetaAlpha {
  /** Sensitivity to the benchmark (1 = moves with it, >1 = amplified). */
  beta: number;
  /** Annualised excess return vs. what beta alone would predict (CAPM). */
  alpha: number;
}

/**
 * Beta and (Jensen's) alpha of a level series `a` against a benchmark level
 * series `b`, both expressed as positive levels (prices or 1+cumulative-return).
 * The benchmark is sampled at `a`'s dates so the two can differ in spacing.
 * Returns null when there isn't enough overlapping data.
 */
export function betaAlpha(a: SeriesPoint[], b: SeriesPoint[], rf = 0.02): BetaAlpha | null {
  if (a.length < 3 || b.length < 2) return null;
  const ar: number[] = [];
  const br: number[] = [];
  for (let i = 1; i < a.length; i++) {
    if (a[i - 1].value <= 0 || a[i].value <= 0) continue;
    const bp = sampleAt(b, a[i - 1].date);
    const bc = sampleAt(b, a[i].date);
    if (bp == null || bc == null || bp <= 0 || bc <= 0) continue;
    ar.push(a[i].value / a[i - 1].value - 1);
    br.push(bc / bp - 1);
  }
  const n = ar.length;
  if (n < 2) return null;
  const ma = ar.reduce((s, x) => s + x, 0) / n;
  const mb = br.reduce((s, x) => s + x, 0) / n;
  let cov = 0;
  let varb = 0;
  for (let i = 0; i < n; i++) {
    cov += (ar[i] - ma) * (br[i] - mb);
    varb += (br[i] - mb) ** 2;
  }
  if (varb <= 0) return null;
  const beta = cov / varb;

  // Annualised returns over the common span for the CAPM alpha.
  const years = Math.max(
    1 / 365,
    (Date.parse(a[a.length - 1].date) - Date.parse(a[0].date)) / (365 * 86_400_000),
  );
  const bStart = sampleAt(b, a[0].date);
  const bEnd = sampleAt(b, a[a.length - 1].date);
  if (bStart == null || bEnd == null || bStart <= 0) return { beta, alpha: 0 };
  const aAnn = (a[a.length - 1].value / a[0].value) ** (1 / years) - 1;
  const bAnn = (bEnd / bStart) ** (1 / years) - 1;
  const alpha = aAnn - (rf + beta * (bAnn - rf));
  return { beta, alpha };
}

export interface PeriodReturn {
  /** Sort/identity key, e.g. "2025-Q1" or "2025". */
  key: string;
  year: number;
  /** Short axis label, e.g. "Q1" or "2025". */
  label: string;
  /** Quarter index 0..3 (0 for yearly). */
  quarter: number;
  ret: number;
}

function periodKey(date: string, period: Period): { key: string; year: number; quarter: number } {
  const year = Number(date.slice(0, 4));
  if (period === "year") return { key: `${year}`, year, quarter: 0 };
  const q = Math.floor((Number(date.slice(5, 7)) - 1) / 3);
  return { key: `${year}-Q${q + 1}`, year, quarter: q };
}

/** Contribution-adjusted return for each quarter/year covered by the series. */
export function periodReturns(series: SeriesPoint[], flows: Flow[], period: Period): PeriodReturn[] {
  if (series.length === 0) return [];
  const out: PeriodReturn[] = [];
  let i = 0;
  while (i < series.length) {
    const k = periodKey(series[i].date, period).key;
    const startVal = i > 0 ? series[i - 1].value : 0;
    let j = i;
    while (j + 1 < series.length && periodKey(series[j + 1].date, period).key === k) j++;
    const endVal = series[j].value;
    const from = series[i].date;
    const to = series[j].date;
    let F = 0;
    for (const f of flows) if (f.date >= from && f.date <= to) F += f.amount;
    const denom = startVal + 0.5 * F;
    const ret = denom > 0 ? (endVal - startVal - F) / denom : 0;
    const meta = periodKey(series[i].date, period);
    out.push({
      key: meta.key,
      year: meta.year,
      label: period === "year" ? `${meta.year}` : `Q${meta.quarter + 1}`,
      quarter: meta.quarter,
      ret,
    });
    i = j + 1;
  }
  return out;
}
