// lib/server/fx-history.ts's rateAt: a step-function carry-forward lookup over
// an ascending [date, rate] series, used both by the benchmark cache
// (app/api/benchmarks/route.ts) and the real price-history route
// (app/api/history/route.ts) to convert a series at each point's own
// historical FX rate rather than one spot rate for the whole series.

import { describe, expect, it } from "vitest";
import { rateAt } from "../lib/server/fx-history";

describe("rateAt (historical FX carry-forward)", () => {
  const series: [string, number][] = [
    ["2025-01-06", 1.05], // Monday
    ["2025-01-07", 1.06],
    ["2025-01-10", 1.08], // next available point after a weekend gap
  ];

  it("returns the exact rate on a date present in the series", () => {
    expect(rateAt(series, "2025-01-07")).toBe(1.06);
  });

  it("carries forward the last known rate over a weekend/holiday gap", () => {
    // Frankfurter has no Saturday/Sunday rates; a weekend date should carry
    // forward Friday's (here: the last point before the gap).
    expect(rateAt(series, "2025-01-08")).toBe(1.06);
    expect(rateAt(series, "2025-01-09")).toBe(1.06);
  });

  it("uses the first point's rate for a date before the series starts", () => {
    expect(rateAt(series, "2025-01-01")).toBe(1.05);
  });

  it("carries forward the last point's rate for a date after the series ends", () => {
    expect(rateAt(series, "2025-06-01")).toBe(1.08);
  });

  it("returns null for an empty series", () => {
    expect(rateAt([], "2025-01-07")).toBeNull();
  });
});
