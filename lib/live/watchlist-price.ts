// Which price/currency to display for a watchlist row, and whether the
// one-shot /api/price fallback (components/dashboard/watchlist-card.tsx)
// needs to run for it. Pure - no React, no fetch - so the precedence rule
// can be unit-tested directly.
//
// A watchlist item can carry a per-item currency override (picked when the
// item was added). That override must win over the cron-cached catalog
// price whenever the two disagree: the catalog price is cached in the
// *instrument's* currency (whatever the cron last resolved), which is not
// necessarily the currency the user asked to see this row in. Before this
// fix, watchlist-card.tsx always preferred the catalog price regardless of
// the override, so a GME row added with an EUR override kept showing the
// catalog's USD price relabeled as EUR (2.23 instead of ~22) - the override
// changed metadata but never actually changed what was displayed.

/** Minimal watchlist item shape this function needs. */
export interface WatchlistPriceItem {
  currency: string | null;
}

/** Minimal catalog instrument shape this function needs. */
export interface WatchlistPriceInstrument {
  lastPrice: number | null;
  currency: string | null;
}

export interface WatchlistPriceResult {
  /** Price to display, or null when nothing is known yet. */
  price: number | null;
  /** Currency the price is denominated in. */
  currency: string;
  /** Whether the one-shot /api/price fallback should run for this row. */
  wantsFetch: boolean;
}

/**
 * Resolve the price/currency to show for a watchlist row.
 *
 * The catalog (cron-synced) price is used only when it exists AND either
 * the item has no currency override or the override agrees with the
 * catalog instrument's currency. Otherwise the item's own currency (falling
 * back to the instrument's, then the portfolio base) is authoritative, and
 * the one-shot fetch is asked to fill in a price in that currency.
 */
export function pickWatchlistPrice(
  item: WatchlistPriceItem,
  inst: WatchlistPriceInstrument | null | undefined,
  fetched: number | null | undefined,
  base: string,
): WatchlistPriceResult {
  if (inst?.lastPrice != null && (item.currency == null || inst.currency === item.currency)) {
    return { price: inst.lastPrice, currency: inst.currency ?? base, wantsFetch: false };
  }
  const currency = item.currency ?? inst?.currency ?? base;
  const price = fetched ?? null;
  return { price, currency, wantsFetch: price == null };
}
