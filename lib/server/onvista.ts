// Onvista instrument search — keyless, resolves German WKNs (which Yahoo's
// search index doesn't cover), plus ISINs, names and crypto. Server-only;
// mirrors lib/server/yahoo.ts's fetch/timeout/cache patterns. See
// SEARCH_DESIGN.md §2 for the source research and §7 for the design this
// implements.
//
// GET https://api.onvista.de/api/v1/instruments/query?searchValue=<q>&limit=<n>
// No auth/cookies needed, a normal browser User-Agent is enough. Response:
// { expires, searchValue, list: [ Hit... ] }.

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
