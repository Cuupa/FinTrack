// Resolve official instrument names (and, when known, the real asset type)
// for a set of identifiers (ISIN/WKN/symbol), so imported CSV rows and
// existing assets can show accurate data instead of whatever a broker export
// happened to print. Tries the in-memory catalog first (synchronous,
// unthrottled); identifiers the catalog misses fall back to the live
// /api/lookup route in throttled batches. Shared by the CSV import flow
// (components/assets/import-transactions.tsx) and the "update names to
// official instrument names" action (components/assets/asset-table.tsx).

import { apiFetch } from "../api";
import { lookupInstrumentByQuery } from "../finance/prices";
import type { Asset, AssetType } from "../types";

export interface ResolvedInstrument {
  name?: string;
  /** Only set when the lookup returned a concrete, known type. */
  type?: AssetType;
}

/** /api/lookup requests are throttled to this many concurrent in-flight
 *  calls: Yahoo (the resolver behind it) rate-limits large bursts, which a
 *  ~30-identifier batch would otherwise fire all at once. */
const LOOKUP_BATCH_SIZE = 4;

/**
 * Resolve the official instrument name + type for every identifier given.
 * Identifiers should already be normalized (uppercased) by the caller — this
 * function does no further normalization, just lookup + batching.
 */
export async function resolveOfficialNames(
  identifiers: string[],
): Promise<Map<string, ResolvedInstrument>> {
  const ids = new Set(identifiers.filter(Boolean));
  const resolved = new Map<string, ResolvedInstrument>();
  const remaining: string[] = [];
  for (const id of ids) {
    const match = lookupInstrumentByQuery(id);
    if (match?.name) {
      resolved.set(id, { name: match.name, type: match.type });
    } else {
      remaining.push(id);
    }
  }
  for (let i = 0; i < remaining.length; i += LOOKUP_BATCH_SIZE) {
    const batch = remaining.slice(i, i + LOOKUP_BATCH_SIZE);
    await Promise.all(
      batch.map(async (id) => {
        try {
          const res = await apiFetch(`/api/lookup?q=${encodeURIComponent(id)}`);
          if (!res.ok) return;
          const d = (await res.json()) as { found?: boolean; name?: string; type?: AssetType };
          if (d.found) resolved.set(id, { name: d.name, type: d.type });
        } catch {
          /* live lookup failed — this identifier just stays unresolved */
        }
      }),
    );
  }
  return resolved;
}

/** A rename candidate surfaced by {@link officialNameRenames}. */
export interface RenameCandidate {
  asset: Asset;
  officialName: string;
}

/** The identifier an asset is looked up by — isin, then wkn, then symbol.
 *  Unlike `assetPriceKey` this has no name fallback: an asset with none of
 *  these can't be resolved against the catalog/lookup, so it's skipped. */
function assetLookupKey(asset: Asset): string {
  return (asset.isin || asset.wkn || asset.symbol || "").toUpperCase();
}

/**
 * Pure diff: given the current assets and a resolved-name map (as returned by
 * {@link resolveOfficialNames}), return the assets whose name should be
 * updated to the official instrument name — CASH (no instrument identity),
 * assets with no ISIN/WKN/symbol, and assets with no resolved name are all
 * skipped, as are assets whose resolved name (after trimming) already
 * matches the current name.
 */
export function officialNameRenames(
  assets: Asset[],
  resolved: Map<string, ResolvedInstrument>,
): RenameCandidate[] {
  const out: RenameCandidate[] = [];
  for (const asset of assets) {
    if (asset.type === "CASH") continue;
    const key = assetLookupKey(asset);
    if (!key) continue;
    const officialName = resolved.get(key)?.name?.trim();
    if (!officialName) continue;
    if (officialName === asset.name) continue;
    out.push({ asset, officialName });
  }
  return out;
}
