// Real historical price series (native currency), fetched from /api/history.
// Pure helpers only — the fetch lives in use-history.ts.

export interface HistoryPoint {
  date: string;
  close: number;
}

/** Native-currency history per asset price key. */
export type HistoryMap = Record<string, HistoryPoint[]>;

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
