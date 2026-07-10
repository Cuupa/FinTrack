// officialNameRenames — pure diff between the current assets and a resolved
// official-name map, from lib/import/resolve-names.ts. No network, no React;
// resolveOfficialNames itself (catalog + throttled /api/lookup) isn't
// exercised here since it needs the browser fetch/catalog runtime — this
// covers the deterministic candidate-selection logic that feeds the "Official
// names" review dialog.

import { describe, expect, it } from "vitest";
import {
  applyResolvedInstrument,
  officialNameRenames,
  type ResolvedInstrument,
} from "../lib/import/resolve-names";
import type { Asset, AssetType } from "../lib/types";

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

/** Minimal row shape applyResolvedInstrument operates on. */
function row(name: string, assetType: AssetType): { name: string; assetType: AssetType } {
  return { name, assetType };
}

describe("applyResolvedInstrument", () => {
  it("keeps a COMMODITY row's name and type when the lookup disagrees (XAU -> Tether Gold regression)", () => {
    const r = row("Gold", "COMMODITY");

    applyResolvedInstrument(r, { name: "Tether Gold USD", type: "CRYPTO" });

    expect(r).toEqual({ name: "Gold", assetType: "COMMODITY" });
  });

  it("applies the resolved name onto a COMMODITY row when the lookup agrees on type", () => {
    const r = row("XAU", "COMMODITY");

    applyResolvedInstrument(r, { name: "Gold", type: "COMMODITY" });

    expect(r).toEqual({ name: "Gold", assetType: "COMMODITY" });
  });

  it("applies both name and type for a generic asset-type guess", () => {
    const r = row("APPLE", "STOCK");

    applyResolvedInstrument(r, { name: "Apple Inc.", type: "ETF" });

    expect(r).toEqual({ name: "Apple Inc.", assetType: "ETF" });
  });

  it("applies the resolved name for a CRYPTO row", () => {
    const r = row("BTC", "CRYPTO");

    applyResolvedInstrument(r, { name: "Bitcoin", type: "CRYPTO" });

    expect(r).toEqual({ name: "Bitcoin", assetType: "CRYPTO" });
  });

  it("leaves the row unchanged when nothing resolved", () => {
    const r = row("Mystery Fund", "ETF");

    applyResolvedInstrument(r, undefined);

    expect(r).toEqual({ name: "Mystery Fund", assetType: "ETF" });
  });
});
