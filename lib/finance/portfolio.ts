// Portfolio reconstruction and valuation from a transaction log.
//
// Holdings are derived, never stored: any point-in-time quantity, cost basis,
// realised and unrealised P&L is computed by replaying transactions. Cost
// basis uses the average-cost method (buy fees raise basis, sell fees reduce
// proceeds).

import { assetPriceKey, type Asset, type Transaction } from "../types";
import {
  dateKey,
  dateRange,
  parseISODate,
  timeframeStart,
  today,
  type Timeframe,
} from "./dates";
import { currentPrice, nativeCurrency, priceOn } from "./prices";
import { priceAtFrom, type HistoryMap } from "../history/history";

export interface Position {
  /** Shares/units currently held. */
  shares: number;
  /** Average cost per share (incl. allocated buy fees). */
  avgCost: number;
  /** shares × avgCost. */
  costBasis: number;
  /** Realised P&L from sells to date. */
  realizedPL: number;
  totalFees: number;
}

const byDateAsc = (a: Transaction, b: Transaction) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

/** Replay a single asset's transactions into a current position. */
export function computePosition(txs: Transaction[]): Position {
  const sorted = [...txs].sort(byDateAsc);
  let shares = 0;
  let avgCost = 0;
  let realizedPL = 0;
  let totalFees = 0;

  for (const t of sorted) {
    totalFees += t.fee;
    if (t.type === "BUY") {
      const cost = t.quantity * t.price + t.fee;
      const newShares = shares + t.quantity;
      avgCost = newShares > 0 ? (shares * avgCost + cost) / newShares : 0;
      shares = newShares;
    } else {
      const proceeds = t.quantity * t.price - t.fee;
      realizedPL += proceeds - t.quantity * avgCost;
      shares -= t.quantity;
      if (shares <= 1e-9) {
        shares = 0;
        avgCost = 0;
      }
    }
  }

  return { shares, avgCost, costBasis: shares * avgCost, realizedPL, totalFees };
}

/** Signed quantity held on a given date (inclusive). */
export function sharesAt(txs: Transaction[], isoDate: string): number {
  let shares = 0;
  for (const t of txs) {
    // Compare by day: transactions carry a full timestamp, series keys don't.
    if (dateKey(t.date) > isoDate) continue;
    shares += t.type === "BUY" ? t.quantity : -t.quantity;
  }
  return Math.max(0, shares);
}

/**
 * Valuation context: how to turn native-currency prices into base-currency
 * values. `live` holds live native prices keyed by assetPriceKey; `fx` holds
 * native-currency → base rates. Omit it to value everything 1:1 in native
 * currency (used by currency-agnostic callers).
 */
export interface ValuationContext {
  base: string;
  live?: Record<string, number>;
  fx?: Record<string, number>;
}

/** live/synthetic continuity factor: rescales the synthetic series so it ends
 * at the live price (keeps charts continuous). 1 when no live price. */
function liveFactor(asset: Asset, v?: ValuationContext): number {
  const lp = v?.live?.[assetPriceKey(asset)];
  if (!lp || lp <= 0) return 1;
  const synth = currentPrice(assetPriceKey(asset), asset.type);
  return synth > 0 ? lp / synth : 1;
}

/** Native-currency → base-currency rate for an asset. */
function rateFor(asset: Asset, v?: ValuationContext): number {
  if (!v) return 1;
  const cur = nativeCurrency(asset, v.base);
  if (!cur || cur === v.base) return 1;
  return v.fx?.[cur] ?? 1;
}

export interface HoldingSummary {
  asset: Asset;
  position: Position; // native currency
  /** Native trading currency. */
  currency: string;
  /** Current price in the native currency (live if available). */
  price: number;
  /** Native → base rate. */
  rate: number;
  // The following are all in the base currency:
  marketValue: number;
  costBasis: number;
  unrealizedPL: number;
  realizedPL: number;
  /** Total return on still-held shares (currency-agnostic). */
  unrealizedPLPercent: number;
}

export function summarizeHolding(
  asset: Asset,
  txs: Transaction[],
  v?: ValuationContext,
): HoldingSummary {
  const position = computePosition(txs);
  const factor = liveFactor(asset, v);
  const price = currentPrice(assetPriceKey(asset), asset.type) * factor;
  const rate = rateFor(asset, v);
  const currency = v ? nativeCurrency(asset, v.base) : asset.currency ?? "";
  const marketValueNative = position.shares * price;
  const unrealizedNative = marketValueNative - position.costBasis;
  return {
    asset,
    position,
    currency,
    price,
    rate,
    marketValue: marketValueNative * rate,
    costBasis: position.costBasis * rate,
    unrealizedPL: unrealizedNative * rate,
    realizedPL: position.realizedPL * rate,
    unrealizedPLPercent:
      position.costBasis > 0 ? unrealizedNative / position.costBasis : 0,
  };
}

export function transactionsByAsset(
  assetId: string,
  txs: Transaction[],
): Transaction[] {
  return txs.filter((t) => t.assetId === assetId);
}

export function summarizeAll(
  assets: Asset[],
  txs: Transaction[],
  v?: ValuationContext,
): HoldingSummary[] {
  return assets.map((a) =>
    summarizeHolding(a, transactionsByAsset(a.id, txs), v),
  );
}

export interface PortfolioTotals {
  marketValue: number;
  costBasis: number;
  unrealizedPL: number;
  realizedPL: number;
  totalPL: number;
  totalPLPercent: number;
}

export function portfolioTotals(holdings: HoldingSummary[]): PortfolioTotals {
  let marketValue = 0;
  let costBasis = 0;
  let unrealizedPL = 0;
  let realizedPL = 0;
  for (const h of holdings) {
    marketValue += h.marketValue;
    costBasis += h.costBasis;
    unrealizedPL += h.unrealizedPL;
    realizedPL += h.realizedPL;
  }
  const totalPL = unrealizedPL + realizedPL;
  const investedBasis = costBasis || 1;
  return {
    marketValue,
    costBasis,
    unrealizedPL,
    realizedPL,
    totalPL,
    totalPLPercent: costBasis > 0 ? totalPL / investedBasis : 0,
  };
}

export interface SeriesPoint {
  date: string;
  value: number;
}

function earliestTxDate(txs: Transaction[]): string | null {
  let min: string | null = null;
  for (const t of txs) {
    const d = dateKey(t.date);
    if (min === null || d < min) min = d;
  }
  return min;
}

/**
 * Net-worth time series over a timeframe: for each sampled date, sum every
 * asset's holding (shares on that date × historical price).
 */
export function netWorthSeries(
  assets: Asset[],
  txs: Transaction[],
  tf: Timeframe,
  v?: ValuationContext,
  history?: HistoryMap,
): SeriesPoint[] {
  const end = today();
  const start = timeframeStart(tf, end, earliestTxDate(txs));
  const dates = dateRange(start, end);
  // Per-asset FX rate, live-continuity factor and real history, precomputed.
  const byAsset = assets.map((a) => {
    const key = assetPriceKey(a);
    return {
      asset: a,
      txs: transactionsByAsset(a.id, txs),
      key,
      rate: rateFor(a, v),
      factor: liveFactor(a, v),
      hist: history?.[key] ?? null,
    };
  });

  return dates.map((date) => {
    let value = 0;
    for (const { asset, txs: atxs, key, rate, factor, hist } of byAsset) {
      const shares = sharesAt(atxs, date);
      if (shares === 0) continue;
      // Prefer real historical price; fall back to the (live-anchored) synthetic.
      const real = hist ? priceAtFrom(hist, date) : null;
      const native = real != null ? real : priceOn(key, asset.type, date) * factor;
      value += shares * native * rate;
    }
    return { date, value };
  });
}

/**
 * True time-weighted cumulative return (TWROR) over a timeframe, as a fraction
 * from the window start (0 at the first point).
 *
 * This is computed from PRICE moves, never from cash flows: each period's return
 * is the value-weighted price return of the holdings, weighted by the value held
 * at the START of the period (shares bought/sold during the period only affect
 * subsequent periods). Deposits and withdrawals therefore can't show up as
 * performance — no flow term, no cliffs — and a tiny early holding contributes
 * its price return (e.g. +10%), not an explosive value ratio. This is what
 * brokers/portfolio trackers (e.g. Finanzfluss) plot as "TWROR".
 */
export function twrSeries(
  assets: Asset[],
  txs: Transaction[],
  tf: Timeframe,
  v?: ValuationContext,
  history?: HistoryMap,
): SeriesPoint[] {
  const end = today();
  const start = timeframeStart(tf, end, earliestTxDate(txs));
  const dates = dateRange(start, end);
  const byAsset = assets.map((a) => {
    const key = assetPriceKey(a);
    return {
      txs: transactionsByAsset(a.id, txs),
      key,
      type: a.type,
      rate: rateFor(a, v),
      factor: liveFactor(a, v),
      hist: history?.[key] ?? null,
    };
  });

  // Per-share value (base currency) of an asset on a date, or null when we have
  // no trustworthy price. Crucially, an asset WITH real history returns null
  // before that history begins — we must NOT splice the synthetic series onto
  // the real one, or the seam shows up as a huge fake return (the early "jump").
  // Only assets with no real history at all use the synthetic series.
  const priceAt = (b: (typeof byAsset)[number], date: string): number | null => {
    if (b.hist && b.hist.length > 0) {
      const real = priceAtFrom(b.hist, date);
      return real != null && real > 0 ? real * b.rate : null;
    }
    const synth = priceOn(b.key, b.type, date) * b.factor;
    return synth > 0 ? synth * b.rate : null;
  };

  if (dates.length === 0) return [];
  const out: SeriesPoint[] = [{ date: dates[0], value: 0 }];
  let cum = 1;
  for (let i = 1; i < dates.length; i++) {
    const prevDate = dates[i - 1];
    const curDate = dates[i];
    let baseVal = 0; // value of shares held at the START of the period
    let periodPnl = 0; // their price-only P&L over the period
    for (const b of byAsset) {
      const shares = sharesAt(b.txs, prevDate); // shares at period start only
      if (shares === 0) continue;
      const pPrev = priceAt(b, prevDate);
      const pCur = priceAt(b, curDate);
      // Skip the asset this period unless it has a real price at BOTH ends from
      // the same source (no synthetic↔real seam).
      if (pPrev == null || pCur == null) continue;
      baseVal += shares * pPrev;
      periodPnl += shares * (pCur - pPrev);
    }
    if (baseVal > 0) cum *= 1 + periodPnl / baseVal;
    out.push({ date: curDate, value: cum - 1 });
  }
  return out;
}

/**
 * Price series for a single asset over a timeframe (detail chart), in the
 * asset's native currency. Uses real history when available, else the
 * synthetic series rescaled to end at the live price.
 */
export function assetPriceSeries(
  asset: Asset,
  tf: Timeframe,
  v?: ValuationContext,
  history?: HistoryMap,
): SeriesPoint[] {
  const key = assetPriceKey(asset);
  const hist = history?.[key];
  if (hist && hist.length > 0) {
    return hist.map((p) => ({ date: p.date, value: p.close }));
  }
  const end = today();
  const start = timeframeStart(tf, end, null);
  const factor = liveFactor(asset, v);
  return dateRange(start, end).map((date) => ({
    date,
    value: priceOn(key, asset.type, date) * factor,
  }));
}

export { parseISODate };
