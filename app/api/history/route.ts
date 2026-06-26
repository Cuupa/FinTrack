// Historical price series proxy. Returns REAL daily history per asset (not the
// synthetic walk), keyed by the asset's price key, in native currency.
//   - Equities: Yahoo Finance chart endpoint, resolved by ISIN (currency-aware)
//     or the Yahoo symbol hint.
//   - Crypto:   CoinGecko market_chart in the base currency.
// Missing series are omitted; the chart falls back to the synthetic series.

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

interface Point {
  date: string;
  close: number;
}

const TIMEOUT = 10_000;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

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

const symbolCache = new Map<string, string>();

async function getJSON(url: string, headers?: Record<string, string>): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function toISO(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

async function yahooResolve(item: HistItem): Promise<string | null> {
  if (item.source === "yahoo" && item.id) return item.id;
  const query = ISIN_RE.test(item.key) ? item.key : item.id || item.key;
  const want = (item.currency || "").toUpperCase();
  const ck = `${query}|${want}`;
  const cached = symbolCache.get(ck);
  if (cached) return cached;

  const data = (await getJSON(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=6&newsCount=0`,
    { "User-Agent": UA },
  )) as { quotes?: Array<{ symbol?: string }> } | null;
  const symbols = (data?.quotes ?? []).map((q) => q.symbol).filter((s): s is string => !!s);
  if (symbols.length === 0) return null;

  // Pick the listing whose currency matches the asset (via chart meta).
  for (const s of symbols.slice(0, 5)) {
    const meta = (await getJSON(
      `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?range=1d&interval=1d`,
      { "User-Agent": UA },
    )) as { chart?: { result?: Array<{ meta?: { currency?: string } }> } } | null;
    const cur = (meta?.chart?.result?.[0]?.meta?.currency ?? "").toUpperCase();
    if (!want || cur === want) {
      symbolCache.set(ck, s);
      return s;
    }
  }
  symbolCache.set(ck, symbols[0]);
  return symbols[0];
}

async function yahooHistory(item: HistItem, range: string): Promise<Point[] | null> {
  const symbol = await yahooResolve(item);
  if (!symbol) return null;
  const { yRange, yInterval } = RANGE[range] ?? RANGE["1Y"];
  const data = (await getJSON(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${yRange}&interval=${yInterval}`,
    { "User-Agent": UA },
  )) as
    | { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: (number | null)[] }> } }> } }
    | null;
  const result = data?.chart?.result?.[0];
  const ts = result?.timestamp;
  const close = result?.indicators?.quote?.[0]?.close;
  if (!ts || !close) return null;
  const points: Point[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = close[i];
    if (typeof c === "number" && c > 0) points.push({ date: toISO(ts[i]), close: c });
  }
  return points.length > 0 ? points : null;
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
): Promise<Point[] | null> {
  const cfg = RANGE[range] ?? RANGE["1Y"];
  const days = cfg.days === "ytd" ? String(ytdDays()) : cfg.days;
  const data = (await getJSON(
    `https://api.coingecko.com/api/v3/coins/${item.id}/market_chart?vs_currency=${base.toLowerCase()}&days=${days}`,
  )) as { prices?: [number, number][] } | null;
  const prices = data?.prices;
  if (!prices || prices.length === 0) return null;
  // Reduce to one point per day.
  const byDay = new Map<string, number>();
  for (const [ms, price] of prices) {
    if (typeof price === "number" && price > 0) {
      byDay.set(new Date(ms).toISOString().slice(0, 10), price);
    }
  }
  return Array.from(byDay, ([date, close]) => ({ date, close })).sort((a, b) =>
    a.date < b.date ? -1 : 1,
  );
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
  const histories: Record<string, Point[]> = {};

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
