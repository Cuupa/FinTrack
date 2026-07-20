// buildCustomBenchmark / customBenchmarkColor — the pure helpers behind the
// "add any instrument as a custom benchmark" overlay (COMPETITION.md gap G10).

import { describe, expect, it } from "vitest";
import {
  BENCHMARKS,
  buildCustomBenchmark,
  customBenchmarkColor,
  type Benchmark,
} from "../lib/finance/benchmarks";
import type { ResolvedMaster } from "../lib/import/resolve-instrument";

function master(overrides: Partial<ResolvedMaster> = {}): ResolvedMaster {
  return {
    isin: "US0378331005",
    wkn: null,
    symbol: null,
    name: "Apple Inc.",
    type: "STOCK",
    currency: "USD",
    ...overrides,
  };
}

describe("buildCustomBenchmark", () => {
  it("builds a Benchmark from a resolved instrument, keyed by assetPriceKey", () => {
    const b = buildCustomBenchmark(master(), BENCHMARKS);
    expect(b).not.toBeNull();
    expect(b!.id).toBe("US0378331005"); // assetPriceKey prefers isin, uppercased
    expect(b!.label).toBe("Apple Inc.");
    expect(b!.item).toEqual({
      key: "US0378331005",
      source: "yahoo",
      id: "",
      currency: "USD",
    });
  });

  it("uses assetPriceKey's isin > wkn > symbol > name preference for the id", () => {
    const b = buildCustomBenchmark(
      master({ isin: null, wkn: "865985", symbol: "AAPL", name: "Apple Inc." }),
      BENCHMARKS,
    );
    expect(b!.id).toBe("865985");
  });

  it("returns null when the resolved id already matches a curated benchmark", () => {
    // IE00B4L5Y983 is the msci-world curated benchmark's item.key.
    const b = buildCustomBenchmark(
      master({ isin: "IE00B4L5Y983", name: "iShares Core MSCI World" }),
      BENCHMARKS,
    );
    expect(b).toBeNull();
  });

  it("returns null when the resolved id already matches an existing custom benchmark", () => {
    const already: Benchmark = {
      id: "US0378331005",
      label: "Apple Inc.",
      color: "#22c55e",
      item: { key: "US0378331005", source: "yahoo", id: "", currency: "USD" },
    };
    const b = buildCustomBenchmark(master(), [...BENCHMARKS, already]);
    expect(b).toBeNull();
  });

  it("falls back to EUR when the resolved currency is null", () => {
    const b = buildCustomBenchmark(master({ currency: null }), BENCHMARKS);
    expect(b!.item.currency).toBe("EUR");
  });
});

describe("customBenchmarkColor", () => {
  it("returns a value from the fixed palette", () => {
    const palette = new Set(Array.from({ length: 20 }, (_, i) => customBenchmarkColor(i)));
    for (const color of palette) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("cycles once the palette length is exceeded", () => {
    // Discover the palette length by scanning until a color repeats.
    const seen: string[] = [];
    let length = -1;
    for (let i = 0; i < 50; i++) {
      const c = customBenchmarkColor(i);
      if (seen.includes(c)) {
        length = i;
        break;
      }
      seen.push(c);
    }
    expect(length).toBeGreaterThan(0);
    expect(customBenchmarkColor(length)).toBe(customBenchmarkColor(0));
    expect(customBenchmarkColor(length + 3)).toBe(customBenchmarkColor(3));
  });

  it("never collides with a curated benchmark's color", () => {
    const curatedColors = new Set(BENCHMARKS.map((b) => b.color));
    for (let i = 0; i < 20; i++) {
      expect(curatedColors.has(customBenchmarkColor(i))).toBe(false);
    }
  });
});
