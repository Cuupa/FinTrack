import { describe, expect, it } from "vitest";
import { orderFee, savingsPlanFee } from "../lib/finance/fees";
import type { Portfolio } from "../lib/types";

function portfolio(over: Partial<Portfolio> = {}): Portfolio {
  return { id: "p1", name: "Main", ...over };
}

describe("orderFee", () => {
  it("returns 0 for a null/undefined portfolio", () => {
    expect(orderFee(null, 1000)).toBe(0);
    expect(orderFee(undefined, 1000)).toBe(0);
  });

  it("returns 0 when the portfolio has no fee model", () => {
    expect(orderFee(portfolio(), 1000)).toBe(0);
  });

  it("returns the flat fee below the free-from threshold", () => {
    const p = portfolio({ feeOrderFlat: 1, feeOrderFreeFrom: 500 });
    expect(orderFee(p, 400)).toBe(1);
  });

  it("waives the fee at or above the free-from threshold", () => {
    const p = portfolio({ feeOrderFlat: 1, feeOrderFreeFrom: 500 });
    expect(orderFee(p, 500)).toBe(0);
    expect(orderFee(p, 600)).toBe(0);
  });

  it("always charges the flat fee when free-from is null", () => {
    const p = portfolio({ feeOrderFlat: 1, feeOrderFreeFrom: null });
    expect(orderFee(p, 1_000_000)).toBe(1);
  });

  it("always charges the flat fee when free-from is undefined", () => {
    const p = portfolio({ feeOrderFlat: 1 });
    expect(orderFee(p, 1_000_000)).toBe(1);
  });

  it("defaults the flat fee to 0 when unset", () => {
    const p = portfolio({ feeOrderFreeFrom: 500 });
    expect(orderFee(p, 100)).toBe(0);
  });
});

describe("savingsPlanFee", () => {
  it("returns 0 for a null/undefined portfolio", () => {
    expect(savingsPlanFee(null)).toBe(0);
    expect(savingsPlanFee(undefined)).toBe(0);
  });

  it("returns 0 when unset", () => {
    expect(savingsPlanFee(portfolio())).toBe(0);
  });

  it("returns the configured fee", () => {
    expect(savingsPlanFee(portfolio({ feeSavingsPlan: 1.5 }))).toBe(1.5);
  });
});
