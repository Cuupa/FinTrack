// watchlistItemToAsset / instrumentToAsset — the pure synthesizers that let
// AssetDetail render a followed-but-not-held or catalog-only instrument
// through the same UI as a held asset. Covers the sentinel id prefixes (so
// they never collide with real asset ids), identity pass-through, notes
// always null, and key computation for symbol-only instruments (crypto).

import { describe, expect, it } from "vitest";
import { instrumentToAsset, watchlistItemToAsset } from "../lib/finance/instrument-asset";
import type { Instrument } from "../lib/catalog/catalog";
import type { WatchlistItem } from "../lib/types";

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
