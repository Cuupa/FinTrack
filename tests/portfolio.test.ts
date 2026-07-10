import { describe, expect, it } from "vitest";
import {
  computePosition,
  sharesAt,
  portfolioTotals,
  netWorthSeries,
  assetValueSeries,
  holdingPeriodProfit,
  type HoldingSummary,
  type ValuationContext,
} from "../lib/finance/portfolio";
import { today, addDays } from "../lib/finance/dates";
import { assetPriceKey, type Asset, type Transaction } from "../lib/types";

function tx(p: Partial<Transaction> & Pick<Transaction, "type" | "quantity" | "price">): Transaction {
  return { id: "t", assetId: "a", portfolioId: "p1", fee: 0, tax: 0, date: "2025-01-01T00:00:00", ...p };
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

  it("treats tax like fee: buy tax raises basis, sell tax reduces proceeds", () => {
    const pos = computePosition([
      tx({ type: "BUY", quantity: 10, price: 100, fee: 10, tax: 5 }),
      tx({ type: "SELL", quantity: 10, price: 120, fee: 5, tax: 30 }),
    ]);
    // basis 1015; proceeds 1200-5-30=1165; realised = 1165 - 1015 = 150
    expect(pos.realizedPL).toBeCloseTo(150, 6);
    expect(pos.totalFees).toBe(15);
    expect(pos.totalTaxes).toBe(35);
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

describe("holdingPeriodProfit", () => {
  it("regression: a tiny day-one buy plus larger later buys no longer blows up pct off the day-one sliver", () => {
    // Day-one buy is 1 share at 1 EUR; two much larger buys follow inside the
    // window. Before the fix, pct was abs/startValue (1 EUR), so a 9.5 EUR
    // gain read as +950%. It must now read against start value + invested.
    const stock = asset({ id: "a", type: "STOCK", name: "Stock1" });
    const D0 = addDays(today(), -400);
    const txs = [
      tx({ type: "BUY", quantity: 1, price: 1, date: `${D0}T00:00:00` }),
      tx({ type: "BUY", quantity: 100, price: 10, date: `${addDays(D0, 100)}T00:00:00` }),
      tx({ type: "BUY", quantity: 100, price: 11, date: `${addDays(D0, 200)}T00:00:00` }),
    ];
    const history = {
      [assetPriceKey(stock)]: [
        { date: D0, close: 1 },
        { date: today(), close: 10.5 },
      ],
    };
    const { abs, pct } = holdingPeriodProfit(stock, txs, "MAX", undefined, history);
    const startValue = 1 * 1;
    const invested = 100 * 10 + 100 * 11;
    expect(pct).toBeCloseTo(abs / (startValue + invested), 6);
    expect(pct).toBeLessThan(0.2);
  });

  it("common case: no in-window buys keeps the denominator equal to the start value", () => {
    const stock = asset({ id: "a", type: "STOCK", name: "Stock2" });
    const D0 = addDays(today(), -400);
    const txs = [tx({ type: "BUY", quantity: 10, price: 100, date: `${D0}T00:00:00` })];
    const history = {
      [assetPriceKey(stock)]: [
        { date: D0, close: 100 },
        { date: today(), close: 150 },
      ],
    };
    const { abs, pct } = holdingPeriodProfit(stock, txs, "MAX", undefined, history);
    const startValue = 10 * 100;
    const endValue = 10 * 150;
    expect(abs).toBeCloseTo(endValue - startValue, 6);
    expect(pct).toBeCloseTo((endValue - startValue) / startValue, 6);
  });

  it("buy-only-in-window: a position opened mid-window makes pct equal abs/invested", () => {
    const stock = asset({ id: "a", type: "STOCK", name: "Stock3" });
    const end = today();
    const buyDate = addDays(end, -15);
    const txs = [tx({ type: "BUY", quantity: 10, price: 100, date: `${buyDate}T00:00:00` })];
    const history = { [assetPriceKey(stock)]: [{ date: end, close: 120 }] };
    const { abs, pct } = holdingPeriodProfit(stock, txs, "1M", undefined, history);
    const invested = 10 * 100;
    expect(pct).toBeCloseTo(abs / invested, 6);
  });

  it("fully sold mid-window: pct stays finite and equals abs/(startValue+invested)", () => {
    const stock = asset({ id: "a", type: "STOCK", name: "Stock4" });
    const D0 = addDays(today(), -400);
    const txs = [
      tx({ type: "BUY", quantity: 10, price: 100, date: `${D0}T00:00:00` }),
      tx({ type: "BUY", quantity: 5, price: 120, date: `${addDays(D0, 50)}T00:00:00` }),
      tx({ type: "SELL", quantity: 15, price: 130, date: `${addDays(D0, 100)}T00:00:00` }),
    ];
    const history = { [assetPriceKey(stock)]: [{ date: D0, close: 100 }] };
    const { abs, pct } = holdingPeriodProfit(stock, txs, "MAX", undefined, history);
    const startValue = 10 * 100;
    const invested = 5 * 120;
    expect(Number.isFinite(pct)).toBe(true);
    expect(pct).toBeCloseTo(abs / (startValue + invested), 6);
  });

  it("sell-only window on a pre-existing position: the denominator stays the start value", () => {
    const stock = asset({ id: "a", type: "STOCK", name: "Stock5" });
    const D0 = addDays(today(), -400);
    const txs = [
      tx({ type: "BUY", quantity: 20, price: 50, date: `${D0}T00:00:00` }),
      tx({ type: "SELL", quantity: 5, price: 60, date: `${addDays(D0, 30)}T00:00:00` }),
    ];
    const history = {
      [assetPriceKey(stock)]: [
        { date: D0, close: 50 },
        { date: today(), close: 70 },
      ],
    };
    const { abs, pct } = holdingPeriodProfit(stock, txs, "MAX", undefined, history);
    const startValue = 20 * 50;
    expect(pct).toBeCloseTo(abs / startValue, 6);
  });

  it("degenerate denominator: a booking-only window with no prior position gives pct 0, not NaN or Infinity", () => {
    const stock = asset({ id: "a", type: "STOCK", name: "Stock6" });
    const end = today();
    const bookingDate = addDays(end, -10);
    const txs = [tx({ type: "BOOKING", quantity: 5, price: 100, date: `${bookingDate}T00:00:00` })];
    const history = { [assetPriceKey(stock)]: [{ date: end, close: 50 }] };
    const { abs, pct } = holdingPeriodProfit(stock, txs, "1M", undefined, history);
    expect(Number.isFinite(abs)).toBe(true);
    expect(pct).toBe(0);
  });

  it("multi-currency: pct is invariant to the FX rate while abs scales with it", () => {
    const stock = asset({ id: "a", type: "STOCK", name: "Stock7", currency: "USD" });
    const D0 = addDays(today(), -400);
    const txs = [tx({ type: "BUY", quantity: 10, price: 100, date: `${D0}T00:00:00` })];
    const history = {
      [assetPriceKey(stock)]: [
        { date: D0, close: 100 },
        { date: today(), close: 150 },
      ],
    };
    const v1: ValuationContext = { base: "EUR", fx: { USD: 1 } };
    const v2: ValuationContext = { base: "EUR", fx: { USD: 2.5 } };
    const r1 = holdingPeriodProfit(stock, txs, "MAX", v1, history);
    const r2 = holdingPeriodProfit(stock, txs, "MAX", v2, history);
    expect(r2.pct).toBeCloseTo(r1.pct, 6);
    expect(r2.abs).toBeCloseTo(r1.abs * 2.5, 6);
  });
});
