// Per-instrument quote_scale (provider-unit -> native-unit multiplier, e.g.
// Yahoo's per-troy-ounce gold price -> the user's per-gram holding) is folded
// into a resolved market price AFTER any FX conversion, in both the /api/quotes
// current-price path and the /api/history series path. Scale must be a strict
// no-op at 1 (the default, and every non-COMMODITY instrument) so existing
// behaviour is byte-identical.

import { describe, expect, it } from "vitest";
import { applyScale, scalePoints } from "../lib/server/scale";

describe("applyScale (current price, /api/quotes)", () => {
  it("is a strict no-op when scale is undefined or 1", () => {
    expect(applyScale(3585.12, undefined)).toBe(3585.12);
    expect(applyScale(3585.12, 1)).toBe(3585.12);
  });

  it("multiplies the (already FX-converted) price when scale differs from 1", () => {
    // Real-world gold case: XAUEUR=X resolves directly in EUR (no FX hop),
    // ~3585 EUR/troy-ounce * quote_scale (1 / 31.1034768) ~= 115.3 EUR/gram.
    const perOunceEur = 3585.12;
    const goldScale = 0.0321507466;
    const perGram = applyScale(perOunceEur, goldScale);
    expect(perGram).toBeCloseTo(115.24, 1);
    expect(perGram).not.toBe(perOunceEur);
  });
});

describe("scalePoints (history series, /api/history)", () => {
  const points = [
    { date: "2026-01-01", close: 3500 },
    { date: "2026-01-02", close: 3600 },
  ];

  it("is a strict no-op (same array reference) when the combined factor is 1", () => {
    expect(scalePoints(points, 1)).toBe(points);
  });

  it("multiplies every close when the combined factor differs from 1", () => {
    const scaled = scalePoints(points, 0.0321507466);
    expect(scaled).not.toBe(points);
    expect(scaled[0].close).toBeCloseTo(3500 * 0.0321507466, 6);
    expect(scaled[1].close).toBeCloseTo(3600 * 0.0321507466, 6);
    expect(scaled[0].date).toBe(points[0].date);
  });

  it("applies FX and scale together (factor = fxRate * quoteScale), not scale alone", () => {
    // GC=F fallback case: USD listing needs FX to EUR first, then the
    // per-gram scale — the caller multiplies both into one factor before
    // calling scalePoints, so a double-FX or FX-only bug would show here.
    const usdPerOunce = [{ date: "2026-01-01", close: 3800 }];
    const fxUsdToEur = 0.92;
    const goldScale = 0.0321507466;
    const factor = fxUsdToEur * goldScale;
    const scaled = scalePoints(usdPerOunce, factor);
    expect(scaled[0].close).toBeCloseTo(3800 * 0.92 * 0.0321507466, 6);
  });
});
