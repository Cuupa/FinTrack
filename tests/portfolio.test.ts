import { describe, expect, it } from "vitest";
import {
  computePosition,
  sharesAt,
  portfolioTotals,
  netWorthSeries,
  assetValueSeries,
  type HoldingSummary,
} from "../lib/finance/portfolio";
import type { Asset, Transaction } from "../lib/types";

function tx(p: Partial<Transaction> & Pick<Transaction, "type" | "quantity" | "price">): Transaction {
  return { id: "t", assetId: "a", portfolioId: "p1", fee: 0, date: "2025-01-01T00:00:00", ...p };
}

function asset(over: Partial<Asset> & Pick<Asset, "id" | "type">): Asset {
  return { isin: null, wkn: null, symbol: null, name: "Test", currency: null, notes: null, ...over };
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

describe("netWorthSeries", () => {
  it("does not flag a CASH-only portfolio as synthetic (its price 1 is exact)", () => {
    const cash = asset({ id: "c1", type: "CASH", name: "Cash" });
    const txs = [tx({ assetId: "c1", type: "BUY", quantity: 1000, price: 1 })];
    const { containsSynthetic } = netWorthSeries([cash], txs, "1Y");
    expect(containsSynthetic).toBe(false);
  });

  it("flags a portfolio holding a priced security with no real history as synthetic", () => {
    const stock = asset({ id: "s1", type: "STOCK", name: "Stock" });
    const txs = [tx({ assetId: "s1", type: "BUY", quantity: 10, price: 100 })];
    const { containsSynthetic } = netWorthSeries([stock], txs, "1Y");
    expect(containsSynthetic).toBe(true);
  });

  it("does not flag a small head gap (window start on a non-trading day) as synthetic", () => {
    // Window start (earliest tx, MAX timeframe) is a Saturday; the first real
    // history candle is the following Monday — a 2-day gap that should be
    // absorbed by the head tolerance, not flagged as an estimate.
    const stock = asset({ id: "s1", type: "STOCK", name: "Stock" });
    const txs = [
      tx({ assetId: "s1", type: "BUY", quantity: 10, price: 100, date: "2025-01-04T00:00:00" }),
    ];
    const history = { STOCK: [{ date: "2025-01-06", close: 100 }, { date: "2025-01-07", close: 110 }] };
    const { points, containsSynthetic } = netWorthSeries([stock], txs, "MAX", undefined, history);
    expect(containsSynthetic).toBe(false);
    // The window-start point (a date before the first real candle, within
    // tolerance) is valued at the first real close, not a synthetic price.
    expect(points[0].date).toBe("2025-01-04");
    expect(points[0].value).toBeCloseTo(1000, 6); // 10 shares * 100 (first real close)
  });

  it("still flags a head gap larger than the tolerance as synthetic", () => {
    const stock = asset({ id: "s1", type: "STOCK", name: "Stock" });
    const txs = [
      tx({ assetId: "s1", type: "BUY", quantity: 10, price: 100, date: "2025-01-01T00:00:00" }),
    ];
    // First real candle is 11 days after the window start — beyond the
    // 7-day head tolerance, so the existing synthetic-fallback flag stands.
    const history = { STOCK: [{ date: "2025-01-12", close: 100 }] };
    const { containsSynthetic } = netWorthSeries([stock], txs, "MAX", undefined, history);
    expect(containsSynthetic).toBe(true);
  });
});

describe("assetValueSeries", () => {
  it("plots a CASH position's evolving balance (never synthetic)", () => {
    const cash = asset({ id: "c1", type: "CASH", name: "Cash" });
    const txs = [
      tx({ assetId: "c1", type: "BUY", quantity: 100, price: 1, date: "2025-01-01T00:00:00" }),
      tx({ assetId: "c1", type: "INTEREST", quantity: 5, price: 1, date: "2025-02-01T00:00:00" }),
    ];
    const { points, containsSynthetic } = assetValueSeries(cash, txs, "MAX");
    expect(containsSynthetic).toBe(false);
    expect(points[0].value).toBeCloseTo(100, 6);
    expect(points[points.length - 1].value).toBeCloseTo(105, 6);
  });
});
