// Shared server-side Yahoo Finance access (used by /api/quotes and
// /api/history). Resolves a query (ISIN or symbol) to a Yahoo symbol, picking
// the listing whose currency matches AND whose exchange has good data — e.g.
// for an EUR ETF, the Xetra (.DE) listing over a thin regional one (.SG), which
// has a price but no usable history.
//
// Rate-limit protection: every Yahoo request funnels through getJSON(), which
// wraps a shared concurrency throttle, 429/503 retry + a circuit breaker, and
// in-process TTL caches sit in front of chart()/searchCandidates()/the
// resolveQuote()+historyByQuery() listing resolution below. All of this is
// module-level state, so it only helps within a single warm serverless
// invocation — it is NOT durable caching (that's instruments.last_price /
// instrument_history) and is allowed to be empty on cold start; it exists only
// to shield Yahoo from bursts of concurrent/duplicate requests on one instance.

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const TIMEOUT = 10_000;
const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;

export interface YahooPoint {
  date: string;
  close: number;
}

// ---------------------------------------------------------------------------
// Concurrency throttle: bounds the whole Yahoo fan-out on a warm instance to
// MAX_CONCURRENT in-flight requests, queuing the rest FIFO.
// ---------------------------------------------------------------------------

export class ConcurrencyLimiter {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active++;
      return () => this.release();
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active++;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }
}

const MAX_CONCURRENT = 5;
const yahooLimiter = new ConcurrencyLimiter(MAX_CONCURRENT);

// ---------------------------------------------------------------------------
// In-process TTL cache: a simple Map<key, {value, expires}> with max-entries
// eviction of the oldest entry. Best-effort only — see the module comment
// above on why it's fine for this to be empty/reset at any time.
// ---------------------------------------------------------------------------

export class TTLCache<V> {
  private readonly map = new Map<string, { value: V; expires: number }>();

  constructor(private readonly maxEntries: number) {}

  get(key: string): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      this.map.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    // Re-insert to keep Map insertion order (oldest-first) meaningful for
    // eviction, whether this is a fresh key or a refresh of an existing one.
    this.map.delete(key);
    if (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expires: Date.now() + ttlMs });
  }

  get size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }
}

const CHART_CACHE_MAX = 1000;
const SEARCH_CACHE_MAX = 500;
const RESOLUTION_CACHE_MAX = 1000;
const NEGATIVE_CACHE_MAX = 1000;

const CHART_SHORT_TTL_MS = 60_000; // 1d/5d ranges — quotes move fast
const CHART_LONG_TTL_MS = 10 * 60_000; // longer ranges — daily/weekly bars
const SHORT_CHART_RANGES = new Set(["1d", "5d"]);
const SEARCH_CANDIDATES_TTL_MS = 60 * 60_000; // 1h
const RESOLUTION_TTL_MS = 10 * 60_000; // 10min
const NEGATIVE_TTL_MS = 20 * 60_000; // 20min

const chartCache = new TTLCache<{ points: YahooPoint[]; currency: string; volume: number } | null>(
  CHART_CACHE_MAX,
);
const searchCandidatesCache = new TTLCache<string[]>(SEARCH_CACHE_MAX);
const resolutionCache = new TTLCache<{ symbol: string; currency: string }>(RESOLUTION_CACHE_MAX);
const unresolvableCache = new TTLCache<true>(NEGATIVE_CACHE_MAX);

// ---------------------------------------------------------------------------
// 429/503 retry + circuit breaker.
// ---------------------------------------------------------------------------

const RETRY_MAX = 2; // up to 2 retries (3 attempts total)
const BASE_BACKOFF_MS = 300;
const MAX_BACKOFF_MS = 2_000;
const COOLDOWN_MS = 45_000;

// Set once retries are exhausted on a 429; while in effect getJSON short-
// circuits to null (callers already treat null as a miss → Stooq/synthetic
// fallback) instead of hammering an already-limiting Yahoo.
let yahooCooldownUntil = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with jitter, capped, honoring a sane Retry-After (secs). */
function backoffDelayMs(attempt: number, retryAfterHeader: string | null): number {
  const jitter = Math.random() * BASE_BACKOFF_MS;
  const exponential = BASE_BACKOFF_MS * 2 ** attempt + jitter;
  let delay = Math.min(exponential, MAX_BACKOFF_MS);
  if (retryAfterHeader) {
    const secs = Number(retryAfterHeader);
    if (Number.isFinite(secs) && secs > 0) {
      delay = Math.min(secs * 1000, MAX_BACKOFF_MS);
    }
  }
  return delay;
}

export async function getJSON(url: string): Promise<unknown | null> {
  // Circuit open: skip the network entirely (and the concurrency queue) until
  // the cooldown expires.
  if (Date.now() < yahooCooldownUntil) return null;

  const release = await yahooLimiter.acquire();
  try {
    for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { "User-Agent": UA },
          signal: AbortSignal.timeout(TIMEOUT),
        });
      } catch {
        // Network error/timeout: behave exactly as before — a plain miss, no
        // retry, no cooldown (transient/local issues aren't Yahoo rate-limiting).
        return null;
      }
      if (res.ok) return await res.json();
      if (res.status === 429 || res.status === 503) {
        if (attempt < RETRY_MAX) {
          await sleep(backoffDelayMs(attempt, res.headers.get("retry-after")));
          continue;
        }
        if (res.status === 429) {
          yahooCooldownUntil = Date.now() + COOLDOWN_MS;
        }
        return null;
      }
      // Any other non-ok status: behave exactly as before.
      return null;
    }
    return null;
  } finally {
    release();
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

/**
 * Resolve a query to a tradeable listing **and** its current price, requiring
 * the listing to have real recent history — not just a stale `regularMarketPrice`
 * (thin/illiquid lines expose a price but no trading). This keeps /api/quotes
 * and the cron consistent with /api/history: both settle on the same listing,
 * so the net-worth chart and the holdings table can never disagree. Prefers a
 * listing in `wantCurrency`; falls back to any listing with data (the caller
 * FX-converts). `hint` (a stored Yahoo symbol) is tried first.
 */
export async function resolveQuote(
  query: string,
  wantCurrency: string,
  hint?: string,
  // A secondary query (e.g. the asset's name) tried when `query` (the ISIN/
  // WKN) turns up no Yahoo search results at all.
  fallbackQuery?: string,
): Promise<{ symbol: string; currency: string; price: number } | null> {
  const want = (wantCurrency || "").toUpperCase();

  // Fast path: a previously-resolved listing (the stored quote_id) that still
  // has data and matches — skip search + ranking, the steady-state cost once
  // an instrument has been resolved once.
  if (hint) {
    const c = await chart(hint, "5d", "1d");
    if (c && c.points.length > 0 && (!want || c.currency === want)) {
      return { symbol: hint, currency: c.currency, price: c.points[c.points.length - 1].close };
    }
  }

  const resolutionKey = `${query.toUpperCase()}|${want}|${hint ?? ""}`;
  const negativeKey = `${query.toUpperCase()}|${want}`;

  // A cached resolution only remembers WHICH listing to use, never the price
  // itself — the price is always re-derived from chart() (itself TTL-cached,
  // so this still avoids a real network hit in the steady state while keeping
  // the price fresh within chart()'s own TTL).
  const cachedResolution = resolutionCache.get(resolutionKey);
  if (cachedResolution) {
    const c = await chart(cachedResolution.symbol, "5d", "1d");
    if (c && c.points.length > 0) {
      return {
        symbol: cachedResolution.symbol,
        currency: c.currency,
        price: c.points[c.points.length - 1].close,
      };
    }
    // Stale resolution (listing stopped returning data) — fall through and
    // re-resolve from scratch below.
  } else if (unresolvableCache.get(negativeKey)) {
    return null;
  }

  const candidates: string[] = [];
  if (hint) candidates.push(hint);
  for (const s of await searchCandidates(query, fallbackQuery)) {
    if (!candidates.includes(s)) candidates.push(s);
  }

  // Scan every candidate rather than stopping at the first currency match:
  // Yahoo's search-relevance order sometimes ranks a thin/duplicate listing
  // (near-zero volume — a fractional or barely-traded line) ahead of the real
  // one, so the most liquid same-currency listing is preferred instead.
  type Hit = { symbol: string; currency: string; price: number; volume: number };
  const hits: Hit[] = [];
  for (const s of candidates.slice(0, 8)) {
    // 5-day daily candles: a live listing yields recent closes; a thin/dead one
    // yields none and is skipped (this is what rejected the bogus 97.82 line).
    const c = await chart(s, "5d", "1d");
    if (!c || c.points.length === 0) continue;
    hits.push({ symbol: s, currency: c.currency, price: c.points[c.points.length - 1].close, volume: c.volume });
  }
  if (hits.length === 0) {
    unresolvableCache.set(negativeKey, true, NEGATIVE_TTL_MS);
    return null;
  }
  const matches = want ? hits.filter((h) => h.currency === want) : hits;
  const pool = matches.length > 0 ? matches : hits;
  pool.sort((a, b) => b.volume - a.volume);
  const best = pool[0];
  resolutionCache.set(resolutionKey, { symbol: best.symbol, currency: best.currency }, RESOLUTION_TTL_MS);
  return { symbol: best.symbol, currency: best.currency, price: best.price };
}

export interface AssetMatch {
  symbol: string;
  name: string;
  quoteType: string;
}

/** Search for an asset by ISIN or symbol (Yahoo doesn't index German WKNs). */
export async function searchAssets(query: string): Promise<AssetMatch[]> {
  const data = (await getJSON(
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`,
  )) as
    | { quotes?: Array<{ symbol?: string; longname?: string; shortname?: string; quoteType?: string }> }
    | null;
  return (data?.quotes ?? [])
    .filter((q) => q.symbol)
    .map((q) => ({
      symbol: q.symbol as string,
      name: q.longname || q.shortname || (q.symbol as string),
      quoteType: q.quoteType || "",
    }));
}

/** Trading currency for a symbol, or null. */
export async function currencyOf(symbol: string): Promise<string | null> {
  const m = await meta(symbol);
  return m ? m.currency : null;
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
  // When true, use Yahoo's adjusted close (dividends reinvested = total return),
  // so a distributing fund/index is comparable to an accumulating one.
  total = false,
): Promise<{ points: YahooPoint[]; currency: string; volume: number } | null> {
  const cacheKey = `${symbol}|${range}|${interval}|${total}`;
  const cached = chartCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const result = await chartUncached(symbol, range, interval, total);
  const ttl = SHORT_CHART_RANGES.has(range) ? CHART_SHORT_TTL_MS : CHART_LONG_TTL_MS;
  chartCache.set(cacheKey, result, ttl);
  return result;
}

async function chartUncached(
  symbol: string,
  range: string,
  interval: string,
  total: boolean,
): Promise<{ points: YahooPoint[]; currency: string; volume: number } | null> {
  const data = (await getJSON(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}${total ? "&events=div" : ""}`,
  )) as
    | {
        chart?: {
          result?: Array<{
            timestamp?: number[];
            indicators?: {
              quote?: Array<{ close?: (number | null)[] }>;
              adjclose?: Array<{ adjclose?: (number | null)[] }>;
            };
            meta?: { currency?: string; regularMarketVolume?: number };
          }>;
        };
      }
    | null;
  const result = data?.chart?.result?.[0];
  const ts = result?.timestamp;
  const close = result?.indicators?.quote?.[0]?.close;
  const adj = result?.indicators?.adjclose?.[0]?.adjclose;
  // Total-return wants adjusted close. Otherwise prefer raw close, but fall back
  // to adjclose — some listings (notably German mutual funds) report only an
  // adjclose array with a null `close`, which otherwise yields an empty series
  // and a blank chart.
  const series = total ? (adj ?? close) : (close ?? adj);
  if (!ts || !series) return null;
  const points: YahooPoint[] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = series[i];
    if (typeof c === "number" && c > 0) {
      points.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: c });
    }
  }
  if (points.length === 0) return null;
  return {
    points,
    currency: (result?.meta?.currency ?? "").toUpperCase(),
    volume: result?.meta?.regularMarketVolume ?? 0,
  };
}

// German broker/exchange security-name descriptors (share class, par value,
// registration form, ...) that Yahoo's search chokes on. The name is cut at
// the FIRST occurrence of any of these (case-insensitive), e.g.
// "ALPHABET INC.CL.A DL-,001" → "ALPHABET INC".
const NAME_NOISE = [
  ".CL",   // share class:      "INC.CL.A"
  " CL.",  // share class:      "INC CL.A"
  " DL-",  // par value (USD):  "DL-,001"
  " DL ",  // par value (USD):  "DL 0,001"
  " O.N",  // ohne Nennwert:    "BASF SE O.N."
  " INH",  // Inhaber-Aktien:   "… INH. O.N."
  " VZ",   // Vorzugsaktien:    "VOLKSWAGEN AG VZ"
  " ADR",  // depositary rcpts: "ALIBABA GR.HLDG ADR"
  " NAM.", // Namens-Aktien:    "… NAM. EO 1"
  " EO-",  // par value (EUR):  "EO-,10"
  ",",     // par-value tail:   "DL-,001"
  "/",     // ratio tail:       "ADR/8"
];

/**
 * Strip German exchange-descriptor noise from a broker CSV security name so
 * Yahoo search can match it: cut at the first noise marker, collapse
 * whitespace. Pure; exported for tests.
 */
export function normalizeSecurityName(name: string): string {
  const upper = name.toUpperCase();
  let cut = name.length;
  for (const p of NAME_NOISE) {
    const i = upper.indexOf(p);
    if (i > 0 && i < cut) cut = i;
  }
  return name.slice(0, cut).replace(/\s+/g, " ").trim();
}

/**
 * Yahoo symbols matching `query`. When it yields nothing and `fallbackQuery`
 * is given (e.g. the asset's name), retries with that — Yahoo's search index
 * doesn't cover every ISIN (observed for at least one real, listed security:
 * Alphabet's Class C ISIN US02079K3059 returns zero results by ISIN or WKN,
 * but resolves fine by company name). Broker CSV names carry German exchange
 * descriptors ("ALPHABET INC.CL.A DL-,001") that Yahoo also fails on, so the
 * fallback escalates: raw name → normalized name → its first two tokens.
 * Capped at three fallback attempts, each at least 3 characters long.
 */
async function searchCandidates(query: string, fallbackQuery?: string): Promise<string[]> {
  const cacheKey = `${query.toUpperCase()}|${(fallbackQuery ?? "").toUpperCase()}`;
  const cached = searchCandidatesCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const result = await searchCandidatesUncached(query, fallbackQuery);
  searchCandidatesCache.set(cacheKey, result, SEARCH_CANDIDATES_TTL_MS);
  return result;
}

async function searchCandidatesUncached(query: string, fallbackQuery?: string): Promise<string[]> {
  const search = async (q: string): Promise<string[]> => {
    const data = (await getJSON(
      `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=8&newsCount=0`,
    )) as { quotes?: Array<{ symbol?: string }> } | null;
    return (data?.quotes ?? []).map((s) => s.symbol).filter((s): s is string => !!s);
  };
  const primary = await search(query);
  if (primary.length > 0) return primary;

  // Fallback attempts, most specific first; dedupe, skip too-short/identical.
  const raw = fallbackQuery?.trim() ?? "";
  const normalized = normalizeSecurityName(raw);
  const tokens = normalized.split(" ");
  const attempts: string[] = [raw, normalized];
  if (tokens.length > 2) attempts.push(tokens.slice(0, 2).join(" "));

  const tried = new Set([query.toUpperCase()]);
  for (const attempt of attempts.slice(0, 3)) {
    if (attempt.length < 3 || tried.has(attempt.toUpperCase())) continue;
    tried.add(attempt.toUpperCase());
    const hits = await search(attempt);
    if (hits.length > 0) return hits;
  }
  return [];
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
  // Use total-return (adjusted close) — for benchmarks, so a distributing index
  // is comparable to an accumulating holding.
  total = false,
  // A secondary query (e.g. the asset's name) tried when `query` (the ISIN/
  // WKN) turns up no Yahoo search results at all.
  fallbackQuery?: string,
): Promise<{ points: YahooPoint[]; currency: string } | null> {
  const want = (wantCurrency || "").toUpperCase();

  // Fast path: the previously-resolved listing still has data and matches —
  // skip search + ranking (the steady-state cost once resolved once).
  if (hint) {
    const c = await chart(hint, range, interval, total);
    if (c && (!want || c.currency === want)) return c;
  }

  // Resolution caching is shared with resolveQuote: both pick "the best
  // listing for this query/currency" the same way, just at different chart
  // granularities, so once either has resolved a query the other reuses it —
  // skipping search + candidate scanning — and only re-fetches the chart
  // (itself TTL-cached) at its own requested range/interval.
  const resolutionKey = `${query.toUpperCase()}|${want}|${hint ?? ""}`;
  const negativeKey = `${query.toUpperCase()}|${want}`;

  const cachedResolution = resolutionCache.get(resolutionKey);
  if (cachedResolution) {
    const c = await chart(cachedResolution.symbol, range, interval, total);
    if (c) return c;
    // Stale resolution — fall through and re-resolve from scratch below.
  } else if (unresolvableCache.get(negativeKey)) {
    return null;
  }

  const candidates: string[] = [];
  if (hint) candidates.push(hint);
  for (const s of await searchCandidates(query, fallbackQuery)) {
    if (!candidates.includes(s)) candidates.push(s);
  }

  // Scan every candidate rather than stopping at the first currency match —
  // same reasoning as resolveQuote: prefer the most liquid same-currency
  // listing so quotes and history never settle on different lines.
  type Hit = {
    symbol: string;
    currency: string;
    volume: number;
    series: { points: YahooPoint[]; currency: string };
  };
  const hits: Hit[] = [];
  for (const s of candidates.slice(0, 5)) {
    if (s === hint) continue; // already checked on the fast path above
    const c = await chart(s, range, interval, total);
    if (!c) continue;
    hits.push({ symbol: s, currency: c.currency, volume: c.volume, series: c });
  }
  if (hits.length === 0) {
    unresolvableCache.set(negativeKey, true, NEGATIVE_TTL_MS);
    return null;
  }
  const matches = want ? hits.filter((h) => h.currency === want) : hits;
  const pool = matches.length > 0 ? matches : hits;
  pool.sort((a, b) => b.volume - a.volume);
  const best = pool[0];
  resolutionCache.set(resolutionKey, { symbol: best.symbol, currency: best.currency }, RESOLUTION_TTL_MS);
  return best.series;
}

export interface DividendEvent {
  date: string;
  amount: number;
}

/** Dividend events for a symbol + the listing currency (empty array when the
 *  listing pays none, e.g. an accumulating ETF). null if the symbol has no data. */
async function dividendChart(
  symbol: string,
  range: string,
): Promise<{ events: DividendEvent[]; currency: string } | null> {
  const data = (await getJSON(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d&events=div`,
  )) as
    | {
        chart?: {
          result?: Array<{
            meta?: { currency?: string };
            events?: { dividends?: Record<string, { amount?: number; date?: number }> };
          }>;
        };
      }
    | null;
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const currency = (result.meta?.currency ?? "").toUpperCase();
  const divs = result.events?.dividends ?? {};
  const events: DividendEvent[] = [];
  for (const d of Object.values(divs)) {
    if (typeof d.amount === "number" && d.amount > 0 && typeof d.date === "number") {
      events.push({ date: new Date(d.date * 1000).toISOString().slice(0, 10), amount: d.amount });
    }
  }
  events.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { events, currency };
}

/**
 * Dividend events for a query (ISIN/symbol), preferring a listing in
 * `wantCurrency`. An accumulating fund resolves to a listing with an empty
 * event list (no payouts) — distinct from "no listing found" (null). The caller
 * FX-converts when the listing currency differs.
 */
export async function dividendsByQuery(
  query: string,
  wantCurrency: string,
  hint: string | undefined,
  range: string,
  // A secondary query (e.g. the asset's name) tried when `query` (the ISIN/
  // WKN) turns up no Yahoo search results at all.
  fallbackQuery?: string,
): Promise<{ events: DividendEvent[]; currency: string } | null> {
  const want = (wantCurrency || "").toUpperCase();
  const candidates: string[] = [];
  if (hint) candidates.push(hint);
  for (const s of await searchCandidates(query, fallbackQuery)) {
    if (!candidates.includes(s)) candidates.push(s);
  }

  let fallback: { events: DividendEvent[]; currency: string } | null = null;
  for (const s of candidates.slice(0, 5)) {
    const c = await dividendChart(s, range);
    if (!c) continue;
    // Prefer a currency-matching listing that actually has events; otherwise
    // remember it (covers accumulating funds, which legitimately have none).
    if ((!want || c.currency === want) && c.events.length > 0) return c;
    if (!fallback) fallback = c;
  }
  return fallback;
}

/**
 * Test-only: reset module-level caches + the circuit breaker between tests so
 * one test's mocked-fetch state can't leak into the next (this module's
 * throttle/cache/breaker state is otherwise deliberately long-lived across
 * calls within a warm instance). Not used by production code.
 */
export function __resetForTests(): void {
  chartCache.clear();
  searchCandidatesCache.clear();
  resolutionCache.clear();
  unresolvableCache.clear();
  symbolCache.clear();
  yahooCooldownUntil = 0;
}
