import { afterEach, describe, expect, it } from "vitest";
import {
  hasManualValuation,
  manualCurrentPrice,
  manualPriceOn,
  resetManualValuations,
  setManualValuations,
} from "@/lib/finance/manual-valuation";
import type { Asset, ValuationPoint } from "@/lib/types";

function otherAsset(id: string, name: string): Asset {
  return { id, isin: null, wkn: null, symbol: null, name, type: "OTHER", currency: "EUR", notes: null };
}

afterEach(() => resetManualValuations());

describe("manual valuation registry", () => {
  it("is empty before any set", () => {
    expect(hasManualValuation("HOUSE")).toBe(false);
    expect(manualPriceOn("HOUSE", "2026-01-01")).toBeNull();
    expect(manualCurrentPrice("HOUSE")).toBeNull();
  });

  it("registers points for OTHER assets keyed by price key (uppercased name)", () => {
    const asset = otherAsset("a1", "Flat Berlin");
    const points: ValuationPoint[] = [
      { assetId: "a1", date: "2024-01-01", value: 300000 },
      { assetId: "a1", date: "2025-01-01", value: 340000 },
    ];
    setManualValuations([asset], points);
    expect(hasManualValuation("FLAT BERLIN")).toBe(true);
    expect(hasManualValuation("flat berlin")).toBe(true); // case-insensitive
    expect(manualCurrentPrice("FLAT BERLIN")).toBe(340000);
  });

  it("looks up as a carry-forward step function", () => {
    setManualValuations(
      [otherAsset("a1", "House")],
      [
        { assetId: "a1", date: "2024-01-01", value: 300000 },
        { assetId: "a1", date: "2025-06-01", value: 360000 },
      ],
    );
    expect(manualPriceOn("HOUSE", "2023-01-01")).toBe(300000); // before first → first
    expect(manualPriceOn("HOUSE", "2024-01-01")).toBe(300000);
    expect(manualPriceOn("HOUSE", "2025-01-01")).toBe(300000); // between → carry earlier
    expect(manualPriceOn("HOUSE", "2025-06-01")).toBe(360000);
    expect(manualPriceOn("HOUSE", "2030-01-01")).toBe(360000); // after last → last
  });

  it("sorts unordered points before lookup", () => {
    setManualValuations(
      [otherAsset("a1", "Art")],
      [
        { assetId: "a1", date: "2025-01-01", value: 5000 },
        { assetId: "a1", date: "2023-01-01", value: 2000 },
        { assetId: "a1", date: "2024-01-01", value: 3000 },
      ],
    );
    expect(manualCurrentPrice("ART")).toBe(5000);
    expect(manualPriceOn("ART", "2024-06-01")).toBe(3000);
  });

  it("ignores points for non-OTHER assets and non-finite values", () => {
    const stock: Asset = {
      id: "s1",
      isin: "IE00B4L5Y983",
      wkn: null,
      symbol: null,
      name: "IWDA",
      type: "ETF",
      currency: "EUR",
      notes: null,
    };
    setManualValuations(
      [stock, otherAsset("a1", "House")],
      [
        { assetId: "s1", date: "2024-01-01", value: 100 },
        { assetId: "a1", date: "2024-01-01", value: 300000 },
        { assetId: "a1", date: "2025-01-01", value: Number.NaN },
      ],
    );
    expect(hasManualValuation("IWDA")).toBe(false);
    expect(hasManualValuation("IE00B4L5Y983")).toBe(false);
    expect(manualCurrentPrice("HOUSE")).toBe(300000); // NaN point dropped
  });

  it("replaces the whole registry on each set", () => {
    setManualValuations([otherAsset("a1", "House")], [{ assetId: "a1", date: "2024-01-01", value: 1 }]);
    expect(hasManualValuation("HOUSE")).toBe(true);
    setManualValuations([otherAsset("a2", "Boat")], [{ assetId: "a2", date: "2024-01-01", value: 2 }]);
    expect(hasManualValuation("HOUSE")).toBe(false);
    expect(hasManualValuation("BOAT")).toBe(true);
  });
});
