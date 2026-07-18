// Pure entitlement derivation (lib/billing/plan.ts). MONETIZATION.md section
// 3: 'pro' for active/trialing, 'pro' for past_due within a 7-day grace
// window, 'free' otherwise (including no row / null).

import { describe, expect, it } from "vitest";
import { resolvePlan } from "../lib/billing/plan";

const NOW = "2026-07-18T00:00:00.000Z";

describe("resolvePlan", () => {
  it("active status resolves pro", () => {
    expect(
      resolvePlan({ status: "active", currentPeriodEnd: "2026-08-01T00:00:00.000Z" }, NOW),
    ).toBe("pro");
  });

  it("trialing status resolves pro", () => {
    expect(
      resolvePlan({ status: "trialing", currentPeriodEnd: "2026-08-01T00:00:00.000Z" }, NOW),
    ).toBe("pro");
  });

  it("past_due within the 7-day grace window resolves pro", () => {
    // Period ended yesterday, well inside the 7-day grace.
    expect(
      resolvePlan({ status: "past_due", currentPeriodEnd: "2026-07-17T00:00:00.000Z" }, NOW),
    ).toBe("pro");
  });

  it("past_due exactly at the +7 day grace boundary resolves free", () => {
    const periodEnd = "2026-07-11T00:00:00.000Z"; // NOW - 7 days exactly
    expect(resolvePlan({ status: "past_due", currentPeriodEnd: periodEnd }, NOW)).toBe("free");
  });

  it("past_due beyond the grace window resolves free", () => {
    expect(
      resolvePlan({ status: "past_due", currentPeriodEnd: "2026-07-01T00:00:00.000Z" }, NOW),
    ).toBe("free");
  });

  it("canceled status resolves free", () => {
    expect(
      resolvePlan({ status: "canceled", currentPeriodEnd: "2026-08-01T00:00:00.000Z" }, NOW),
    ).toBe("free");
  });

  it("no subscription row (null) resolves free", () => {
    expect(resolvePlan(null, NOW)).toBe("free");
  });

  it("no subscription row (undefined) resolves free", () => {
    expect(resolvePlan(undefined, NOW)).toBe("free");
  });
});
