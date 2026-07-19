// Pure limit resolution (lib/billing/limits.ts), extracted from
// lib/flags/flags-context.tsx's loading side the same way
// lib/flags/resolve.ts was extracted, so the fail-open + grandfathering
// rules are unit-testable without mounting the provider tree.

import { describe, expect, it } from "vitest";
import { atLimit, resolveLimit, type PlanLimitRow } from "../lib/billing/limits";

const ROWS: PlanLimitRow[] = [
  { limitKey: "watchlistItems", freeValue: 5, proValue: null },
  { limitKey: "savingsPlans", freeValue: 2, proValue: 100 },
  { limitKey: "portfolios", freeValue: null, proValue: null },
  { limitKey: "malformedString", freeValue: "5", proValue: "10" },
  { limitKey: "malformedFloat", freeValue: 2.5, proValue: 2.5 },
  { limitKey: "malformedNegative", freeValue: -1, proValue: -1 },
  { limitKey: "malformedNaN", freeValue: Number.NaN, proValue: Number.NaN },
];

describe("resolveLimit", () => {
  it("returns the free-plan cap for a free user", () => {
    expect(resolveLimit(ROWS, "watchlistItems", "free")).toBe(5);
    expect(resolveLimit(ROWS, "savingsPlans", "free")).toBe(2);
  });

  it("returns the pro-plan cap for a pro user", () => {
    expect(resolveLimit(ROWS, "savingsPlans", "pro")).toBe(100);
  });

  it("null stored value (unlimited) resolves to null", () => {
    expect(resolveLimit(ROWS, "watchlistItems", "pro")).toBeNull();
    expect(resolveLimit(ROWS, "portfolios", "free")).toBeNull();
    expect(resolveLimit(ROWS, "portfolios", "pro")).toBeNull();
  });

  it("missing row resolves to null (unlimited)", () => {
    expect(resolveLimit([], "watchlistItems", "free")).toBeNull();
  });

  it("missing key on an otherwise-present row list resolves to null", () => {
    const rows: PlanLimitRow[] = [{ limitKey: "watchlistItems", freeValue: 5, proValue: null }];
    expect(resolveLimit(rows, "portfolios", "free")).toBeNull();
  });

  it("malformed values (string, float, negative, NaN) all fail open to null", () => {
    expect(resolveLimit(ROWS, "malformedString" as never, "free")).toBeNull();
    expect(resolveLimit(ROWS, "malformedFloat" as never, "free")).toBeNull();
    expect(resolveLimit(ROWS, "malformedNegative" as never, "free")).toBeNull();
    expect(resolveLimit(ROWS, "malformedNaN" as never, "free")).toBeNull();
  });
});

describe("atLimit", () => {
  it("unlimited (null) is never at-limit, regardless of count", () => {
    expect(atLimit(null, 0)).toBe(false);
    expect(atLimit(null, 1000)).toBe(false);
  });

  it("below the cap is not at-limit", () => {
    expect(atLimit(5, 4)).toBe(false);
  });

  it("exactly at the cap is at-limit (adding one more would exceed it)", () => {
    expect(atLimit(5, 5)).toBe(true);
  });

  it("grandfathering: over the cap (e.g. after a downgrade) is still at-limit, blocking further adds", () => {
    expect(atLimit(5, 9)).toBe(true);
  });
});
