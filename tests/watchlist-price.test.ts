// pickWatchlistPrice - the precedence rule between the cron-cached catalog
// price and a watchlist item's own currency override. This is the fix for
// the GME 2.23-instead-of-22 bug: watchlist-card.tsx used to always prefer
// the catalog price regardless of the item's override, so the override
// changed metadata but never actually changed what was displayed.

import { describe, expect, it } from "vitest";
import { pickWatchlistPrice } from "../lib/live/watchlist-price";

describe("pickWatchlistPrice", () => {
  const base = "EUR";

  it("fetches in the item's own currency when there is no catalog row", () => {
    const result = pickWatchlistPrice({ currency: "USD" }, null, null, base);
    expect(result).toEqual({ price: null, currency: "USD", wantsFetch: true });
  });

  it("fetches in the base currency when there is no catalog row and no override", () => {
    const result = pickWatchlistPrice({ currency: null }, undefined, null, base);
    expect(result).toEqual({ price: null, currency: base, wantsFetch: true });
  });

  it("uses the catalog price in the instrument's currency when there is no override", () => {
    const inst = { lastPrice: 230.5, currency: "USD" };
    const result = pickWatchlistPrice({ currency: null }, inst, null, base);
    expect(result).toEqual({ price: 230.5, currency: "USD", wantsFetch: false });
  });

  it("uses the catalog price when the override agrees with the instrument's currency", () => {
    const inst = { lastPrice: 21.95, currency: "USD" };
    const result = pickWatchlistPrice({ currency: "USD" }, inst, null, base);
    expect(result).toEqual({ price: 21.95, currency: "USD", wantsFetch: false });
  });

  it("ignores the catalog price and wants a fetch when the override differs (the GME bug)", () => {
    // The cron cached GME at 2.23 under a mis-resolved listing; the user
    // picked USD when adding the row. The stale catalog price must not win.
    const inst = { lastPrice: 2.23, currency: "EUR" };
    const result = pickWatchlistPrice({ currency: "USD" }, inst, null, base);
    expect(result).toEqual({ price: null, currency: "USD", wantsFetch: true });
  });

  it("uses the fetched price in the override currency once it arrives", () => {
    const inst = { lastPrice: 2.23, currency: "EUR" };
    const result = pickWatchlistPrice({ currency: "USD" }, inst, 21.95, base);
    expect(result).toEqual({ price: 21.95, currency: "USD", wantsFetch: false });
  });

  it("wants a fetch in the override currency when the instrument has no currency of its own", () => {
    const inst = { lastPrice: 100, currency: null };
    const result = pickWatchlistPrice({ currency: "GBP" }, inst, null, base);
    expect(result).toEqual({ price: null, currency: "GBP", wantsFetch: true });
  });
});
