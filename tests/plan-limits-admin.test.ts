// Pure validation for the POST /api/admin/site "limits" branch
// (lib/server/plan-limits-admin.ts).

import { describe, expect, it, vi } from "vitest";

// "server-only" has no runtime module under plain Vitest; stub it so
// importing lib/server/plan-limits-admin.ts resolves, same stub as
// tests/billing-admin.test.ts.
vi.mock("server-only", () => ({}));

const { isLimitKey, parsePlanLimitBody } = await import("../lib/server/plan-limits-admin");

describe("isLimitKey", () => {
  it("accepts the three seeded limit keys", () => {
    expect(isLimitKey("watchlistItems")).toBe(true);
    expect(isLimitKey("savingsPlans")).toBe(true);
    expect(isLimitKey("portfolios")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isLimitKey("transactions")).toBe(false);
    expect(isLimitKey("")).toBe(false);
    expect(isLimitKey(undefined)).toBe(false);
    expect(isLimitKey(42)).toBe(false);
  });
});

describe("parsePlanLimitBody", () => {
  it("accepts a fully populated body", () => {
    expect(
      parsePlanLimitBody({ limitKey: "watchlistItems", freeValue: 5, proValue: null }),
    ).toEqual({ limitKey: "watchlistItems", freeValue: 5, proValue: null });
  });

  it("accepts both values null (unlimited both plans)", () => {
    expect(
      parsePlanLimitBody({ limitKey: "portfolios", freeValue: null, proValue: null }),
    ).toEqual({ limitKey: "portfolios", freeValue: null, proValue: null });
  });

  it("accepts zero as a valid cap", () => {
    expect(
      parsePlanLimitBody({ limitKey: "savingsPlans", freeValue: 0, proValue: 0 }),
    ).toEqual({ limitKey: "savingsPlans", freeValue: 0, proValue: 0 });
  });

  it("rejects an unknown limitKey", () => {
    expect(
      parsePlanLimitBody({ limitKey: "transactions", freeValue: 5, proValue: null }),
    ).toBeNull();
  });

  it("rejects a negative value", () => {
    expect(
      parsePlanLimitBody({ limitKey: "watchlistItems", freeValue: -1, proValue: null }),
    ).toBeNull();
  });

  it("rejects a non-integer value", () => {
    expect(
      parsePlanLimitBody({ limitKey: "watchlistItems", freeValue: 2.5, proValue: null }),
    ).toBeNull();
  });

  it("rejects a string value (must be a number or null, never a numeric string)", () => {
    expect(
      parsePlanLimitBody({ limitKey: "watchlistItems", freeValue: "5", proValue: null }),
    ).toBeNull();
  });

  it("rejects a missing freeValue/proValue field", () => {
    expect(parsePlanLimitBody({ limitKey: "watchlistItems", freeValue: 5 })).toBeNull();
  });
});
