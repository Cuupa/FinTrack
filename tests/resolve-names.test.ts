// officialNameRenames — pure diff between the current assets and a resolved
// official-name map, from lib/import/resolve-names.ts. No network, no React;
// resolveOfficialNames itself (catalog + throttled /api/lookup) isn't
// exercised here since it needs the browser fetch/catalog runtime — this
// covers the deterministic candidate-selection logic that feeds the "Official
// names" review dialog.

import { describe, expect, it } from "vitest";
import { officialNameRenames, type ResolvedInstrument } from "../lib/import/resolve-names";
import type { Asset } from "../lib/types";

function asset(overrides: Partial<Asset>): Asset {
  return {
    id: "a1",
    isin: null,
    wkn: null,
    symbol: null,
    name: "Test",
    type: "STOCK",
    currency: null,
    notes: null,
    ...overrides,
  };
}

describe("officialNameRenames", () => {
  it("surfaces an asset whose resolved official name differs from its current name", () => {
    const a = asset({ id: "a1", isin: "US0378331005", name: "APPLE" });
    const resolved = new Map<string, ResolvedInstrument>([
      ["US0378331005", { name: "Apple Inc.", type: "STOCK" }],
    ]);

    const renames = officialNameRenames([a], resolved);

    expect(renames).toEqual([{ asset: a, officialName: "Apple Inc." }]);
  });

  it("skips an asset whose resolved name is identical after trimming", () => {
    const a = asset({ id: "a1", isin: "US0378331005", name: "Apple Inc." });
    const resolved = new Map<string, ResolvedInstrument>([
      ["US0378331005", { name: "  Apple Inc.  ", type: "STOCK" }],
    ]);

    expect(officialNameRenames([a], resolved)).toEqual([]);
  });

  it("skips CASH assets even when an identifier resolves", () => {
    const a = asset({ id: "a1", symbol: "EUR", name: "Euro", type: "CASH" });
    const resolved = new Map<string, ResolvedInstrument>([
      ["EUR", { name: "Euro cash", type: "CASH" }],
    ]);

    expect(officialNameRenames([a], resolved)).toEqual([]);
  });

  it("skips an asset with no ISIN/WKN/symbol (nothing to look up by)", () => {
    const a = asset({ id: "a1", name: "Mystery Fund" });
    const resolved = new Map<string, ResolvedInstrument>([
      ["MYSTERY FUND", { name: "Mystery Fund Official", type: "ETF" }],
    ]);

    expect(officialNameRenames([a], resolved)).toEqual([]);
  });

  it("skips an asset whose identifier has no entry in the resolved map", () => {
    const a = asset({ id: "a1", isin: "US0378331005", name: "APPLE" });

    expect(officialNameRenames([a], new Map())).toEqual([]);
  });
});
