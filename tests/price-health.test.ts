import { describe, expect, it } from "vitest";
import { needsAttention, priceStaleness } from "../lib/admin/price-health";

const NOW = Date.parse("2026-07-11T12:00:00Z");
const HOUR = 60 * 60 * 1000;

describe("priceStaleness", () => {
  it("is unknown for a null timestamp", () => {
    expect(priceStaleness(null, NOW)).toBe("unknown");
  });

  it("is unknown for an unparseable timestamp", () => {
    expect(priceStaleness("not-a-date", NOW)).toBe("unknown");
  });

  it("is fresh just under 2h old", () => {
    const t = new Date(NOW - 1.9 * HOUR).toISOString();
    expect(priceStaleness(t, NOW)).toBe("fresh");
  });

  it("is fresh at exactly 2h old (boundary is inclusive)", () => {
    const t = new Date(NOW - 2 * HOUR).toISOString();
    expect(priceStaleness(t, NOW)).toBe("fresh");
  });

  it("is stale just over 2h old", () => {
    const t = new Date(NOW - 2 * HOUR - 1).toISOString();
    expect(priceStaleness(t, NOW)).toBe("stale");
  });

  it("is stale just under 26h old", () => {
    const t = new Date(NOW - 25.9 * HOUR).toISOString();
    expect(priceStaleness(t, NOW)).toBe("stale");
  });

  it("is dead at exactly 26h old", () => {
    const t = new Date(NOW - 26 * HOUR).toISOString();
    expect(priceStaleness(t, NOW)).toBe("dead");
  });

  it("is dead well past 26h", () => {
    const t = new Date(NOW - 100 * HOUR).toISOString();
    expect(priceStaleness(t, NOW)).toBe("dead");
  });

  it("treats a future timestamp (clock skew) as fresh", () => {
    const t = new Date(NOW + HOUR).toISOString();
    expect(priceStaleness(t, NOW)).toBe("fresh");
  });
});

describe("needsAttention", () => {
  it("is true when there is no real price (synthetic fallback)", () => {
    expect(needsAttention(null, new Date(NOW).toISOString(), NOW)).toBe(true);
  });

  it("is false for a real, fresh price", () => {
    const t = new Date(NOW - HOUR).toISOString();
    expect(needsAttention(100, t, NOW)).toBe(false);
  });

  it("is true for a real but stale price", () => {
    const t = new Date(NOW - 10 * HOUR).toISOString();
    expect(needsAttention(100, t, NOW)).toBe(true);
  });

  it("is true for a real price with no sync timestamp", () => {
    expect(needsAttention(100, null, NOW)).toBe(true);
  });
});
