import { describe, expect, it } from "vitest";
import { computePosition, sharesAt, portfolioTotals, type HoldingSummary } from "../lib/finance/portfolio";
import type { Transaction } from "../lib/types";

function tx(p: Partial<Transaction> & Pick<Transaction, "type" | "quantity" | "price">): Transaction {
  return { id: "t", assetId: "a", portfolioId: "p1", fee: 0, date: "2025-01-01T00:00:00", ...p };
}

describe("computePosition", () => {
  it("averages cost across buys and books realised P&L on sells", () => {
    const pos = computePosition([
      tx({ type: "BUY", quantity: 10, price: 100 }),
      tx({ type: "BUY", quantity: 10, price: 200 }),
      tx({ type: "SELL", quantity: 5, price: 300 }),
    ]);
    expect(pos.shares).toBe(15);
    expect(pos.avgCost).toBe(150);
    expect(pos.costBasis).toBe(2250);
    expect(pos.realizedPL).toBe(750); // (300-150) * 5
  });

  it("includes buy fees in the basis and sell fees in proceeds", () => {
    const pos = computePosition([
      tx({ type: "BUY", quantity: 10, price: 100, fee: 10 }),
      tx({ type: "SELL", quantity: 10, price: 100, fee: 5 }),
    ]);
    // basis 1010 → avg 101; proceeds 1000-5=995; realised = 995 - 1010 = -15
    expect(pos.realizedPL).toBeCloseTo(-15, 6);
    expect(pos.shares).toBe(0);
  });
});

describe("sharesAt", () => {
  it("counts only transactions on or before the date (by day)", () => {
    const txs = [
      tx({ type: "BUY", quantity: 10, price: 1, date: "2025-01-10T09:00:00" }),
      tx({ type: "SELL", quantity: 4, price: 1, date: "2025-02-01T09:00:00" }),
    ];
    expect(sharesAt(txs, "2025-01-09")).toBe(0);
    expect(sharesAt(txs, "2025-01-10")).toBe(10);
    expect(sharesAt(txs, "2025-02-01")).toBe(6);
  });
});

describe("portfolioTotals", () => {
  it("sums holding figures and computes total return", () => {
    const h = (over: Partial<HoldingSummary>): HoldingSummary => over as HoldingSummary;
    const totals = portfolioTotals([
      h({ marketValue: 1200, costBasis: 1000, unrealizedPL: 200, realizedPL: 50 }),
      h({ marketValue: 800, costBasis: 1000, unrealizedPL: -200, realizedPL: 0 }),
    ]);
    expect(totals.marketValue).toBe(2000);
    expect(totals.costBasis).toBe(2000);
    expect(totals.unrealizedPL).toBe(0);
    expect(totals.realizedPL).toBe(50);
    expect(totals.totalPL).toBe(50);
  });
});
