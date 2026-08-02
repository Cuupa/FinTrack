import { describe, it, expect } from "vitest";
import { frontLoadOnVolume, frontLoadPercent, frontLoadSplit } from "../lib/finance/front-load";
import type { Asset, SavingsPlan } from "../lib/types";

function asset(over: Partial<Asset> = {}): Asset {
  return {
    id: "a1",
    isin: "LU0000000000",
    wkn: null,
    symbol: null,
    name: "Managed World Fund",
    type: "ETF",
    currency: "EUR",
    notes: null,
    ...over,
  };
}

function plan(over: Partial<SavingsPlan> = {}): SavingsPlan {
  return {
    id: "p1",
    assetId: "a1",
    portfolioId: "pf1",
    amount: 100,
    interval: "MONTHLY",
    startDate: "2026-01-01",
    active: true,
    lastRunDate: null,
    ...over,
  };
}

describe("frontLoadPercent", () => {
  it("is 0 for an instrument the exchange prices directly", () => {
    expect(frontLoadPercent(asset())).toBe(0);
    expect(frontLoadPercent(asset({ frontLoad: null }))).toBe(0);
  });

  it("reads the fund's own rate when the plan has none", () => {
    expect(frontLoadPercent(asset({ frontLoad: 5 }), plan())).toBe(5);
  });

  it("lets the plan override the fund (broker discount)", () => {
    expect(frontLoadPercent(asset({ frontLoad: 5 }), plan({ frontLoad: 2.5 }))).toBe(2.5);
  });

  // The reason `frontLoad` is nullable rather than defaulting to 0: "my broker
  // waives it on this plan" has to be sayable, and 0-as-unset would erase it.
  it("honours an explicit 0 on the plan against a charging fund", () => {
    expect(frontLoadPercent(asset({ frontLoad: 5 }), plan({ frontLoad: 0 }))).toBe(0);
  });

  it("survives a missing asset", () => {
    expect(frontLoadPercent(null)).toBe(0);
    expect(frontLoadPercent(undefined, plan({ frontLoad: 3 }))).toBe(3);
  });
});

describe("frontLoadSplit", () => {
  it("buys at the offer price, not the NAV", () => {
    const split = frontLoadSplit(100, 10, 5);
    expect(split.offerPrice).toBeCloseTo(10.5, 10);
    expect(split.quantity).toBeCloseTo(9.5238095, 6);
    expect(split.charge).toBeCloseTo(4.7619048, 6);
  });

  // The whole point: the money spent is accounted for exactly once, as units at
  // NAV plus the surcharge — never lost, never counted twice.
  it("keeps units x NAV + charge equal to the money invested", () => {
    const split = frontLoadSplit(250, 37.42, 3.5);
    expect(split.quantity * 37.42 + split.charge).toBeCloseTo(250, 8);
  });

  it("degenerates to a plain division without a surcharge", () => {
    const split = frontLoadSplit(100, 10, 0);
    expect(split.offerPrice).toBe(10);
    expect(split.quantity).toBe(10);
    expect(split.charge).toBe(0);
  });

  it("returns no quantity for an unusable price instead of Infinity", () => {
    expect(frontLoadSplit(100, 0, 5).quantity).toBeNaN();
    expect(frontLoadSplit(100, -1, 5).quantity).toBeNaN();
  });
});

describe("frontLoadOnVolume", () => {
  // A manual buy fixes the size first, so the surcharge sits ON TOP of the
  // volume instead of coming out of a fixed budget — a different number from
  // frontLoadSplit's charge at the same rate.
  it("charges the rate on top of a fixed order volume", () => {
    expect(frontLoadOnVolume(1000, 5)).toBeCloseTo(50, 10);
    expect(frontLoadSplit(1000, 100, 5).charge).toBeCloseTo(47.619, 3);
  });

  it("is 0 without a rate or without a volume", () => {
    expect(frontLoadOnVolume(1000, 0)).toBe(0);
    expect(frontLoadOnVolume(0, 5)).toBe(0);
    expect(frontLoadOnVolume(Number.NaN, 5)).toBe(0);
  });
});
