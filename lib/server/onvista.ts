// Onvista instrument search + pricing — keyless, resolves German WKNs (which
// Yahoo's search index doesn't cover), plus ISINs, names and crypto, and
// prices instruments Yahoo can't resolve at all (German structured products /
// certificates, LU-domiciled mutual funds). Server-only; mirrors
// lib/server/yahoo.ts's fetch/timeout/cache patterns. See SEARCH_DESIGN.md §2
// for the source research and §7 for the design this implements; the pricing
// fallback is round-19 (Onvista as a quote/history fallback behind Yahoo).
//
// Endpoints (all keyless, browser User-Agent required, no cookies):
//   GET /api/v1/instruments/query?searchValue=<q>&limit=<n>
//     { expires, searchValue, list: [ Hit... ] } — used both for search-UI
//     hits (searchOnvista/mapOnvistaHits) and pricing resolution
//     (resolveOnvistaInstrument).
//   GET /api/v1/instruments/{entityType}/{entityValue}/snapshot
//     { quote: { last, isoCurrency, ... }, ... } — current price.
//   GET /api/v1/instruments/{entityType}/{entityValue}/eod_history?range=<r>
//     Parallel arrays (datetimeLast unix seconds, first/last/high/low/volume)
//     — historical daily closes. `range` is REQUIRED (a request with none
//     404s with "Range must not be empty"); accepted tokens include
//     D1/W1/M1/M3/M6/Y1/Y3/Y5/Y10/MAX (Y2 errors — not every token is valid,
//     these are the ones empirically confirmed). Empirically, this
//     unauthenticated endpoint caps the returned series at roughly the last
//     month of daily bars (~17-21 points) REGARDLESS of the requested range
//     or of startDate/endDate — M3 and MAX return the identical points as M1
//     for every instrument probed (STOCK/FUND/DERIVATIVE), even though
//     `datetimeStartAvailableHistory` in the same response reports data back
//     to 2007. The response's `Vary: X-ov-token` header points at why: full
//     history needs an auth token we don't have. A short real series still
//     beats none (the app's chart falls back to synthetic beyond it), so this
//     is accepted as-is rather than worked around.
//   /chart_history is 403 (AGB/session-protected) — NEVER use it here.

import type { InstrumentHit } from "./search";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const TIMEOUT = 4000;
const LIMIT = 5;

interface OnvistaHit {
  entityType?: string;
  entitySubType?: string;
  name?: string;
  isin?: string;
  wkn?: string;
  symbol?: string;
  /** Numeric instrument id, used by the snapshot/eod_history endpoints. */
  entityValue?: string;
}

interface OnvistaResponse {
  expires?: number;
  list?: OnvistaHit[];
}

/**
 * Map onvista's `entityType`/`entitySubType` taxonomy to the app's asset
 * type. `null` = unsupported (e.g. BOND) — the caller drops the hit. Pure;
 * exported for tests.
 */
export function mapOnvistaType(
  entityType: string | undefined,
  // Kept for API parity with onvista's actual taxonomy (a FUND's ETF-ness
  // lives here) even though every FUND currently maps to ETF regardless —
  // see the comment below.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  entitySubType: string | undefined,
): InstrumentHit["type"] {
  switch (entityType) {
    case "STOCK":
      return "STOCK";
    case "FUND":
      // The app has no separate mutual-fund type — both a plain FUND and an
      // entitySubType==="ETF" fund map to ETF (matches Yahoo's
      // MUTUALFUND→ETF mapping).
      return "ETF";
    case "CRYPTO":
      return "CRYPTO";
    default:
      // Anything else (BOND, ...) is unsupported and dropped by the caller.
      return null;
  }
}

/**
 * Map a raw onvista search response into the common hit shape, dropping
 * hits with an unsupported type or no name. Pure; exported for tests.
 *
 * Crypto entries carry onvista's own synthetic "ISIN"/WKN-shaped tracking
 * ids (e.g. Bitcoin → isin "XC000A2YY636", wkn "A2YY63") rather than real
 * security identifiers — feeding those through as `isin`/`wkn` would make
 * `assetPriceKey` (isin ?? wkn ?? symbol) key crypto pricing off a value no
 * price provider recognizes, instead of the symbol (e.g. "BTC") the app's
 * synthetic registry / CoinGecko catalog actually expects. So both are
 * nulled out for CRYPTO hits; only `name`/`symbol` (when present) carry over.
 */
export function mapOnvistaHits(json: unknown): InstrumentHit[] {
  const list = (json as OnvistaResponse | null | undefined)?.list ?? [];
  const hits: InstrumentHit[] = [];
  for (const h of list) {
    const type = mapOnvistaType(h.entityType, h.entitySubType);
    if (!type) continue;
    const name = (h.name ?? "").trim();
    if (!name) continue;
    const isCrypto = type === "CRYPTO";
    hits.push({
      isin: !isCrypto && h.isin ? h.isin.toUpperCase() : null,
      wkn: !isCrypto && h.wkn ? h.wkn.toUpperCase() : null,
      symbol: h.symbol ? h.symbol.toUpperCase() : null,
      name,
      type,
      currency: null, // onvista doesn't report the trading currency
      source: "onvista",
    });
  }
  return hits;
}

const CACHE_TTL = 5 * 60_000; // fallback when the response has no usable `expires`
const cache = new Map<string, { hits: InstrumentHit[]; expires: number }>();

/** Interpret onvista's `expires` (observed as a unix timestamp; tolerate
 *  either seconds or milliseconds) — falls back to a fixed TTL if missing,
 *  non-numeric, or already in the past. */
function resolveExpiry(raw: unknown): number {
  if (typeof raw === "number" && raw > 0) {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    if (ms > Date.now()) return ms;
  }
  return Date.now() + CACHE_TTL;
}

/**
 * Search onvista for `query` (name, WKN, ISIN, or free text). Never throws —
 * network/parse failures resolve to `[]`, same containment posture as the
 * existing Yahoo adapter. Small TTL cache keyed by the uppercased query,
 * honoring the response's own `expires` when present.
 */
export async function searchOnvista(query: string): Promise<InstrumentHit[]> {
  const key = query.trim().toUpperCase();
  if (!key) return [];

  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.hits;

  try {
    const res = await fetch(
      `https://api.onvista.de/api/v1/instruments/query?searchValue=${encodeURIComponent(query)}&limit=${LIMIT}`,
      {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(TIMEOUT),
      },
    );
    if (!res.ok) return [];
    const json = (await res.json()) as OnvistaResponse;
    const hits = mapOnvistaHits(json);
    cache.set(key, { hits, expires: resolveExpiry(json.expires) });
    return hits;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Pricing fallback (round 19): resolve a query straight to a priceable
// onvista instrument, then quote/history it by (entityType, entityValue).
// Distinct from mapOnvistaHits/searchOnvista above (search-UI, which drops
// unsupported entityTypes like DERIVATIVE/BOND and never carries entityValue)
// — this path accepts ANY entityType with a numeric entityValue, since a
// German knock-out certificate or ETC is exactly what Yahoo can't resolve.
// ---------------------------------------------------------------------------

export interface OnvistaInstrumentRef {
  entityType: string;
  entityValue: string;
  name: string;
  isin: string | null;
  wkn: string | null;
}

const NUMERIC_ID_RE = /^[0-9]+$/;

const resolveCache = new Map<string, { ref: OnvistaInstrumentRef | null; expires: number }>();
const RESOLVE_NEGATIVE_TTL = 5 * 60_000;

/**
 * Resolve `query` (ISIN or WKN) to the priceable onvista instrument matching
 * it EXACTLY — the first search hit whose isin OR wkn equals the uppercased
 * query, requiring a numeric entityValue (the id snapshot/eod_history need).
 * `null` when nothing matches exactly, the query is empty, or the request
 * fails. Never throws. TTL-cached by query (positive results per the
 * response's own `expires`, negative results briefly) so a Yahoo-miss on a
 * hot path doesn't re-search onvista every call.
 */
export async function resolveOnvistaInstrument(query: string): Promise<OnvistaInstrumentRef | null> {
  const key = query.trim().toUpperCase();
  if (!key) return null;

  const cached = resolveCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.ref;

  try {
    const res = await fetch(
      `https://api.onvista.de/api/v1/instruments/query?searchValue=${encodeURIComponent(query)}&limit=${LIMIT}`,
      {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(TIMEOUT),
      },
    );
    if (!res.ok) {
      resolveCache.set(key, { ref: null, expires: Date.now() + RESOLVE_NEGATIVE_TTL });
      return null;
    }
    const json = (await res.json()) as OnvistaResponse;
    const list = json.list ?? [];
    const hit = list.find(
      (h) =>
        !!h.entityType &&
        !!h.entityValue &&
        NUMERIC_ID_RE.test(h.entityValue) &&
        ((h.isin ?? "").toUpperCase() === key || (h.wkn ?? "").toUpperCase() === key),
    );
    const ref: OnvistaInstrumentRef | null = hit
      ? {
          entityType: hit.entityType as string,
          entityValue: hit.entityValue as string,
          name: (hit.name ?? "").trim(),
          isin: hit.isin ? hit.isin.toUpperCase() : null,
          wkn: hit.wkn ? hit.wkn.toUpperCase() : null,
        }
      : null;
    const expires = ref ? resolveExpiry(json.expires) : Date.now() + RESOLVE_NEGATIVE_TTL;
    resolveCache.set(key, { ref, expires });
    return ref;
  } catch {
    // Network error/timeout: don't cache — same containment posture as the
    // rest of this module (transient failures shouldn't poison the cache).
    return null;
  }
}

/** `"{entityType}:{entityValue}"` — the value stored in instruments.quote_id
 *  for onvista-sourced rows. Pure; exported for tests. */
export function encodeOnvistaQuoteId(entityType: string, entityValue: string): string {
  return `${entityType}:${entityValue}`;
}

/** Inverse of encodeOnvistaQuoteId. `null` for anything malformed (missing
 *  colon, empty half, or a non-numeric entityValue). Pure; exported for
 *  tests. */
export function parseOnvistaQuoteId(
  quoteId: string,
): { entityType: string; entityValue: string } | null {
  const i = quoteId.indexOf(":");
  if (i <= 0 || i === quoteId.length - 1) return null;
  const entityType = quoteId.slice(0, i);
  const entityValue = quoteId.slice(i + 1);
  if (!NUMERIC_ID_RE.test(entityValue)) return null;
  return { entityType, entityValue };
}

interface OnvistaSnapshotResponse {
  quote?: { last?: number; isoCurrency?: string };
}

const quoteCache = new Map<
  string,
  { value: { price: number; currency: string } | null; expires: number }
>();
const QUOTE_TTL = 5 * 60_000;

/**
 * Current price for a resolved onvista instrument (native currency). `null`
 * on a missing/invalid/non-positive price or a failed request. Never throws.
 * TTL-cached ~5min keyed by `entityType:entityValue` (negative results
 * cached too, so a dead id doesn't get re-hit every cron tick).
 */
export async function onvistaQuote(
  entityType: string,
  entityValue: string,
): Promise<{ price: number; currency: string } | null> {
  const key = `${entityType}:${entityValue}`;
  const cached = quoteCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  try {
    const res = await fetch(
      `https://api.onvista.de/api/v1/instruments/${encodeURIComponent(entityType)}/${encodeURIComponent(entityValue)}/snapshot`,
      {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(TIMEOUT),
      },
    );
    if (!res.ok) {
      quoteCache.set(key, { value: null, expires: Date.now() + QUOTE_TTL });
      return null;
    }
    const json = (await res.json()) as OnvistaSnapshotResponse;
    const last = json.quote?.last;
    const currency = (json.quote?.isoCurrency ?? "").toUpperCase();
    const value =
      typeof last === "number" && Number.isFinite(last) && last > 0 && currency
        ? { price: last, currency }
        : null;
    quoteCache.set(key, { value, expires: Date.now() + QUOTE_TTL });
    return value;
  } catch {
    return null;
  }
}

export interface OnvistaPoint {
  date: string;
  close: number;
}

// app range -> onvista `range` token. Mapped per app timeframe (rather than
// e.g. always requesting MAX) so a future loosening of onvista's anonymous
// cap keeps returning the semantically-right window instead of silently
// over/under-fetching; today every token >= M1 returns the identical capped
// ~1-month series regardless (see the module comment above).
const ONVISTA_RANGE: Record<string, string> = {
  "1W": "W1",
  "1M": "M1",
  "3M": "M3",
  YTD: "Y1",
  "1Y": "Y1",
  "5Y": "Y5",
  "10Y": "Y10",
  MAX: "MAX",
};

interface OnvistaEodHistoryResponse {
  datetimeLast?: number[];
  last?: (number | null)[];
  isoCurrency?: string;
}

/**
 * Historical daily closes for a resolved onvista instrument over the app's
 * `range` (see RANGE in app/api/history/route.ts). `null` when the request
 * fails or yields no usable points. Points with a null/non-finite/non-positive
 * close are skipped (present in the parallel arrays for non-trading days).
 * Dates are derived from `datetimeLast` (unix seconds, UTC day). No caching
 * here — the caller (app/api/history/route.ts) already wraps every provider
 * behind the DB-backed instrument_history cache.
 */
export async function onvistaEodHistory(
  entityType: string,
  entityValue: string,
  appRange: string,
): Promise<{ points: OnvistaPoint[]; currency: string } | null> {
  const range = ONVISTA_RANGE[appRange] ?? "MAX";
  try {
    const res = await fetch(
      `https://api.onvista.de/api/v1/instruments/${encodeURIComponent(entityType)}/${encodeURIComponent(entityValue)}/eod_history?range=${range}`,
      {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(TIMEOUT),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as OnvistaEodHistoryResponse;
    const ts = json.datetimeLast;
    const closes = json.last;
    const currency = (json.isoCurrency ?? "").toUpperCase();
    if (!ts || !closes || !currency) return null;

    const points: OnvistaPoint[] = [];
    for (let i = 0; i < ts.length; i++) {
      const c = closes[i];
      if (typeof c === "number" && Number.isFinite(c) && c > 0) {
        points.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), close: c });
      }
    }
    if (points.length === 0) return null;
    return { points, currency };
  } catch {
    return null;
  }
}

/**
 * Test-only: reset module-level caches between tests so one test's mocked-
 * fetch state can't leak into the next (mirrors lib/server/yahoo.ts's
 * __resetForTests). Not used by production code.
 */
export function __resetForTests(): void {
  cache.clear();
  resolveCache.clear();
  quoteCache.clear();
}
