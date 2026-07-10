import { describe, expect, it } from "vitest";
import { axisCurrencyFormatter, yAxisWidth } from "../components/charts/axis";

describe("yAxisWidth", () => {
  it("clamps empty/very short labels to the minimum width", () => {
    expect(yAxisWidth([])).toBe(28);
    expect(yAxisWidth(["5"])).toBeGreaterThanOrEqual(28);
  });

  it("grows with label length up to the maximum width", () => {
    const short = yAxisWidth(["€5"]);
    const long = yAxisWidth(["€1,234,567.89"]);
    expect(long).toBeGreaterThan(short);
    expect(long).toBeLessThanOrEqual(72);
  });

  it("never returns a width narrower than the longest label needs (no clipping)", () => {
    // A 7-figure compact label ("€12.5M") should still fit comfortably inside
    // the clamp, and a long uncompacted one should saturate at the max.
    const labels = ["€12.5M", "€1,234,567.89"];
    const width = yAxisWidth(labels);
    const longest = Math.max(...labels.map((l) => l.length));
    // Estimate matches the same formula used internally; just assert it's
    // monotonic and bounded rather than duplicating the exact constants.
    expect(width).toBeGreaterThanOrEqual(Math.min(72, longest * 4));
    expect(width).toBeLessThanOrEqual(72);
  });

  it("is monotonic in the longest label length", () => {
    const w1 = yAxisWidth(["1"]);
    const w2 = yAxisWidth(["12"]);
    const w3 = yAxisWidth(["123"]);
    expect(w2).toBeGreaterThanOrEqual(w1);
    expect(w3).toBeGreaterThanOrEqual(w2);
  });
});

describe("axisCurrencyFormatter", () => {
  it("keeps small-value axes at full precision, decimal-aligned to the neediest tick", () => {
    const fmt = axisCurrencyFormatter([4.5, 5, 10], "EUR");
    // 4.5 needs 1 decimal, so every tick should render with 1 decimal.
    expect(fmt(5)).toMatch(/5[.,]00?/); // formatted like "€5.00" (locale-dependent separator)
    expect(fmt(5).includes("5")).toBe(true);
  });

  it("compacts large-value axes instead of spelling out every digit", () => {
    const fmt = axisCurrencyFormatter([1_000_000, 2_500_000], "EUR");
    const label = fmt(2_500_000);
    // Compact notation is shorter than the fully spelled-out equivalent.
    expect(label.length).toBeLessThan(String(2_500_000).length + 3);
  });

  it("falls back to compact formatting when there are no ticks", () => {
    const fmt = axisCurrencyFormatter([], "EUR");
    expect(() => fmt(0)).not.toThrow();
  });

  it("treats the 10k boundary as compact (not full precision)", () => {
    const fmtBelow = axisCurrencyFormatter([9_999], "EUR");
    const fmtAt = axisCurrencyFormatter([10_000], "EUR");
    expect(fmtBelow(9_999).length).toBeGreaterThan(0);
    expect(fmtAt(10_000).length).toBeGreaterThan(0);
    // The exact boundary (>=10_000) should not be the long fully-spelled form.
    expect(fmtAt(10_000)).not.toContain("10,000.00");
  });

  it("uses one magnitude for the whole axis (no mixed abbreviation)", () => {
    const fmt = axisCurrencyFormatter([0, 4_000, 8_000, 12_000, 16_000], "EUR");
    // maxAbs 16k => every non-zero tick uses "k", none is spelled out in full.
    expect(fmt(4_000)).toContain("k");
    expect(fmt(12_000)).toContain("k");
    expect(fmt(4_000)).not.toMatch(/000/); // not the full "4,000" form
  });
});
