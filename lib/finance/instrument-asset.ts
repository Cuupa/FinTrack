// Pure helpers to render a watchlist item or catalog instrument through the
// same AssetDetail UI used for a held asset, without ever holding it. Both
// helpers synthesize an Asset with a sentinel id (`wl:`/`cat:` prefix) that
// never collides with a real asset id, so `transactionsByAsset` (which
// filters by `asset.id`) naturally returns [] for them — no held position,
// no transactions, just master data + price.

import type { Instrument } from "../catalog/catalog";
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
