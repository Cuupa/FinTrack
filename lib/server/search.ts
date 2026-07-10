// Multi-source instrument search: fans out to Yahoo + onvista, merges/dedupes
// the hits into one ranked list, and picks the single best match. See
// SEARCH_DESIGN.md for the design this implements (§3 in particular).
//
// Server-only. Each source adapter never throws — a slow/dead source simply
// contributes no hits, so `/api/lookup` degrades to whichever sources
// responded (Yahoo-alone behaviour if onvista is down, and vice-versa).

import { currencyOf, isISIN, searchAssets } from "./yahoo";
import { searchOnvista } from "./onvista";

// "db" is reserved for a future third source (e.g. a persisted catalog
// lookup) — not wired yet, see SEARCH_DESIGN.md §2/§8.
export type SourceId = "yahoo" | "onvista" | "db";

export interface InstrumentHit {
  isin: string | null;
  wkn: string | null;
  /** Provider ticker — for Yahoo hits this is the quote/history symbol; for
   *  onvista it is NOT a Yahoo symbol and must never be fed to Yahoo. */
  symbol: string | null;
  name: string;
  /** null = unsupported type (e.g. BOND) — the hit is dropped, never surfaced. */
  type: "STOCK" | "ETF" | "CRYPTO" | "COMMODITY" | null;
  /** Best-effort trading currency (Yahoo only; onvista doesn't return one). */
  currency: string | null;
  source: SourceId;
}

const PER_SOURCE_TIMEOUT = 4000;

/**
 * Resolve to `v` (or `[]` if `p` hasn't settled) after `ms` — never rejects.
 * Used to bound each source's contribution to the fan-out so one slow/dead
 * source can't hold up the whole lookup. Pure apart from the timer.
 */
export function withTimeout<T>(p: Promise<T[]>, ms: number): Promise<T[]> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve([]), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve([]);
      },
    );
  });
}

const YAHOO_TYPE_MAP: Record<string, InstrumentHit["type"]> = {
  EQUITY: "STOCK",
  ETF: "ETF",
  MUTUALFUND: "ETF",
  CRYPTOCURRENCY: "CRYPTO",
  // NOTE: quoteType "FUTURE" is deliberately NOT mapped to COMMODITY here.
  // Yahoo's free-text search for a bare metal ticker (e.g. "XAU") can match
  // an unrelated futures contract (observed: "XAU=F", an E-mini Utilities
  // Select Sector future, not gold) just as easily as the intended precious-
  // metal future (GC=F, SI=F, ...) — quoteType alone can't tell them apart.
  // Mapping FUTURE -> COMMODITY here made such mismatches carry the same
  // type as an authoritative COMMODITY import row, defeating the type-
  // mismatch guard in applyResolvedInstrument (lib/import/resolve-names.ts)
  // and corrupting the row's name with the wrong instrument. Verified live
  // against /api/lookup?q=XAU during the Bitpanda-gold-import fix. Until
  // lookup can disambiguate futures reliably (e.g. by identifier match, not
  // free-text symbol search), FUTURE hits stay type null (dropped) like BOND.
};

/**
 * Yahoo adapter: wraps the existing `searchAssets()` and best-effort-attaches
 * the trading currency for each recognised-type match (skips currencyOf for
 * hits whose type isn't in `YAHOO_TYPE_MAP` — they're dropped anyway). Never
 * throws — network failures resolve to `[]`.
 */
export async function searchYahoo(query: string): Promise<InstrumentHit[]> {
  const matches = await searchAssets(query).catch(() => []);
  const isin = isISIN(query.trim()) ? query.trim().toUpperCase() : null;
  const hits = await Promise.all(
    matches.map(async (m) => {
      const type = YAHOO_TYPE_MAP[m.quoteType] ?? null;
      if (!type) return null;
      const currency = await currencyOf(m.symbol).catch(() => null);
      const result: InstrumentHit = {
        isin,
        wkn: null,
        symbol: m.symbol.split(".")[0].toUpperCase(),
        name: m.name,
        type,
        currency,
        source: "yahoo",
      };
      return result;
    }),
  );
  return hits.filter((h): h is InstrumentHit => h !== null);
}

/** Uppercased, punctuation-collapsed name — used only as a dedupe fallback
 *  when neither ISIN nor WKN is available (crypto). */
function normalizedNameKey(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim();
}

function dedupeKey(hit: InstrumentHit): string {
  if (hit.isin) return `isin:${hit.isin.toUpperCase()}`;
  if (hit.wkn) return `wkn:${hit.wkn.toUpperCase()}`;
  return `name:${normalizedNameKey(hit.name)}:${hit.type ?? ""}`;
}

/**
 * Merge two hits identified as the same instrument, per SEARCH_DESIGN.md §3's
 * field precedence: onvista wins wkn/isin/name (the German source with
 * cleaner official names and the only one with WKNs); Yahoo wins
 * symbol/currency (it's the quote/history provider — onvista's symbol isn't
 * a Yahoo ticker); type prefers onvista's (richer for German lines) else
 * Yahoo's.
 */
function mergeTwo(a: InstrumentHit, b: InstrumentHit): InstrumentHit {
  const onvista = a.source === "onvista" ? a : b.source === "onvista" ? b : null;
  const yahoo = a.source === "yahoo" ? a : b.source === "yahoo" ? b : null;
  return {
    isin: onvista?.isin ?? a.isin ?? b.isin,
    wkn: onvista?.wkn ?? a.wkn ?? b.wkn,
    symbol: yahoo?.symbol ?? a.symbol ?? b.symbol,
    name: onvista?.name ?? a.name,
    type: onvista?.type ?? yahoo?.type ?? a.type ?? b.type,
    currency: yahoo?.currency ?? a.currency ?? b.currency,
    source: onvista?.source ?? a.source,
  };
}

/**
 * Merge + dedupe hits from every source into one list, one entry per
 * instrument. Dedupe identity: same ISIN, else same WKN, else same
 * normalized name+type (the crypto fallback — no ISIN/WKN). Pure; exported
 * for tests.
 */
export function mergeHits(hits: InstrumentHit[]): InstrumentHit[] {
  const byKey = new Map<string, InstrumentHit>();
  for (const hit of hits) {
    const key = dedupeKey(hit);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergeTwo(existing, hit) : hit);
  }
  return Array.from(byKey.values());
}

/** Query shaped like a WKN (6 alnum chars, not itself an ISIN). */
function looksLikeWkn(query: string): boolean {
  const q = query.trim().toUpperCase();
  return /^[A-Z0-9]{6}$/.test(q) && !isISIN(q);
}

function isIdentifierMatch(query: string, hit: InstrumentHit): boolean {
  const q = query.trim().toUpperCase();
  return hit.isin === q || hit.wkn === q || hit.symbol === q;
}

/**
 * Rank the merged list and return the single best hit (or null when empty).
 * Order: (a) exact identifier match (query equals isin/wkn/symbol,
 * case-insensitive) first; (b) hits with a recognized type only — an
 * unsupported type (null, e.g. BOND) is filtered out entirely, never
 * surfaced; (c) tie-break by source priority — onvista before yahoo for
 * WKN/ISIN-shaped queries (onvista is the one that resolves those), yahoo
 * before onvista otherwise. Pure; exported for tests.
 */
export function pickBest(query: string, merged: InstrumentHit[]): InstrumentHit | null {
  const candidates = merged.filter((h) => h.type !== null);
  if (candidates.length === 0) return null;

  const q = query.trim().toUpperCase();
  const isIdentifierQuery = isISIN(q) || looksLikeWkn(q);
  const sourcePriority = (s: SourceId): number =>
    isIdentifierQuery ? (s === "onvista" ? 0 : 1) : s === "yahoo" ? 0 : 1;

  const ranked = [...candidates].sort((a, b) => {
    const aExact = isIdentifierMatch(query, a) ? 0 : 1;
    const bExact = isIdentifierMatch(query, b) ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;
    return sourcePriority(a.source) - sourcePriority(b.source);
  });
  return ranked[0];
}

/**
 * Fan out `query` to every source with a per-source timeout, merge + dedupe
 * the results. Each adapter already catches its own errors; `Promise.allSettled`
 * is an extra guard so a rejection can never take down the whole lookup.
 */
export async function searchInstruments(query: string): Promise<InstrumentHit[]> {
  const results = await Promise.allSettled([
    withTimeout(searchYahoo(query), PER_SOURCE_TIMEOUT),
    withTimeout(searchOnvista(query), PER_SOURCE_TIMEOUT),
  ]);
  const hits = results.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  return mergeHits(hits);
}
