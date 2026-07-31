import { describe, expect, it } from "vitest";
import {
  hasAuthoritativeListing,
  hasYahooHint,
  learnsListing,
  listingHint,
  type QuoteListingRow,
} from "../lib/server/quote-policy";

function row(over: Partial<QuoteListingRow> = {}): QuoteListingRow {
  return { type: "ETF", quote_source: "yahoo", quote_id: "VWCE.DE", quote_pinned: false, ...over };
}

// The seeded VWCE row: EUR Xetra, pinned.
const vwce = row({ quote_pinned: true });
// An ordinary auto-imported row whose listing was learned by search.
const learned = row({ quote_id: "GME.F", quote_pinned: false });
const gold = row({ type: "COMMODITY", quote_id: "GC=F", quote_pinned: false });

describe("hasAuthoritativeListing", () => {
  it("covers pinned rows and every COMMODITY", () => {
    expect(hasAuthoritativeListing(vwce)).toBe(true);
    expect(hasAuthoritativeListing(gold)).toBe(true);
    expect(hasAuthoritativeListing(learned)).toBe(false);
  });

  it("still protects COMMODITY on a database that predates quote_pinned", () => {
    // Between deploy and migration 0107 the column simply isn't selected, so
    // gold must not fall back to search-based resolution in the meantime.
    expect(hasAuthoritativeListing({ ...gold, quote_pinned: undefined })).toBe(true);
    expect(hasAuthoritativeListing({ ...learned, quote_pinned: undefined })).toBe(false);
  });
});

describe("hasYahooHint", () => {
  it("requires both a yahoo source and an id", () => {
    expect(hasYahooHint(vwce)).toBe(true);
    expect(hasYahooHint(row({ quote_source: "onvista" }))).toBe(false);
    expect(hasYahooHint(row({ quote_id: null }))).toBe(false);
  });
});

describe("listingHint", () => {
  it("reuses the hint on an ordinary sync", () => {
    expect(listingHint(learned, false)).toBe("GME.F");
  });

  it("drops an ordinary row's hint on revalidate so a stuck listing recovers", () => {
    // The GME case: this is exactly the self-heal that must keep working.
    expect(listingHint(learned, true)).toBeUndefined();
  });

  it("never drops a pinned row's hint, even on revalidate", () => {
    // The regression this file exists for: dropping VWCE.DE here re-resolved
    // to VWRA.L (USD London) and priced a EUR ETF off a USD listing.
    expect(listingHint(vwce, true)).toBe("VWCE.DE");
    expect(listingHint(gold, true)).toBe("GC=F");
  });

  it("has no hint to offer when the row carries none", () => {
    expect(listingHint(row({ quote_id: null }), false)).toBeUndefined();
  });
});

describe("learnsListing", () => {
  it("learns a listing for a row that has none yet", () => {
    expect(learnsListing(row({ quote_source: null, quote_id: null }), "VWCE.DE")).toBe(true);
  });

  it("re-persists an ordinary row when the resolved listing differs", () => {
    expect(learnsListing(learned, "GME")).toBe(true);
  });

  it("writes nothing when the resolved listing already matches", () => {
    expect(learnsListing(learned, "GME.F")).toBe(false);
  });

  it("never overwrites a pinned or commodity listing", () => {
    // A search result that disagrees with the seed is the bug, not the fix.
    expect(learnsListing(vwce, "VWRA.L")).toBe(false);
    expect(learnsListing(gold, "GLD")).toBe(false);
  });

  it("writes nothing when resolution turned up no symbol", () => {
    expect(learnsListing(learned, null)).toBe(false);
  });
});
