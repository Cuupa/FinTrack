// Historical price series proxy. Returns REAL daily history per asset (not the
// synthetic walk), keyed by the asset's price key, in native currency.
//   - Equities: Yahoo Finance, resolved by ISIN (currency + exchange aware).
//   - Crypto:   CoinGecko market_chart in the base currency.
// Missing series are omitted; the chart falls back to the synthetic series.

import { historyByQuery, isISIN, type YahooPoint } from "@/lib/server/yahoo";

export const dynamic = "force-dynamic";

interface HistItem {
  key: string;
  source: "yahoo" | "stooq" | "coingecko";
  id: string;
  currency: string;
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
  const result = await historyByQuery(query, item.currency, hint, cfg.yRange, cfg.yInterval);
  if (!result) return null;

  const want = (item.currency || "").toUpperCase();
  // Fell back to a different-currency listing → convert to the asset currency.
  if (want && result.currency && result.currency !== want) {
    const rate = await fxRate(result.currency, want);
    if (rate !== 1) {
      return result.points.map((p) => ({ date: p.date, close: p.close * rate }));
    }
  }
  return result.points;
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
  const days = cfg.days === "ytd" ? String(ytdDays()) : cfg.days;
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

  await Promise.all(
    items.map(async (item) => {
      const series =
        item.source === "coingecko"
          ? await coingeckoHistory(item, base, range).catch(() => null)
          : await yahooHistory(item, range).catch(() => null);
      if (series && series.length > 0) histories[item.key] = series;
    }),
  );

  return Response.json({ histories });
}
