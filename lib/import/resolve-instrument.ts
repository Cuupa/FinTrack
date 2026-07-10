// Shared instrument resolution: given a free-text query (ISIN/WKN/symbol),
// resolve master data the same way everywhere it's needed — the local catalog
// first (synchronous, unthrottled), then the live /api/lookup route (resolves
// any ISIN/symbol via Yahoo). Used by the add-asset form, the watchlist "add"
// flow (components/dashboard/watchlist-card.tsx) and the savings-plan inline
// "add asset" flow (components/dashboard/savings-plans-card.tsx), which
// previously each carried a near-identical copy of this logic.

import { apiFetch } from "../api";
import { lookupInstrument, type Instrument } from "../catalog/catalog";
import type { AssetType } from "../types";

/** Master data resolved for a new asset/watchlist item, independent of source. */
export interface ResolvedMaster {
  isin: string | null;
  wkn: string | null;
  symbol: string | null;
  name: string;
  type: AssetType;
  currency: string | null;
}

/** Shape of a successful/failed /api/lookup response. */
export interface ApiMatch {
  found: boolean;
  name?: string;
  symbol?: string | null;
  type?: AssetType;
  currency?: string | null;
  isin?: string | null;
  wkn?: string | null;
}

/** Master data from a catalog hit — every field passes through unchanged. */
export function masterFromInstrument(i: Instrument): ResolvedMaster {
  return {
    isin: i.isin,
    wkn: i.wkn,
    symbol: i.symbol,
    name: i.name,
    type: i.type,
    currency: i.currency,
  };
}

/**
 * Master data from a live /api/lookup match; null when the lookup found
 * nothing or came back without a name (nothing usable to import). The type
 * defaults to "STOCK" when the match itself carries no type.
 */
export function masterFromApiMatch(d: ApiMatch): ResolvedMaster | null {
  if (!d.found || !d.name) return null;
  return {
    isin: d.isin ?? null,
    wkn: d.wkn ?? null,
    symbol: d.symbol ?? null,
    name: d.name,
    type: d.type ?? "STOCK",
    currency: d.currency ?? null,
  };
}

/**
 * Resolve a free-text identifier (ISIN/WKN/symbol) to master data: the local
 * catalog first, then the live /api/lookup route. Returns null when nothing
 * matches (or the query is blank).
 */
export async function resolveInstrumentByQuery(query: string): Promise<ResolvedMaster | null> {
  const q = query.trim().toUpperCase();
  if (!q) return null;
  const hit = lookupInstrument(q);
  if (hit) return masterFromInstrument(hit);
  const res = await apiFetch(`/api/lookup?q=${encodeURIComponent(q)}`);
  const data = (res.ok ? await res.json() : { found: false }) as ApiMatch;
  return masterFromApiMatch(data);
}
