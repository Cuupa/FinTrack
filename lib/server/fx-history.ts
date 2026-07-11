// Historical FX conversion helpers, shared by the benchmark price cache
// (app/api/benchmarks/route.ts) and the real price-history route
// (app/api/history/route.ts). A module-level 12h TTL cache means converting a
// series to a user's base currency doesn't hit Frankfurter on every request.
//
// No imports here on purpose: this stays a pure module (network calls aside)
// so it can be unit tested without pulling in "server-only"-guarded modules
// like lib/server/supabase-keys.ts (same rationale as lib/server/scale.ts).

export interface Point {
  date: string;
  close: number;
}

const fxSeriesCache = new Map<string, { at: number; series: [string, number][] }>();
const FX_TTL_MS = 12 * 60 * 60 * 1000;

/** `fxSeries`, memoized for 12h per (from, to) pair. */
export async function fxSeriesCached(
  from: string,
  to: string,
  start: string,
): Promise<[string, number][]> {
  const key = `${from}|${to}`;
  const hit = fxSeriesCache.get(key);
  if (hit && Date.now() - hit.at < FX_TTL_MS) return hit.series;
  const series = await fxSeries(from, to, start);
  if (series.length > 0) fxSeriesCache.set(key, { at: Date.now(), series });
  return series;
}

/**
 * Historic FX series (1 unit of `from` in `to`) keyed by date, ascending, via
 * Frankfurter's time-series endpoint. Used to convert a native price history
 * into the home currency so returns are comparable to home-currency holdings
 * (the conversion changes returns when FX drifts over time).
 */
export async function fxSeries(
  from: string,
  to: string,
  start: string,
): Promise<[string, number][]> {
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/${start}..?from=${from}&to=${to}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { rates?: Record<string, Record<string, number>> };
    return Object.entries(data.rates ?? {})
      .map(([date, r]) => [date, r[to]] as [string, number])
      .filter(([, v]) => typeof v === "number" && v > 0)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  } catch {
    return [];
  }
}

/** Rate on/just before `date` from an ascending [date, rate] series. */
export function rateAt(series: [string, number][], date: string): number | null {
  if (series.length === 0 || date < series[0][0]) return series[0]?.[1] ?? null;
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

/** Convert a native price series into `to` via historic FX. null if no FX. */
export async function convertPoints(
  points: Point[],
  from: string,
  to: string,
): Promise<Point[] | null> {
  if (from === to) return points;
  if (points.length === 0) return points;
  const fx = await fxSeriesCached(from, to, points[0].date);
  if (fx.length === 0) return null;
  return points.map((p) => {
    const rate = rateAt(fx, p.date);
    return rate ? { date: p.date, close: p.close * rate } : p;
  });
}
