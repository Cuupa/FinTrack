// watchlistItemToAsset / instrumentToAsset — the pure synthesizers that let
// AssetDetail render a followed-but-not-held or catalog-only instrument
// through the same UI as a held asset. Covers the sentinel id prefixes (so
// they never collide with real asset ids), identity pass-through, notes
// always null, and key computation for symbol-only instruments (crypto).

import { describe, expect, it } from "vitest";
import {
  assetInputFromInstrumentAsset,
  instrumentToAsset,
  resolveOrBuildHeldAsset,
  watchlistItemToAsset,
} from "../lib/finance/instrument-asset";
import { LocalStore } from "../lib/store/local-store";
import type { Instrument } from "../lib/catalog/catalog";
import type { Asset, WatchlistItem } from "../lib/types";

function watchlistItem(overrides: Partial<WatchlistItem> = {}): WatchlistItem {
  return {
    id: "w1",
    isin: "US0378331005",
    wkn: "865985",
    symbol: null,
    name: "Apple Inc.",
    type: "STOCK",
    currency: "USD",
    ...overrides,
  };
}

function instrument(overrides: Partial<Instrument> = {}): Instrument {
  return {
    isin: "US0378331005",
    wkn: "865985",
    symbol: null,
    name: "Apple Inc.",
    type: "STOCK",
    currency: "USD",
    country: null,
    sector: null,
    region: null,
    quoteSource: null,
    quoteId: null,
    quoteScale: 1,
    basePrice: 100,
    drift: 0,
    vol: 0,
    dividendYield: 0,
    lastPrice: null,
    priceSyncedAt: null,
    ...overrides,
  };
}

describe("watchlistItemToAsset", () => {
  it("prefixes the id with wl: so it never collides with a real asset id", () => {
    const a = watchlistItemToAsset(watchlistItem({ id: "abc123" }));
    expect(a.id).toBe("wl:abc123");
  });

  it("passes identity fields through unchanged", () => {
    const w = watchlistItem({
      isin: "IE00B4L5Y983",
      wkn: "A0RPWH",
      symbol: "VWCE",
      name: "Vanguard FTSE All-World",
      type: "ETF",
      currency: "EUR",
    });
    const a = watchlistItemToAsset(w);
    expect(a.isin).toBe("IE00B4L5Y983");
    expect(a.wkn).toBe("A0RPWH");
    expect(a.symbol).toBe("VWCE");
    expect(a.name).toBe("Vanguard FTSE All-World");
    expect(a.type).toBe("ETF");
    expect(a.currency).toBe("EUR");
  });

  it("always sets notes to null", () => {
    const a = watchlistItemToAsset(watchlistItem());
    expect(a.notes).toBeNull();
  });
});

describe("instrumentToAsset", () => {
  it("prefixes the id with cat: and builds the key from isin/wkn/symbol/name", () => {
    const a = instrumentToAsset(instrument({ isin: "US0378331005" }));
    expect(a.id).toBe("cat:US0378331005");
  });

  it("falls back to symbol for a symbol-only instrument (e.g. crypto)", () => {
    const a = instrumentToAsset(
      instrument({ isin: null, wkn: null, symbol: "BTC", name: "Bitcoin", type: "CRYPTO", currency: null }),
    );
    expect(a.id).toBe("cat:BTC");
    expect(a.symbol).toBe("BTC");
    expect(a.type).toBe("CRYPTO");
    expect(a.currency).toBeNull();
  });

  it("falls back to name when there is no isin/wkn/symbol", () => {
    const a = instrumentToAsset(
      instrument({ isin: null, wkn: null, symbol: null, name: "Mystery Fund" }),
    );
    expect(a.id).toBe("cat:MYSTERY FUND");
  });

  it("passes identity fields through unchanged", () => {
    const i = instrument({
      isin: "DE0007164600",
      wkn: "716460",
      symbol: null,
      name: "SAP SE",
      type: "STOCK",
      currency: "EUR",
    });
    const a = instrumentToAsset(i);
    expect(a.isin).toBe("DE0007164600");
    expect(a.wkn).toBe("716460");
    expect(a.name).toBe("SAP SE");
    expect(a.type).toBe("STOCK");
    expect(a.currency).toBe("EUR");
  });

  it("always sets notes to null", () => {
    const a = instrumentToAsset(instrument());
    expect(a.notes).toBeNull();
  });
});

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: "a1",
    isin: "US0378331005",
    wkn: "865985",
    symbol: null,
    name: "Apple Inc.",
    type: "STOCK",
    currency: "USD",
    notes: null,
    ...overrides,
  };
}

// resolveOrBuildHeldAsset — the create-then-book seam's pure part: it dedups
// a not-(yet-)held instrument (sentinel wl:/cat: id) against the user's
// existing assets by price key (mirrors the savings-plan inline "new asset"
// flow, components/dashboard/savings-plans-card.tsx) so booking a
// transaction on a watchlist/catalog instrument that's secretly already held
// reuses that asset instead of creating a duplicate.
describe("resolveOrBuildHeldAsset", () => {
  it("reuses an existing asset that shares the same price key (by ISIN)", () => {
    const existing = asset({ id: "held-1", isin: "US0378331005" });
    const nonHeld = watchlistItemToAsset(
      watchlistItem({ id: "w1", isin: "US0378331005", wkn: null, symbol: null }),
    );
    const result = resolveOrBuildHeldAsset([existing], nonHeld);
    expect(result).toEqual({ existing });
  });

  it("reuses an existing asset that shares the same price key (by symbol, e.g. crypto)", () => {
    const existing = asset({ id: "held-btc", isin: null, wkn: null, symbol: "BTC", type: "CRYPTO" });
    const nonHeld = instrumentToAsset(
      instrument({ isin: null, wkn: null, symbol: "BTC", name: "Bitcoin", type: "CRYPTO", currency: null }),
    );
    const result = resolveOrBuildHeldAsset([existing], nonHeld);
    expect(result).toEqual({ existing });
  });

  it("builds an AssetInput payload when no existing asset shares the price key", () => {
    const nonHeld = watchlistItemToAsset(
      watchlistItem({ isin: "IE00B4L5Y983", wkn: "A0RPWH", symbol: null, name: "Vanguard FTSE All-World", type: "ETF", currency: "EUR" }),
    );
    const result = resolveOrBuildHeldAsset([], nonHeld);
    expect(result).toEqual({
      input: {
        isin: "IE00B4L5Y983",
        wkn: "A0RPWH",
        symbol: null,
        name: "Vanguard FTSE All-World",
        type: "ETF",
        currency: "EUR",
        notes: null,
      },
    });
  });

  it("does not match an existing asset with a different price key", () => {
    const existing = asset({ id: "held-1", isin: "DE0007164600", wkn: "716460" });
    const nonHeld = watchlistItemToAsset(
      watchlistItem({ isin: "US0378331005", wkn: "865985" }),
    );
    const result = resolveOrBuildHeldAsset([existing], nonHeld);
    expect("existing" in result).toBe(false);
  });
});

// assetInputFromInstrumentAsset — strips the sentinel wl:/cat: id from a
// synthesized non-held asset, yielding the AssetInput asset-detail.tsx feeds
// to addAsset() on the first submitted transaction.
describe("assetInputFromInstrumentAsset", () => {
  it("maps a watchlist-synthesized (wl:) asset to an AssetInput with no id field", () => {
    const a = watchlistItemToAsset(
      watchlistItem({
        id: "w1",
        isin: "IE00B4L5Y983",
        wkn: "A0RPWH",
        symbol: null,
        name: "Vanguard FTSE All-World",
        type: "ETF",
        currency: "EUR",
      }),
    );
    expect(a.id).toBe("wl:w1");
    const input = assetInputFromInstrumentAsset(a);
    expect(input).toEqual({
      isin: "IE00B4L5Y983",
      wkn: "A0RPWH",
      symbol: null,
      name: "Vanguard FTSE All-World",
      type: "ETF",
      currency: "EUR",
      notes: null,
    });
    expect("id" in input).toBe(false);
  });

  it("maps a catalog-synthesized (cat:) asset to an AssetInput with no id field", () => {
    const a = instrumentToAsset(
      instrument({
        isin: null,
        wkn: null,
        symbol: "BTC",
        name: "Bitcoin",
        type: "CRYPTO",
        currency: null,
      }),
    );
    expect(a.id).toBe("cat:BTC");
    const input = assetInputFromInstrumentAsset(a);
    expect(input).toEqual({
      isin: null,
      wkn: null,
      symbol: "BTC",
      name: "Bitcoin",
      type: "CRYPTO",
      currency: null,
      notes: null,
    });
    expect("id" in input).toBe(false);
  });
});

// The create-on-first-transaction seam end to end: a synthesized non-held
// asset's sentinel id (wl:/cat:) must never reach the store — booking a
// transaction against it always creates a real asset first and books
// against THAT id.
describe("create-on-first-transaction seam (sentinel id never leaks)", () => {
  it("books the transaction against the newly created real asset id, not the sentinel wl: id", async () => {
    const store = new LocalStore();
    const nonHeld = watchlistItemToAsset(
      watchlistItem({ id: "w1", isin: "US0378331005", wkn: "865985", symbol: null }),
    );
    expect(nonHeld.id.startsWith("wl:")).toBe(true);

    const resolution = resolveOrBuildHeldAsset([], nonHeld);
    expect("input" in resolution).toBe(true);
    if (!("input" in resolution)) throw new Error("expected a build resolution");
    const created = await store.addAsset(resolution.input);

    expect(created.id).not.toBe(nonHeld.id);
    expect(created.id.startsWith("wl:")).toBe(false);
    expect(created.id.startsWith("cat:")).toBe(false);

    const tx = await store.addTransaction({
      assetId: created.id,
      portfolioId: "p1",
      type: "BUY",
      quantity: 3,
      price: 150,
      fee: 0,
      tax: 0,
      date: "2026-07-11T10:00:00",
    });

    expect(tx.assetId).toBe(created.id);
    expect(tx.assetId).not.toBe(nonHeld.id);

    const data = await store.load();
    expect(data.assets).toHaveLength(1);
    expect(data.assets[0].id).toBe(created.id);
    expect(data.transactions).toHaveLength(1);
    expect(data.transactions[0].assetId).toBe(created.id);
  });
});
