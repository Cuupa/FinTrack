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
    if (prev > 0) cum *= 1 + (series[i].value - prev - F) / prev;
    out.push({ date: series[i].date, value: cum - 1 });
  }
  return out;
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
