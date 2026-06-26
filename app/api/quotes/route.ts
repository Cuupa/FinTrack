// Live quote proxy. The browser can't call market-data APIs directly (CORS +
// key secrecy), so this server route fetches real current prices keyed by the
// asset's price key. Prices are returned in each instrument's NATIVE currency;
// currency conversion to the base happens separately via /api/fx.
//
// Sources (all keyless), in order of preference for equities:
//   - Yahoo Finance — resolves the listing by ISIN (the security's price key),
//     giving accurate prices incl. European ETFs. Unofficial endpoint.
//   - Stooq         — fallback for stocks/ETFs, by the catalog's symbol.
//   - CoinGecko     — crypto, queried directly in the base currency.
//
// Every source degrades gracefully: an item we can't price is simply omitted,
// and the client falls back to its synthetic price for that asset.

export const dynamic = "force-dynamic";

interface QuoteItem {
  key: string;
  source: "yahoo" | "stooq" | "coingecko";
  /** Provider symbol hint (Yahoo symbol, or Stooq id). */
  id: string;
  currency: string;
}

interface RequestBody {
  base?: string;
  items?: QuoteItem[];
}

const FETCH_TIMEOUT_MS = 8000;
// Yahoo rejects requests without a browser-like User-Agent.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

// Resolved (query|currency) → Yahoo symbol, cached across requests so repeated
// polls skip the search step.
const yahooSymbolCache = new Map<string, string>();

async function getJSON(
  url: string,
  headers?: Record<string, string>,
): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function getText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// --- Yahoo Finance -----------------------------------------------------------

/** Candidate Yahoo symbols for a query (ISIN or symbol), best first. */
async function yahooSearch(query: string): Promise<string[]> {
  const data = (await getJSON(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=6&newsCount=0`,
    { "User-Agent": UA },
  )) as { quotes?: Array<{ symbol?: string }> } | null;
  return (data?.quotes ?? []).map((q) => q.symbol).filter((s): s is string => !!s);
}

/** Price + currency for a Yahoo symbol via the chart endpoint. */
async function yahooMeta(
  symbol: string,
): Promise<{ price: number; currency: string } | null> {
  const data = (await getJSON(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
    { "User-Agent": UA },
  )) as
    | {
        chart?: {
          result?: Array<{ meta?: { regularMarketPrice?: number; currency?: string } }>;
        };
      }
    | null;
  const meta = data?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (typeof price !== "number" || price <= 0) return null;
  return { price, currency: (meta?.currency ?? "").toUpperCase() };
}

/**
 * Price an equity via Yahoo. An ISIN maps to several listings in different
 * currencies, so we pick the candidate whose currency matches the asset's
 * native currency (e.g. VWCE → the EUR Xetra listing, not the USD London one).
 */
async function priceViaYahoo(item: QuoteItem): Promise<number | null> {
  const want = (item.currency || "").toUpperCase();

  // A Yahoo-sourced item carries a Yahoo symbol hint — quote it directly when
  // its currency matches (skips the search round-trip entirely).
  if (item.source === "yahoo" && item.id) {
    const meta = await yahooMeta(item.id);
    if (meta && (!want || meta.currency === want)) return meta.price;
  }

  const query = ISIN_RE.test(item.key) ? item.key : item.id || item.key;
  const cacheKey = `${query}|${want}`;

  const cached = yahooSymbolCache.get(cacheKey);
  if (cached) {
    const meta = await yahooMeta(cached);
    if (meta) return meta.price;
  }

  const symbols = await yahooSearch(query);
  if (symbols.length === 0) return null;

  const metas = await Promise.all(
    symbols.slice(0, 5).map(async (s) => ({ s, meta: await yahooMeta(s) })),
  );
  const valid = metas.filter((x) => x.meta) as {
    s: string;
    meta: { price: number; currency: string };
  }[];
  if (valid.length === 0) return null;

  const chosen =
    (want && valid.find((x) => x.meta.currency === want)) || valid[0];
  yahooSymbolCache.set(cacheKey, chosen.s);
  return chosen.meta.price;
}

// --- Stooq (fallback) --------------------------------------------------------

async function fetchStooq(
  items: QuoteItem[],
  out: Record<string, number>,
): Promise<void> {
  if (items.length === 0) return;
  const ids = Array.from(new Set(items.map((i) => i.id))).filter(Boolean);
  if (ids.length === 0) return;
  const csv = await getText(
    `https://stooq.com/q/l/?s=${ids.join(",")}&f=sd2t2ohlcv&h&e=csv`,
  );
  if (!csv) return;

  // CSV: Symbol,Date,Time,Open,High,Low,Close,Volume — native currency.
  const closeBySymbol = new Map<string, number>();
  for (const line of csv.trim().split("\n").slice(1)) {
    const cols = line.split(",");
    const sym = cols[0]?.toLowerCase();
    const close = Number(cols[6]);
    if (sym && Number.isFinite(close) && close > 0) closeBySymbol.set(sym, close);
  }
  for (const item of items) {
    const close = closeBySymbol.get(item.id.toLowerCase());
    if (close !== undefined && out[item.key] === undefined) out[item.key] = close;
  }
}

// --- CoinGecko ---------------------------------------------------------------

async function fetchCoinGecko(
  items: QuoteItem[],
  base: string,
  out: Record<string, number>,
): Promise<void> {
  if (items.length === 0) return;
  const ids = Array.from(new Set(items.map((i) => i.id)));
  const vs = base.toLowerCase();
  const data = (await getJSON(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=${vs}`,
  )) as Record<string, Record<string, number>> | null;
  if (!data) return;
  for (const item of items) {
    const price = data[item.id]?.[vs];
    if (typeof price === "number" && price > 0) out[item.key] = price;
  }
}

/** Equities: Yahoo first (by ISIN), then Stooq for whatever Yahoo missed. */
async function fetchEquities(
  items: QuoteItem[],
  out: Record<string, number>,
): Promise<void> {
  if (items.length === 0) return;
  const yahooResults = await Promise.all(
    items.map((item) => priceViaYahoo(item).catch(() => null)),
  );
  const missed: QuoteItem[] = [];
  items.forEach((item, i) => {
    const p = yahooResults[i];
    if (p != null) out[item.key] = p;
    else missed.push(item);
  });
  // Stooq fallback only for items that carry a Stooq symbol.
  await fetchStooq(missed.filter((i) => i.source === "stooq"), out);
}

export async function POST(req: Request): Promise<Response> {
  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return Response.json({ prices: {} });
  }

  const base = (body.base || "EUR").toUpperCase();
  const items = Array.isArray(body.items) ? body.items : [];
  const prices: Record<string, number> = {};

  await Promise.all([
    fetchEquities(
      items.filter((i) => i.source === "yahoo" || i.source === "stooq"),
      prices,
    ),
    fetchCoinGecko(items.filter((i) => i.source === "coingecko"), base, prices),
  ]);

  return Response.json({ prices, syncedAt: new Date().toISOString() });
}
