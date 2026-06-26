// Shared server-side Yahoo Finance access (used by /api/quotes and
// /api/history). Resolves a query (ISIN or symbol) to a Yahoo symbol, picking
// the listing whose currency matches AND whose exchange has good data — e.g.
// for an EUR ETF, the Xetra (.DE) listing over a thin regional one (.SG), which
// has a price but no usable history.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const TIMEOUT = 10_000;
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

export interface YahooPoint {
  date: string;
  close: number;
}

async function getJSON(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(TIMEOUT),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

// Preferred exchange suffixes per currency (primary, deep-history listings).
const PREF: Record<string, string[]> = {
  EUR: [".DE", ".AS", ".PA", ".MI", ".MC", ".BR", ".LS", ".VI", ".HE", ".F"],
  USD: [""],
  GBP: [".L"],
  CHF: [".SW"],
  CAD: [".TO"],
  AUD: [".AX"],
  JPY: [".T"],
};

function suffixOf(symbol: string): string {
  const i = symbol.lastIndexOf(".");
  return i >= 0 ? symbol.slice(i) : "";
}

function exchangeScore(symbol: string, want: string): number {
  const prefs = PREF[want] ?? [];
  const idx = prefs.indexOf(suffixOf(symbol));
  if (idx >= 0) return 100 - idx;
  if (want === "USD" && suffixOf(symbol) === "") return 50;
  return 0;
}

async function meta(
  symbol: string,
): Promise<{ price: number; currency: string } | null> {
  const data = (await getJSON(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
  )) as
    | { chart?: { result?: Array<{ meta?: { regularMarketPrice?: number; currency?: string } }> } }
    | null;
  const m = data?.chart?.result?.[0]?.meta;
  const price = m?.regularMarketPrice;
  if (typeof price !== "number" || price <= 0) return null;
  return { price, currency: (m?.currency ?? "").toUpperCase() };
}

const symbolCache = new Map<string, string>();

/**
 * Resolve a query (ISIN or symbol) to the best Yahoo symbol for `wantCurrency`.
 * `hint` (e.g. a stored Yahoo symbol) is tried first.
 */
export async function resolveSymbol(
  query: string,
  wantCurrency: string,
  hint?: string,
): Promise<string | null> {
  const want = (wantCurrency || "").toUpperCase();

  if (hint) {
    const m = await meta(hint);
    if (m && (!want || m.currency === want)) return hint;
  }

  const cacheKey = `${query.toUpperCase()}|${want}`;
  const cached = symbolCache.get(cacheKey);
  if (cached) return cached;

  const data = (await getJSON(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`,
  )) as { quotes?: Array<{ symbol?: string }> } | null;
  const symbols = (data?.quotes ?? [])
    .map((q) => q.symbol)
    .filter((s): s is string => !!s)
    .slice(0, 6);
  if (symbols.length === 0) return null;

  const metas = await Promise.all(
    symbols.map(async (s) => ({ s, m: await meta(s) })),
  );
  const valid = metas.filter((x) => x.m) as {
    s: string;
    m: { price: number; currency: string };
  }[];
  if (valid.length === 0) return null;

  const matches = want ? valid.filter((x) => x.m.currency === want) : valid;
  const pool = matches.length > 0 ? matches : valid;
  // Highest exchange score wins; search order breaks ties.
  pool.sort((a, b) => exchangeScore(b.s, want) - exchangeScore(a.s, want));

  const chosen = pool[0].s;
  symbolCache.set(cacheKey, chosen);
  return chosen;
}

export function isISIN(s: string): boolean {
  return ISIN_RE.test(s);
}

/** Current price (native currency) for a resolved symbol. */
export async function price(symbol: string): Promise<number | null> {
  const m = await meta(symbol);
  return m ? m.price : null;
}

/** Daily history + its currency for a symbol. */
async function chart(
  symbol: string,
  range: string,
  interval: string,
): Promise<{ points: YahooPoint[]; currency: string } | null> {
  const data = (await getJSON(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`,
  )) as
    | {
        chart?: {
          result?: Array<{
            timestamp?: number[];
            indicators?: { quote?: Array<{ close?: (number | null)[] }> };
            meta?: { currency?: string };
          }>;
        };
      }
    | null;
  const result = data?.chart?.result?.[0];
  const ts = result?.timestamp;
  const close = result?.indicators?.quote?.[0]?.close;
  if (!ts || !close) return null;
  const points: YahooPoint[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = close[i];
    if (typeof c === "number" && c > 0) {
      points.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: c });
    }
  }
  if (points.length === 0) return null;
  return { points, currency: (result?.meta?.currency ?? "").toUpperCase() };
}

async function searchCandidates(query: string): Promise<string[]> {
  const data = (await getJSON(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`,
  )) as { quotes?: Array<{ symbol?: string }> } | null;
  return (data?.quotes ?? []).map((q) => q.symbol).filter((s): s is string => !!s);
}

/**
 * Historical series for a query. Prefers a listing in `wantCurrency` that has
 * history; if none (Yahoo's ISIN search often omits the deep-history listing),
 * falls back to any listing with history — the caller FX-converts. Returns the
 * series and its currency.
 */
export async function historyByQuery(
  query: string,
  wantCurrency: string,
  hint: string | undefined,
  range: string,
  interval: string,
): Promise<{ points: YahooPoint[]; currency: string } | null> {
  const want = (wantCurrency || "").toUpperCase();
  const candidates: string[] = [];
  if (hint) candidates.push(hint);
  for (const s of await searchCandidates(query)) {
    if (!candidates.includes(s)) candidates.push(s);
  }

  let fallback: { points: YahooPoint[]; currency: string } | null = null;
  for (const s of candidates.slice(0, 5)) {
    const c = await chart(s, range, interval);
    if (!c) continue;
    if (!want || c.currency === want) return c;
    if (!fallback) fallback = c;
  }
  return fallback;
}
