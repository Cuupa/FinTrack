// Historical price series proxy. Returns REAL daily history per asset (not the
// synthetic walk), keyed by the asset's price key, in native currency.
//   - Equities: Yahoo Finance, resolved by ISIN (currency + exchange aware).
//   - Equities the catalog learned onto onvista (German structured products/
//     certificates, LU mutual funds Yahoo can't resolve at all): onvista's
//     eod_history, capped at roughly the last month by the provider itself
//     (see lib/server/onvista.ts) — a short real series beats none.
//   - Crypto:   CoinGecko market_chart in the base currency.
// Missing series are omitted; the chart falls back to the synthetic series.

import type { SupabaseClient } from "@supabase/supabase-js";
import { historyByQuery, isISIN, type YahooPoint } from "@/lib/server/yahoo";
import { onvistaEodHistory, parseOnvistaQuoteId } from "@/lib/server/onvista";
import { secretKey, supabaseSecret, supabasePublishable } from "@/lib/server/supabase-keys";
import { scalePoints } from "@/lib/server/scale";
import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { convertPoints, fxSeriesCached } from "@/lib/server/fx-history";

export const dynamic = "force-dynamic";

// How long a cached equity series stays fresh before we refetch. Short windows
// (daily data) go stale in a day; long windows (weekly/monthly bars) in a week.
function staleHours(range: string): number {
  return range === "5Y" || range === "10Y" || range === "MAX" ? 24 * 7 : 24;
}

function hoursSince(iso: string | null): number {
  if (!iso) return Infinity;
  return (Date.now() - Date.parse(iso)) / 3_600_000;
}

/** Most recent sync time for a cached (key, range) series, or null if absent. */
async function lastSync(
  supabase: SupabaseClient,
  key: string,
  range: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("instrument_history")
    .select("synced_at")
    .eq("price_key", key)
    .eq("range", range)
    .order("synced_at", { ascending: false })
    .limit(1);
  return (data?.[0] as { synced_at: string } | undefined)?.synced_at ?? null;
}

/** Read a cached series (ascending), capped at PostgREST's ~1000 rows. */
async function readCached(
  supabase: SupabaseClient,
  key: string,
  range: string,
): Promise<YahooPoint[]> {
  const { data } = await supabase
    .from("instrument_history")
    .select("date, close")
    .eq("price_key", key)
    .eq("range", range)
    .order("date", { ascending: false })
    .limit(1000);
  return ((data ?? []) as { date: string; close: number | string }[])
    .map((r) => ({ date: r.date, close: Number(r.close) }))
    .reverse();
}

async function writeCached(
  supabase: SupabaseClient,
  key: string,
  range: string,
  points: YahooPoint[],
): Promise<void> {
  await supabase.from("instrument_history").delete().eq("price_key", key).eq("range", range);
  const syncedAt = new Date().toISOString();
  // Insert in chunks to stay well under any row-count limits.
  for (let i = 0; i < points.length; i += 500) {
    await supabase.from("instrument_history").insert(
      points.slice(i, i + 500).map((p) => ({
        price_key: key,
        range,
        date: p.date,
        close: p.close,
        synced_at: syncedAt,
      })),
    );
  }
}

interface HistItem {
  key: string;
  source: "yahoo" | "stooq" | "coingecko" | "onvista";
  id: string;
  currency: string;
  // Asset name — fallback Yahoo search query when the ISIN/WKN/symbol turns
  // up nothing (some real ISINs aren't in Yahoo's search index).
  name?: string;
  /** Provider-unit to native-unit multiplier, applied after FX; default 1. */
  scale?: number;
}

interface RequestBody {
  base?: string;
  range?: string;
  items?: HistItem[];
}

// timeframe -> Yahoo {range, interval} and CoinGecko days.
const RANGE: Record<string, { yRange: string; yInterval: string; days: string }> = {
  "1W": { yRange: "5d", yInterval: "1d", days: "7" },
  "1M": { yRange: "1mo", yInterval: "1d", days: "30" },
  "3M": { yRange: "3mo", yInterval: "1d", days: "90" },
  YTD: { yRange: "ytd", yInterval: "1d", days: "ytd" },
  "1Y": { yRange: "1y", yInterval: "1d", days: "365" },
  "5Y": { yRange: "5y", yInterval: "1wk", days: "1825" },
  "10Y": { yRange: "10y", yInterval: "1wk", days: "3650" },
  MAX: { yRange: "max", yInterval: "1mo", days: "max" },
};

// 1 unit of `from` in `to`, via Frankfurter (ECB). 1 when equal/unknown.
const fxCache = new Map<string, number>();
async function fxRate(from: string, to: string): Promise<number> {
  if (!from || !to || from === to) return 1;
  const ck = `${from}|${to}`;
  const cached = fxCache.get(ck);
  if (cached) return cached;
  try {
    const res = await fetch(
      `https://api.frankfurter.dev/v1/latest?from=${from}&to=${to}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (res.ok) {
      const data = (await res.json()) as { rates?: Record<string, number> };
      const rate = data.rates?.[to];
      if (typeof rate === "number" && rate > 0) {
        fxCache.set(ck, rate);
        return rate;
      }
    }
  } catch {
    /* fall through */
  }
  return 1;
}

async function yahooHistory(item: HistItem, range: string): Promise<YahooPoint[] | null> {
  const query = isISIN(item.key) ? item.key : item.id || item.key;
  const hint = item.source === "yahoo" && item.id ? item.id : undefined;
  const cfg = RANGE[range] ?? RANGE["1Y"];
  // A resolved hint is the exact listing the app already prices this asset
  // with (mirrors the price cron's resolveQuote call) - trust it even when
  // its currency differs from the instrument's native one. This matters for
  // commodities like gold: the authoritative replacement listing (GC=F) is
  // USD while gold's native currency is EUR; the per-point FX conversion
  // below (and the unit scale applied after it) already reconcile the
  // difference. Requiring a currency match on historyByQuery's hint fast
  // path only risks falling through to the unreliable search-candidate scan
  // past a hint that is perfectly valid, just cross-currency.
  const result = await historyByQuery(
    query,
    hint ? "" : item.currency,
    hint,
    cfg.yRange,
    cfg.yInterval,
    false,
    item.name,
  );
  if (!result) return null;

  const scale = item.scale ?? 1;
  const want = (item.currency || "").toUpperCase();
  let points = result.points;
  // Fell back to a different-currency listing → convert to the asset currency
  // using the HISTORICAL FX rate for each point's own date (not one spot rate
  // applied to the whole series), so old points reflect the FX of that day.
  if (want && result.currency && result.currency !== want) {
    const converted = await convertPoints(result.points, result.currency, want);
    if (converted) {
      points = converted;
    } else {
      // Last-resort fallback if the historical FX timeseries fetch failed:
      // apply today's spot rate to the whole series rather than show nothing.
      const spot = await fxRate(result.currency, want);
      points = scalePoints(result.points, spot);
    }
  }
  // Scale strictly AFTER FX, never folded into the FX factor: the per-
  // instrument unit scale (e.g. Yahoo's per-ounce gold price -> the user's
  // per-gram holding) is independent of currency conversion.
  return scalePoints(points, scale);
}

/** Onvista sibling of yahooHistory: same FX-then-scale structure, backed by
 *  onvistaEodHistory instead of Yahoo's chart endpoint. `item.id` is the
 *  encoded "{entityType}:{entityValue}" quote_id (see lib/server/onvista.ts);
 *  unparseable ids (a stale/corrupt quote_id) yield null, same as any other
 *  unresolvable item. */
async function onvistaHistory(item: HistItem, range: string): Promise<YahooPoint[] | null> {
  const parsed = parseOnvistaQuoteId(item.id);
  if (!parsed) return null;
  const result = await onvistaEodHistory(parsed.entityType, parsed.entityValue, range);
  if (!result) return null;

  const scale = item.scale ?? 1;
  const want = (item.currency || "").toUpperCase();
  let points = result.points;
  if (want && result.currency && result.currency !== want) {
    const converted = await convertPoints(result.points, result.currency, want);
    if (converted) {
      points = converted;
    } else {
      // Last-resort fallback if the historical FX timeseries fetch failed:
      // apply today's spot rate to the whole series rather than show nothing.
      const spot = await fxRate(result.currency, want);
      points = scalePoints(result.points, spot);
    }
  }
  // Scale strictly AFTER FX, same reasoning as yahooHistory above.
  return scalePoints(points, scale);
}

/** Dispatch to the provider matching `item.source` (coingecko is handled
 *  separately by the caller, never reaches here). */
async function providerHistory(item: HistItem, range: string): Promise<YahooPoint[] | null> {
  return item.source === "onvista" ? onvistaHistory(item, range) : yahooHistory(item, range);
}

function ytdDays(): number {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), 0, 1);
  return Math.max(1, Math.round((now.getTime() - start) / 86_400_000));
}

async function coingeckoHistory(
  item: HistItem,
  base: string,
  range: string,
): Promise<YahooPoint[] | null> {
  const cfg = RANGE[range] ?? RANGE["1Y"];
  // CoinGecko's free tier returns only ~1 year for `days=max`, but honours a
  // large explicit day count — so MAX asks for a big number instead (BTC has
  // data back to ~2013), fixing the MAX chart that started only ~1 year ago.
  const days =
    cfg.days === "ytd" ? String(ytdDays()) : cfg.days === "max" ? "5000" : cfg.days;
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${item.id}/market_chart?vs_currency=${base.toLowerCase()}&days=${days}`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { prices?: [number, number][] };
    const prices = data.prices;
    if (!prices || prices.length === 0) return null;
    const byDay = new Map<string, number>();
    for (const [ms, p] of prices) {
      if (typeof p === "number" && p > 0) {
        byDay.set(new Date(ms).toISOString().slice(0, 10), p);
      }
    }
    return Array.from(byDay, ([date, close]) => ({ date, close })).sort((a, b) =>
      a.date < b.date ? -1 : 1,
    );
  } catch {
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!(await rateLimit("history", req, 30))) return tooManyRequests();
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return Response.json({ histories: {} });
  }

  const base = (body.base || "EUR").toUpperCase();
  const range = body.range || "1Y";
  const items = Array.isArray(body.items) ? body.items : [];
  const histories: Record<string, YahooPoint[]> = {};

  // Equity history is shared, base-independent reference data → cache it in the
  // DB so we don't re-hit Yahoo on every load (this is the most-called, slowest
  // route). Crypto is priced per-base by CoinGecko, so it's always fetched live.
  // Writing instrument_history needs the secret key (RLS only grants select);
  // without it we still read whatever's cached with the publishable key.
  const supabase = supabaseSecret() ?? supabasePublishable();
  const canWrite = !!secretKey();

  await Promise.all(
    items.map(async (item) => {
      if (!item.key) return;

      if (supabase && item.source !== "coingecko") {
        // Refresh from the provider when the cache is missing or stale (writes
        // need the service role; otherwise we serve whatever is cached).
        if (canWrite && hoursSince(await lastSync(supabase, item.key, range)) > staleHours(range)) {
          const fresh = await providerHistory(item, range).catch(() => null);
          // Only cache a usable series (>= 2 points) — a lone point is a flat,
          // useless line; leaving it uncached lets the synthetic fallback show.
          if (fresh && fresh.length >= 2) await writeCached(supabase, item.key, range, fresh);
        }
        const cached = await readCached(supabase, item.key, range);
        if (cached.length >= 2) {
          histories[item.key] = cached;
          return;
        }
        // Cache empty and we can't write (no service role): fall back to a live
        // fetch so the chart still has data.
        if (!canWrite) {
          const live = await providerHistory(item, range).catch(() => null);
          if (live && live.length >= 2) histories[item.key] = live;
          return;
        }
        return;
      }

      const series =
        item.source === "coingecko"
          ? await coingeckoHistory(item, base, range).catch(() => null)
          : await providerHistory(item, range).catch(() => null);
      if (series && series.length >= 2) histories[item.key] = series;
    }),
  );

  // One historical FX series per unique native currency actually returned
  // (skip the base currency and coingecko items, which are already priced IN
  // base by the provider, not native currency). Callers (netWorthSeries,
  // twrSeries, holdingPeriodProfit) use this to convert each historical point
  // at the FX rate of ITS OWN date instead of one spot rate for the whole
  // series. Window per currency is [earliest returned point .. today], via
  // Frankfurter's open-ended time-series endpoint.
  const fx: Record<string, [string, number][]> = {};
  const currencies = new Set<string>();
  for (const item of items) {
    const cur = (item.currency || "").toUpperCase();
    if (cur && cur !== base && item.source !== "coingecko" && histories[item.key]?.length) {
      currencies.add(cur);
    }
  }
  await Promise.all(
    Array.from(currencies).map(async (cur) => {
      let earliest: string | null = null;
      for (const item of items) {
        if ((item.currency || "").toUpperCase() !== cur || item.source === "coingecko") continue;
        const pts = histories[item.key];
        if (pts && pts.length > 0 && (earliest === null || pts[0].date < earliest)) {
          earliest = pts[0].date;
        }
      }
      if (!earliest) return;
      const series = await fxSeriesCached(cur, base, earliest);
      if (series.length > 0) fx[cur] = series;
    }),
  );

  return Response.json({ histories, fx });
}
