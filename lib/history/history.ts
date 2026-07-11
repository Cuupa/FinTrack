// Real historical price series (native currency), fetched from /api/history.
// Pure helpers only — the fetch lives in use-history.ts.

import { daysBetween } from "../finance/dates";

export interface HistoryPoint {
  date: string;
  close: number;
}

/** Native-currency history per asset price key. */
export type HistoryMap = Record<string, HistoryPoint[]>;

/**
 * Historical FX rate series per native currency: ascending
 * `[date, rateToBase]` pairs, from /api/history's `fx` field. Used for
 * date-aware conversion of historical chart series (see
 * lib/finance/portfolio.ts's `rateOn`); the base currency itself is never a
 * key (its own rate is always 1).
 */
export type FxHistoryMap = Record<string, [string, number][]>;

export interface HistItem {
  key: string;
  source: "yahoo" | "stooq" | "coingecko";
  id: string;
  currency: string;
  // Asset name — fallback Yahoo search query when the ISIN/WKN/symbol turns
  // up nothing (some real ISINs aren't in Yahoo's search index).
  name?: string;
}

/**
 * Price on a date from a (date-ascending) history series: the last close at or
 * before the date (step function). Returns null if the date precedes the
 * series.
 */
export function priceAtFrom(series: HistoryPoint[], isoDate: string): number | null {
  if (series.length === 0 || isoDate < series[0].date) return null;
  let lo = 0;
  let hi = series.length - 1;
  let ans = series[0].close;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].date <= isoDate) {
      ans = series[mid].close;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

/**
 * Like `priceAtFrom`, but tolerates a small gap before the series starts: if
 * `isoDate` is up to `toleranceDays` before the first point, returns the
 * first close instead of null. This absorbs window starts that land on a
 * non-trading day (weekend/holiday) a day or two before the first real
 * candle — e.g. a "365 days ago" boundary falling on a Saturday when the
 * first fetched candle is the following Monday — without masking a genuine
 * lack of history further back (still null beyond the tolerance).
 */
export function priceAtWithHeadTolerance(
  series: HistoryPoint[],
  isoDate: string,
  toleranceDays: number,
): number | null {
  if (series.length === 0) return null;
  if (isoDate >= series[0].date) return priceAtFrom(series, isoDate);
  return daysBetween(isoDate, series[0].date) <= toleranceDays ? series[0].close : null;
}
