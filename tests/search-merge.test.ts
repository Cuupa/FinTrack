// mergeHits / pickBest — pure fan-out merge + ranking logic from
// lib/server/search.ts, exercised against hand-built mock hits (no network,
// no real searchYahoo/searchOnvista calls). See SEARCH_DESIGN.md §3.

import { describe, expect, it } from "vitest";
import { mergeHits, pickBest, type InstrumentHit } from "../lib/server/search";

function hit(overrides: Partial<InstrumentHit>): InstrumentHit {
  return {
    isin: null,
    wkn: null,
    symbol: null,
    name: "Test",
    type: "STOCK",
    currency: null,
    source: "yahoo",
    ...overrides,
  };
}

describe("mergeHits", () => {
  it("merges an onvista WKN hit with a Yahoo currency/symbol hit into one (same ISIN)", () => {
    const onvista = hit({
      isin: "DE000BASF111",
      wkn: "BASF11",
      symbol: "BAS",
      name: "BASF",
      source: "onvista",
    });
    const yahoo = hit({
      isin: "DE000BASF111",
      symbol: "BASX", // deliberately different from onvista's to show Yahoo wins
      name: "BASF SE",
      currency: "EUR",
      source: "yahoo",
    });

    const merged = mergeHits([onvista, yahoo]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual({
      isin: "DE000BASF111", // either (both agree) — onvista precedence
      wkn: "BASF11", // only onvista has it
      symbol: "BASX", // Yahoo wins symbol
      name: "BASF", // onvista wins name
      type: "STOCK",
      currency: "EUR", // Yahoo wins currency
      source: "onvista",
    });
  });

  it("dedupes two hits sharing the same ISIN even with no other overlap", () => {
    const a = hit({ isin: "IE00BK5BQT80", name: "Vanguard A", source: "onvista", type: "ETF" });
    const b = hit({ isin: "ie00bk5bqt80", name: "Vanguard B", source: "yahoo", type: "ETF" });
    expect(mergeHits([a, b])).toHaveLength(1);
  });

  it("dedupes by WKN when neither hit has an ISIN", () => {
    const a = hit({ wkn: "A2PKXG", name: "Vanguard A", source: "onvista" });
    const b = hit({ wkn: "A2PKXG", name: "Vanguard B", source: "yahoo" });
    expect(mergeHits([a, b])).toHaveLength(1);
  });

  it("dedupes crypto (no ISIN/WKN) by normalized name + type", () => {
    const a = hit({ name: "Bitcoin", type: "CRYPTO", source: "onvista" });
    const b = hit({ name: "  bitcoin  ", type: "CRYPTO", symbol: "BTC", source: "yahoo" });
    const merged = mergeHits([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].symbol).toBe("BTC");
  });

  it("keeps distinct instruments separate", () => {
    const a = hit({ isin: "DE000BASF111", name: "BASF" });
    const b = hit({ isin: "IE00BK5BQT80", name: "Vanguard", type: "ETF" });
    expect(mergeHits([a, b])).toHaveLength(2);
  });
});

describe("pickBest", () => {
  it("picks the onvista hit for a WKN-shaped query (source priority)", () => {
    const onvista = hit({ wkn: "ZZZZZZ", name: "Onvista-only Co", source: "onvista" });
    const yahoo = hit({ name: "Unrelated match", source: "yahoo" });
    // Query matches neither hit exactly, so this exercises the WKN-query
    // source-priority tie-break (onvista before yahoo).
    const best = pickBest("A1B2C3", [onvista, yahoo]);
    expect(best?.source).toBe("onvista");
  });

  it("picks the exact WKN match over other candidates", () => {
    const target = hit({ wkn: "BASF11", isin: "DE000BASF111", name: "BASF", source: "onvista" });
    const other = hit({ wkn: "A2PKXG", name: "Vanguard", type: "ETF", source: "onvista" });
    const best = pickBest("BASF11", [other, target]);
    expect(best?.wkn).toBe("BASF11");
  });

  it("picks the exact ISIN match over other candidates", () => {
    const target = hit({ isin: "DE000BASF111", name: "BASF", source: "yahoo" });
    const other = hit({ isin: "IE00BK5BQT80", name: "Vanguard", type: "ETF", source: "onvista" });
    const best = pickBest("de000basf111", [other, target]);
    expect(best?.isin).toBe("DE000BASF111");
  });

  it("prefers yahoo for a non-identifier (free text) query when no exact match exists", () => {
    const onvista = hit({ name: "Bitcoin (BTC) Kurs in US Dollar", type: "CRYPTO", source: "onvista" });
    const yahoo = hit({ name: "Bitcoin USD", symbol: "BTC", type: "CRYPTO", source: "yahoo" });
    const best = pickBest("Bitcoin", [onvista, yahoo]);
    expect(best?.source).toBe("yahoo");
  });

  it("filters out hits with an unsupported (null) type", () => {
    const bond = hit({ isin: "DE0001102481", name: "Bund", type: null, source: "onvista" });
    expect(pickBest("DE0001102481", [bond])).toBeNull();
  });

  it("filters unsupported types out of a mixed list, keeping a supported hit", () => {
    const bond = hit({ isin: "DE0001102481", name: "Bund", type: null, source: "onvista" });
    const stock = hit({ isin: "DE000BASF111", name: "BASF", type: "STOCK", source: "onvista" });
    const best = pickBest("basf", [bond, stock]);
    expect(best?.name).toBe("BASF");
  });

  it("returns null for an empty list", () => {
    expect(pickBest("anything", [])).toBeNull();
  });
});
