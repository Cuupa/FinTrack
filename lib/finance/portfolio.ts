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
import { currentPrice, hasManualValuation, nativeCurrency, priceOn } from "./prices";
import { priceAtFrom, priceAtWithHeadTolerance, type HistoryMap } from "../history/history";

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
  totalTaxes: number;
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
  let totalTaxes = 0;

  for (const t of sorted) {
    totalFees += t.fee;
    totalTaxes += t.tax;
    // Tax mirrors fee throughout: a buy tax (transaction tax) is part of the
    // acquisition cost, a sell tax (Abgeltungsteuer) reduces the proceeds.
    if (t.type === "BUY") {
      const cost = t.quantity * t.price + t.fee + t.tax;
      const newShares = shares + t.quantity;
      avgCost = newShares > 0 ? (shares * avgCost + cost) / newShares : 0;
      shares = newShares;
    } else if (t.type === "BOOKING" || t.type === "INTEREST") {
      // Free crediting: add shares at zero cost so their whole
      // market value is profit. The recorded price is informational only; only
      // any fee adds to basis. INTEREST (cash interest) works the same way —
      // credited at zero cost basis so it counts as return.
      const newShares = shares + t.quantity;
      avgCost = newShares > 0 ? (shares * avgCost + t.fee + t.tax) / newShares : 0;
      shares = newShares;
    } else if (t.type === "SPLIT") {
      // Stock split: quantity is the ratio (new shares per old share). Total
      // cost basis (shares × avgCost) is unchanged — shares scale up, average
      // cost per share scales down by the same factor.
      const ratio = t.quantity;
      if (ratio > 0) {
        shares *= ratio;
        avgCost = avgCost / ratio;
      }
    } else {
      const proceeds = t.quantity * t.price - t.fee - t.tax;
      realizedPL += proceeds - t.quantity * avgCost;
      shares -= t.quantity;
      if (shares <= 1e-9) {
        shares = 0;
        avgCost = 0;
      }
    }
  }

  return { shares, avgCost, costBasis: shares * avgCost, realizedPL, totalFees, totalTaxes };
}

/** Signed quantity held on a given date (inclusive). */
export function sharesAt(txs: Transaction[], isoDate: string): number {
  // SPLIT's effect is multiplicative and order-dependent, so — unlike the
  // purely additive types — this replay must process transactions in
  // chronological order rather than in whatever order they're passed.
  const sorted = [...txs].sort(byDateAsc);
  let shares = 0;
  for (const t of sorted) {
    // Compare by day: transactions carry a full timestamp, series keys don't.
    if (dateKey(t.date) > isoDate) continue;
    if (t.type === "SPLIT") {
      if (t.quantity > 0) shares *= t.quantity;
    } else {
      shares += t.type === "SELL" ? -t.quantity : t.quantity;
    }
  }
  return Math.max(0, shares);
}

/**
 * Valuation context: how to turn native-currency prices into base-currency
 * values. `live` holds live native prices keyed by assetPriceKey; `fx` holds
 * native-currency → base spot rates. `fxHistory` optionally holds a dated
 * series per native currency (ascending `[date, rateToBase]` pairs) for
 * date-aware conversion of historical chart series; when absent for a
 * currency, callers fall back to the constant `fx` spot rate. Omit the whole
 * context to value everything 1:1 in native currency (used by
 * currency-agnostic callers).
 */
export interface ValuationContext {
  base: string;
  live?: Record<string, number>;
  fx?: Record<string, number>;
  fxHistory?: Record<string, [string, number][]>;
}

/** Most-recent transaction usable as a synthetic price anchor: a real
 * execution/booking with a positive price. BUY/SELL carry genuine market
 * prices; BOOKING's price is a real market observation of a free credit.
 * INTEREST is excluded (a cash concept; CASH is handled separately). */
function anchorTx(txs: Transaction[]): { date: string; price: number } | null {
  let best: { date: string; price: number } | null = null;
  for (const t of txs) {
    if (t.type !== "BUY" && t.type !== "SELL" && t.type !== "BOOKING") continue;
    if (!Number.isFinite(t.price) || t.price <= 0) continue;
    const date = dateKey(t.date);
    if (best === null || date > best.date) best = { date, price: t.price };
  }
  return best;
}

/** Synthetic-series continuity factor. A live quote wins (rescale so the series
 * ends at it, keeps charts continuous); with no live quote, anchor to the
 * asset's own most-recent transaction price so an unpriceable instrument
 * (e.g. a knock-out warrant) is valued near its real trade price, not the
 * hash-random synthetic base. 1 when neither is available (raw synthetic:
 * watchlist/catalog assets with no transactions keep today's behavior). */
function priceFactor(asset: Asset, txs: Transaction[], v?: ValuationContext): number {
  if (asset.type === "CASH") return 1;
  const key = assetPriceKey(asset);
  // OTHER assets: `currentPrice`/`priceOn` already return the user's manual
  // valuation directly — never rescale it to a live quote or a tx anchor.
  if (asset.type === "OTHER" && hasManualValuation(key)) return 1;
  const lp = v?.live?.[key];
  if (lp && lp > 0) {
    const synth = currentPrice(key, asset.type);
    return synth > 0 ? lp / synth : 1;
  }
  const anchor = anchorTx(txs);
  if (anchor) {
    const synthAt = priceOn(key, asset.type, anchor.date);
    return synthAt > 0 ? anchor.price / synthAt : 1;
  }
  return 1;
}

/** Native-currency → base-currency rate for an asset. */
function rateFor(asset: Asset, v?: ValuationContext): number {
  if (!v) return 1;
  const cur = nativeCurrency(asset, v.base);
  if (!cur || cur === v.base) return 1;
  return v.fx?.[cur] ?? 1;
}

/**
 * Rate on/just before `date` from an ascending `[date, rate]` series (step
 * function, carry-forward). Before the series' first point, uses that first
 * point's rate rather than extrapolating further back. Duplicated from
 * lib/server/fx-history.ts's `rateAt` rather than imported: this module is
 * the pure finance core and deliberately has no dependency on lib/server.
 */
function rateAtCarryForward(series: [string, number][], date: string): number {
  if (series.length === 0) return 1;
  if (date < series[0][0]) return series[0][1];
  let lo = 0;
  let hi = series.length - 1;
  let ans = series[0][1];
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] <= date) {
      ans = series[mid][1];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/**
 * Date-aware native-currency → base-currency rate: when `v.fxHistory` has a
 * series for `currency`, carry-forward from it (the rate as of `date`, not
 * today's); otherwise falls back to the constant `v.fx` spot rate (identical
 * to `rateFor`'s behavior). Currencies equal to the base are always rate 1.
 * Used by the date-aware chart series below (netWorthSeries, twrSeries,
 * holdingPeriodProfit); `summarizeHolding` stays on the spot `rateFor` (see
 * its own comment).
 */
function rateOn(currency: string, date: string, v?: ValuationContext): number {
  if (!v) return 1;
  if (!currency || currency === v.base) return 1;
  const series = v.fxHistory?.[currency];
  if (series && series.length > 0) return rateAtCarryForward(series, date);
  return v.fx?.[currency] ?? 1;
}

/**
 * True when the asset's current price has no live market quote behind it —
 * i.e. it's the fabricated synthetic placeholder, not a real observed price.
 * CASH is never flagged: it's fixed at 1 by definition, not an estimate.
 */
function isSyntheticPrice(asset: Asset, v?: ValuationContext): boolean {
  if (asset.type === "CASH") return false;
  const key = assetPriceKey(asset);
  // OTHER assets are priced from the user's own entered valuation points —
  // real data, not a fabricated placeholder — once at least one point exists.
  if (asset.type === "OTHER") return !hasManualValuation(key);
  const lp = v?.live?.[key];
  return !(lp && lp > 0);
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
  /**
   * True when `price` has no live market quote backing it — a fabricated
   * synthetic placeholder rather than a real observed price (never true for
   * CASH, whose price is fixed at 1 by definition).
   */
  syntheticPrice: boolean;
}

export function summarizeHolding(
  asset: Asset,
  txs: Transaction[],
  v?: ValuationContext,
): HoldingSummary {
  const position = computePosition(txs);
  const factor = priceFactor(asset, txs, v);
  const price = currentPrice(assetPriceKey(asset), asset.type) * factor;
  // Deliberately spot (rateFor), not date-aware: position/basis accounting is
  // a point-in-time snapshot, not a chart series, so there's no per-point
  // date to look a historical rate up against.
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
    syntheticPrice: isSyntheticPrice(asset, v),
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

export interface NetWorthSeriesResult {
  points: SeriesPoint[];
  /**
   * True when at least one sampled date/asset had no real historical price
   * and fell back to the fabricated synthetic series — i.e. part of this
   * chart is an estimate, not observed market data.
   */
  containsSynthetic: boolean;
}

// A window start (e.g. "365 days ago") regularly lands on a non-trading day
// (weekend/holiday); the first real history point is then a day or two
// later. Within this many calendar days, use the first real close instead of
// falling back to synthetic and flagging the whole chart as an estimate.
const HEAD_GAP_TOLERANCE_DAYS = 7;

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
): NetWorthSeriesResult {
  const end = today();
  const start = timeframeStart(tf, end, earliestTxDate(txs));
  const dates = dateRange(start, end);
  // Per-asset native currency, live-continuity factor and real history,
  // precomputed. The FX rate itself is looked up per-date below (rateOn), not
  // precomputed here, so it can vary across the series instead of being
  // pinned to one spot value for every historical point.
  const byAsset = assets.map((a) => {
    const key = assetPriceKey(a);
    const atxs = transactionsByAsset(a.id, txs);
    return {
      asset: a,
      txs: atxs,
      key,
      cur: v ? nativeCurrency(a, v.base) : (a.currency ?? ""),
      factor: priceFactor(a, atxs, v),
      hist: history?.[key] ?? null,
    };
  });

  let containsSynthetic = false;
  const points = dates.map((date) => {
    let value = 0;
    for (const { asset, txs: atxs, key, cur, factor, hist } of byAsset) {
      const shares = sharesAt(atxs, date);
      if (shares === 0) continue;
      // Prefer real historical price (tolerating a small gap at the window's
      // head); fall back to the (live-anchored) synthetic.
      const real = hist ? priceAtWithHeadTolerance(hist, date, HEAD_GAP_TOLERANCE_DAYS) : null;
      // CASH is fixed at 1 by definition, and an OTHER asset's manual valuation
      // is real user data — neither is an estimate, so neither trips the
      // synthetic flag (mirrors isSyntheticPrice above).
      if (real == null && asset.type !== "CASH" && !hasManualValuation(key)) containsSynthetic = true;
      const native = real != null ? real : priceOn(key, asset.type, date) * factor;
      value += shares * native * rateOn(cur, date, v);
    }
    return { date, value };
  });
  return { points, containsSynthetic };
}

export interface AssetValueSeriesResult {
  points: SeriesPoint[];
  /**
   * True when at least one sampled date had no real historical price and fell
   * back to the fabricated synthetic series — never true for CASH, whose
   * price is fixed at 1 by definition (see `netWorthSeries`).
   */
  containsSynthetic: boolean;
}

/**
 * Value-over-time series for a single asset's position (shares × price ×
 * rate, in the base currency). Used for CASH's detail chart: its price is a
 * constant 1, so "current course" is meaningless, but the balance evolving
 * with deposits/withdrawals/interest is exactly what a value chart should
 * show. Thin wrapper over `netWorthSeries` scoped to one asset so the
 * transaction replay isn't duplicated.
 */
export function assetValueSeries(
  asset: Asset,
  txs: Transaction[],
  tf: Timeframe,
  v?: ValuationContext,
  history?: HistoryMap,
): AssetValueSeriesResult {
  const { points, containsSynthetic } = netWorthSeries([asset], txs, tf, v, history);
  return { points, containsSynthetic };
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
    const atxs = transactionsByAsset(a.id, txs);
    return {
      txs: atxs,
      key,
      type: a.type,
      cur: v ? nativeCurrency(a, v.base) : (a.currency ?? ""),
      factor: priceFactor(a, atxs, v),
      hist: history?.[key] ?? null,
      // Cash interest (CASH prices at a constant 1, so it's otherwise invisible
      // to a price-based TWR) — injected as period income below.
      interest: atxs
        .filter((t) => t.type === "INTEREST")
        .map((t) => ({ day: dateKey(t.date), amt: t.quantity })),
    };
  });

  // Per-share value (base currency) of an asset on a date, or null when we have
  // no trustworthy price. Crucially, an asset WITH real history returns null
  // before that history begins — we must NOT splice the synthetic series onto
  // the real one, or the seam shows up as a huge fake return (the early "jump").
  // Only assets with no real history at all use the synthetic series.
  const priceAt = (b: (typeof byAsset)[number], date: string): number | null => {
    const rate = rateOn(b.cur, date, v);
    if (b.hist && b.hist.length > 0) {
      const real = priceAtFrom(b.hist, date);
      return real != null && real > 0 ? real * rate : null;
    }
    const synth = priceOn(b.key, b.type, date) * b.factor;
    return synth > 0 ? synth * rate : null;
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
      // Cash interest credited during this period counts as period income
      // regardless of the price/shares guards below — cash has no price move
      // of its own to carry it.
      for (const ev of b.interest) {
        if (ev.day > prevDate && ev.day <= curDate) periodPnl += ev.amt * rateOn(b.cur, ev.day, v);
      }
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

export interface AssetPriceSeriesResult {
  points: SeriesPoint[];
  /** True when this asset has no real history at all — the whole series is
   * the fabricated synthetic random walk, not observed market data. */
  synthetic: boolean;
}

/**
 * Price series for a single asset over a timeframe (detail chart), in the
 * asset's native currency. Uses real history when available, else the
 * synthetic series rescaled to end at the live price, or (with no live price)
 * anchored to the asset's own most-recent transaction price via `txs`.
 */
export function assetPriceSeries(
  asset: Asset,
  tf: Timeframe,
  v?: ValuationContext,
  history?: HistoryMap,
  txs: Transaction[] = [],
): AssetPriceSeriesResult {
  const key = assetPriceKey(asset);
  const hist = history?.[key];
  if (hist && hist.length > 0) {
    return { points: hist.map((p) => ({ date: p.date, value: p.close })), synthetic: false };
  }
  const end = today();
  const start = timeframeStart(tf, end, null);
  const factor = priceFactor(asset, txs, v);
  const points = dateRange(start, end).map((date) => ({
    date,
    value: priceOn(key, asset.type, date) * factor,
  }));
  // OTHER assets draw this series from the user's own valuation points (via
  // priceOn) — real data, not the fabricated synthetic walk.
  const manual = asset.type === "OTHER" && hasManualValuation(key);
  return { points, synthetic: !manual };
}

/**
 * Profit of a single holding over a timeframe, in the base currency, with
 * deposits/withdrawals during the window removed so the percentage is honest
 * (matches the dashboard hero's period-change logic). Network-free: uses the
 * live-anchored synthetic price for the start-of-window value, which is enough
 * for a relative period figure in the holdings table.
 *
 * `abs` is the gain in base currency; `pct` is relative to the capital exposed
 * over the window: the value held at the window start plus fresh buy inflows
 * during the window.
 */
export function holdingPeriodProfit(
  asset: Asset,
  txs: Transaction[],
  tf: Timeframe,
  v?: ValuationContext,
  history?: HistoryMap,
): { abs: number; pct: number } {
  const atxs = transactionsByAsset(asset.id, txs);
  if (atxs.length === 0) return { abs: 0, pct: 0 };
  const key = assetPriceKey(asset);
  const end = today();
  const start = timeframeStart(tf, end, earliestTxDate(atxs));
  const factor = priceFactor(asset, atxs, v);
  const cur = v ? nativeCurrency(asset, v.base) : (asset.currency ?? "");
  const hist = history?.[key] ?? null;

  const priceAt = (date: string): number => {
    const real = hist ? priceAtFrom(hist, date) : null;
    return real != null ? real : priceOn(key, asset.type, date) * factor;
  };

  const sharesStart = sharesAt(atxs, start);
  const startValue = sharesStart * priceAt(start) * rateOn(cur, start, v);

  const sharesNow = sharesAt(atxs, end);
  const priceNow = hist ? priceAt(end) : currentPrice(key, asset.type) * factor;
  const endValue = sharesNow * priceNow * rateOn(cur, end, v);

  // Net cash invested into THIS position during the window (base currency):
  // buys add, sells subtract. Fees and taxes are part of the cash moved. Each
  // flow converts at the FX rate on ITS OWN date, not the window's start/end
  // rate. `invested` tracks only in-window BUY inflows, the denominator capital.
  let flows = 0;
  let invested = 0;
  for (const t of atxs) {
    const day = dateKey(t.date);
    if (day <= start) continue;
    const rate = rateOn(cur, day, v);
    const cash = t.quantity * t.price;
    // BOOKING adds no cash (free crediting) → its value shows up as profit.
    if (t.type === "BUY") {
      const inflow = (cash + t.fee + t.tax) * rate;
      flows += inflow;
      invested += inflow;
    } else if (t.type === "SELL") {
      flows += -(cash - t.fee - t.tax) * rate;
    }
  }

  const abs = endValue - startValue - flows;
  const denom = startValue + invested;
  return { abs, pct: denom > 1e-6 ? abs / denom : 0 };
}

/**
 * Id of the CASH asset with a positive balance in the given portfolio, or
 * null when there isn't one (no cash asset yet, or it's been fully withdrawn).
 * Used to enforce one cash position per portfolio.
 */
export function cashAssetInPortfolio(
  assets: Asset[],
  txs: Transaction[],
  portfolioId: string,
): string | null {
  for (const a of assets) {
    if (a.type !== "CASH") continue;
    let balance = 0;
    for (const t of txs) {
      if (t.assetId !== a.id || t.portfolioId !== portfolioId) continue;
      balance += t.type === "SELL" ? -t.quantity : t.quantity;
    }
    if (balance > 1e-9) return a.id;
  }
  return null;
}

export { parseISODate };
