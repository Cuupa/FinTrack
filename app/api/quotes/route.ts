// Live quote proxy. The browser can't call market-data APIs directly (CORS +
// key secrecy), so this server route fetches real current prices keyed by the
// asset's price key, in each instrument's NATIVE currency (FX to base is done
// separately via /api/fx).
//
// Sources (all keyless), in order of preference for equities:
//   - Yahoo Finance — resolved by ISIN (currency + exchange aware).
//   - Stooq         — fallback for stocks/ETFs, by the catalog's symbol.
//   - CoinGecko     — crypto, queried directly in the base currency.
//
// Every source degrades gracefully: an unpriceable item is omitted and the
// client falls back to its synthetic price.

import { isISIN, price, resolveSymbol } from "@/lib/server/yahoo";

export const dynamic = "force-dynamic";

interface QuoteItem {
  key: string;
  source: "yahoo" | "stooq" | "coingecko";
  id: string;
  currency: string;
}

interface RequestBody {
  base?: string;
  items?: QuoteItem[];
}

const FETCH_TIMEOUT_MS = 8000;

async function getJSON(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
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

/** Price an equity via Yahoo, resolving the listing by its ISIN/price key. */
async function priceViaYahoo(item: QuoteItem): Promise<number | null> {
  const query = isISIN(item.key) ? item.key : item.id || item.key;
  const hint = item.source === "yahoo" && item.id ? item.id : undefined;
  const symbol = await resolveSymbol(query, item.currency, hint);
  if (!symbol) return null;
  return price(symbol);
}

async function fetchStooq(
  items: QuoteItem[],
  out: Record<string, number>,
): Promise<void> {
  const ids = Array.from(new Set(items.map((i) => i.id))).filter(Boolean);
  if (ids.length === 0) return;
  const csv = await getText(
    `https://stooq.com/q/l/?s=${ids.join(",")}&f=sd2t2ohlcv&h&e=csv`,
  );
  if (!csv) return;
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
    const p = data[item.id]?.[vs];
    if (typeof p === "number" && p > 0) out[item.key] = p;
  }
}

/** Equities: Yahoo first (by ISIN), then Stooq for whatever Yahoo missed. */
async function fetchEquities(
  items: QuoteItem[],
  out: Record<string, number>,
): Promise<void> {
  if (items.length === 0) return;
  const results = await Promise.all(
    items.map((item) => priceViaYahoo(item).catch(() => null)),
  );
  const missed: QuoteItem[] = [];
  items.forEach((item, i) => {
    const p = results[i];
    if (p != null) out[item.key] = p;
    else missed.push(item);
  });
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
