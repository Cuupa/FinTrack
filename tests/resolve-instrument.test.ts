// masterFromInstrument / masterFromApiMatch — the pure field-mapping halves of
// lib/import/resolve-instrument.ts. resolveInstrumentByQuery itself (catalog +
// /api/lookup) isn't exercised here since it needs the browser fetch/catalog
// runtime; this covers the deterministic mapping logic shared by the add-asset
// form, the watchlist "add" flow and the savings-plan inline "add asset" flow.

import { describe, expect, it } from "vitest";
import {
  masterFromApiMatch,
  masterFromInstrument,
  type ApiMatch,
} from "../lib/import/resolve-instrument";
import type { Instrument } from "../lib/catalog/catalog";

function instrument(overrides: Partial<Instrument>): Instrument {
  return {
    isin: null,
    wkn: null,
    symbol: null,
    name: "Test",
    type: "STOCK",
    currency: null,
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

describe("masterFromInstrument", () => {
  it("passes every relevant field through unchanged", () => {
    const i = instrument({
      isin: "US0378331005",
      wkn: "865985",
      symbol: "AAPL",
      name: "Apple Inc.",
      type: "STOCK",
      currency: "USD",
    });

    expect(masterFromInstrument(i)).toEqual({
      isin: "US0378331005",
      wkn: "865985",
      symbol: "AAPL",
      name: "Apple Inc.",
      type: "STOCK",
      currency: "USD",
    });
  });

  it("passes through a null currency (portfolio base currency)", () => {
    const i = instrument({ symbol: "BTC", name: "Bitcoin", type: "CRYPTO", currency: null });

    expect(masterFromInstrument(i)).toEqual({
      isin: null,
      wkn: null,
      symbol: "BTC",
      name: "Bitcoin",
      type: "CRYPTO",
      currency: null,
    });
  });
});

describe("masterFromApiMatch", () => {
  it("maps a found match, defaulting missing fields to null", () => {
    const d: ApiMatch = { found: true, name: "Apple Inc.", symbol: "AAPL", currency: "USD" };

    expect(masterFromApiMatch(d)).toEqual({
      isin: null,
      wkn: null,
      symbol: "AAPL",
      name: "Apple Inc.",
      type: "STOCK",
      currency: "USD",
    });
  });

  it("defaults the type to STOCK when the match carries no type", () => {
    const d: ApiMatch = { found: true, name: "Some Corp" };

    expect(masterFromApiMatch(d)?.type).toBe("STOCK");
  });

  it("keeps an explicit type when the match provides one", () => {
    const d: ApiMatch = { found: true, name: "Vanguard FTSE All-World", type: "ETF" };

    expect(masterFromApiMatch(d)?.type).toBe("ETF");
  });

  it("returns null when the match was not found", () => {
    const d: ApiMatch = { found: false };

    expect(masterFromApiMatch(d)).toBeNull();
  });

  it("returns null when found but missing a name", () => {
    const d: ApiMatch = { found: true };

    expect(masterFromApiMatch(d)).toBeNull();
  });
});
