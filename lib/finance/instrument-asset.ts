// Pure helpers to render a watchlist item or catalog instrument through the
// same AssetDetail UI used for a held asset, without ever holding it. Both
// helpers synthesize an Asset with a sentinel id (`wl:`/`cat:` prefix) that
// never collides with a real asset id, so `transactionsByAsset` (which
// filters by `asset.id`) naturally returns [] for them — no held position,
// no transactions, just master data + price.

import type { Instrument } from "../catalog/catalog";
import type { AssetInput } from "../store/types";
import { assetPriceKey, type Asset, type WatchlistItem } from "../types";

/** Render a watchlist item (followed, not held) as an Asset for AssetDetail. */
export function watchlistItemToAsset(w: WatchlistItem): Asset {
  return {
    id: `wl:${w.id}`,
    isin: w.isin,
    wkn: w.wkn,
    symbol: w.symbol,
    name: w.name,
    type: w.type,
    currency: w.currency,
    notes: null,
  };
}

/** Render a catalog instrument (neither held nor watched) as an Asset for
 * AssetDetail. The id embeds the instrument's price key, so a later lookup
 * by that same key (e.g. once the user adds it) resolves consistently. */
export function instrumentToAsset(i: Instrument): Asset {
  const key = assetPriceKey({ isin: i.isin, wkn: i.wkn, symbol: i.symbol, name: i.name });
  return {
    id: `cat:${key}`,
    isin: i.isin,
    wkn: i.wkn,
    symbol: i.symbol,
    name: i.name,
    type: i.type,
    currency: i.currency,
    notes: null,
  };
}

/**
 * The instrument detail view has one layout regardless of whether the asset
 * is held: a transaction booked against a not-(yet-)held instrument (sentinel
 * `wl:`/`cat:` id) is what turns it into a holding. This strips the sentinel
 * id from the synthesized asset, yielding the `AssetInput` to create it as a
 * real held asset on the first submitted transaction. Pure — the caller
 * performs the actual `addAsset()` call.
 */
export function assetInputFromInstrumentAsset(asset: Asset): AssetInput {
  const { isin, wkn, symbol, name, type, currency, notes } = asset;
  return { isin, wkn, symbol, name, type, currency, notes };
}

/**
 * Resolves the real asset to book a transaction against for a
 * not-(yet-)held instrument: reuses an existing asset that shares the same
 * price key (mirrors the savings-plan inline "new asset" dedup in
 * components/dashboard/savings-plans-card.tsx) rather than creating a
 * duplicate, or else builds the `AssetInput` payload to create one via
 * `assetInputFromInstrumentAsset`. Pure — the caller performs the actual
 * `addAsset()` call for the create case.
 */
export function resolveOrBuildHeldAsset(
  assets: Asset[],
  nonHeld: Asset,
): { existing: Asset } | { input: AssetInput } {
  const key = assetPriceKey(nonHeld);
  const existing = assets.find((a) => assetPriceKey(a) === key);
  if (existing) return { existing };
  return { input: assetInputFromInstrumentAsset(nonHeld) };
}
