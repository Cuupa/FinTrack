import { describe, expect, it } from "vitest";
import {
  computePosition,
  sharesAt,
  portfolioTotals,
  netWorthSeries,
  assetValueSeries,
  holdingPeriodProfit,
  twrSeries,
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

  it("a SPLIT multiplies shares and divides avgCost, leaving cost basis unchanged", () => {
    const pos = computePosition([
      tx({ type: "BUY", quantity: 10, price: 100, date: "2025-01-01T00:00:00" }),
      tx({ type: "SPLIT", quantity: 2, price: 0, date: "2025-02-01T00:00:00" }),
    ]);
    expect(pos.shares).toBe(20);
    expect(pos.avgCost).toBe(50);
    expect(pos.costBasis).toBe(1000);
  });

  it("a later SELL realises P&L off the post-split avgCost", () => {
    const pos = computePosition([
      tx({ type: "BUY", quantity: 10, price: 100, date: "2025-01-01T00:00:00" }),
      tx({ type: "SPLIT", quantity: 2, price: 0, date: "2025-02-01T00:00:00" }),
      tx({ type: "SELL", quantity: 5, price: 60, date: "2025-03-01T00:00:00" }),
    ]);
    // after split: 20 shares @ avgCost 50; sell 5 @ 60: realised = 5*(60-50) = 50
    expect(pos.shares).toBe(15);
    expect(pos.avgCost).toBe(50);
    expect(pos.costBasis).toBe(750);
    expect(pos.realizedPL).toBeCloseTo(50, 6);
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

  it("replays a SPLIT in chronological order even when the input array is out of order — shares bought before the split are multiplied, shares bought after are not", () => {
    // Deliberately out-of-order: the second BUY (post-split) appears before
    // the SPLIT in the array, regression-testing the sort-before-replay fix.
    const txs = [
      tx({ type: "BUY", quantity: 5, price: 1, date: "2025-03-01T09:00:00" }), // post-split buy
      tx({ type: "BUY", quantity: 10, price: 1, date: "2025-01-10T09:00:00" }), // pre-split buy
      tx({ type: "SPLIT", quantity: 2, price: 0, date: "2025-02-01T09:00:00" }),
    ];
    // Pre-split 10 shares double to 20; post-split 5 shares stay 5 → 25 total.
    expect(sharesAt(txs, "2025-01-20")).toBe(10); // before the split: still un-doubled
    expect(sharesAt(txs, "2025-02-01")).toBe(20); // split day: pre-split buy doubled
    expect(sharesAt(txs, "2025-03-01")).toBe(25); // post-split buy not multiplied
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

  it("with no fxHistory, every point uses the constant spot fx rate (behavior-identical to before)", () => {
    const stock = asset({ id: "a", type: "STOCK", name: "Stock8", currency: "USD" });
    const D0 = addDays(today(), -100);
    const txs = [tx({ assetId: "a", type: "BUY", quantity: 10, price: 100, date: `${D0}T00:00:00` })];
    const history = {
      [assetPriceKey(stock)]: [
        { date: D0, close: 100 },
        { date: today(), close: 100 },
      ],
    };
    const v: ValuationContext = { base: "EUR", fx: { USD: 2 } };
    const { points } = netWorthSeries([stock], txs, "MAX", v, history);
    for (const p of points) {
      if (p.value > 0) expect(p.value).toBeCloseTo(10 * 100 * 2, 6);
    }
  });

  it("a drifting fxHistory series values old points at the historical rate, not today's spot", () => {
    const stock = asset({ id: "a", type: "STOCK", name: "Stock9", currency: "USD" });
    const D0 = addDays(today(), -100);
    const txs = [tx({ assetId: "a", type: "BUY", quantity: 10, price: 100, date: `${D0}T00:00:00` })];
    const history = {
      [assetPriceKey(stock)]: [
        { date: D0, close: 100 },
        { date: today(), close: 100 },
      ],
    };
    const spotOnly: ValuationContext = { base: "EUR", fx: { USD: 2 } };
    const withHistory: ValuationContext = {
      base: "EUR",
      fx: { USD: 2 },
      fxHistory: { USD: [[D0, 0.5], [today(), 2]] },
    };
    const a = netWorthSeries([stock], txs, "MAX", spotOnly, history);
    const b = netWorthSeries([stock], txs, "MAX", withHistory, history);
    // At the window start, spot-only always uses today's rate (2); the
    // fxHistory-based series uses the historical rate at that date (0.5) instead.
    expect(a.points[0].value).toBeCloseTo(10 * 100 * 2, 6);
    expect(b.points[0].value).toBeCloseTo(10 * 100 * 0.5, 6);
    // At the window end, both rate sources agree (fxHistory's last point is
    // also 2), so the two valuations converge.
    expect(b.points[b.points.length - 1].value).toBeCloseTo(
      a.points[a.points.length - 1].value,
      6,
    );
  });
});

describe("twrSeries: historical FX (rateOn)", () => {
  it("with no fxHistory, TWR is unchanged from the spot-only path", () => {
    const stock = asset({ id: "a", type: "STOCK", name: "Stock10", currency: "USD" });
    const D0 = addDays(today(), -100);
    const end = today();
    const txs = [tx({ assetId: "a", type: "BUY", quantity: 10, price: 100, date: `${D0}T00:00:00` })];
    const history = {
      [assetPriceKey(stock)]: [
        { date: D0, close: 100 },
        { date: end, close: 200 },
      ],
    };
    const v: ValuationContext = { base: "EUR", fx: { USD: 1.3 } };
    const out = twrSeries([stock], txs, "MAX", v, history);
    expect(out[out.length - 1].value).toBeCloseTo(1.0, 6); // +100% price return, FX is a no-op constant
  });

  it("a drifting fxHistory series can produce a materially different TWR than the spot rate", () => {
    const stock = asset({ id: "a", type: "STOCK", name: "Stock11", currency: "USD" });
    const D0 = addDays(today(), -100);
    const end = today();
    const txs = [tx({ assetId: "a", type: "BUY", quantity: 10, price: 100, date: `${D0}T00:00:00` })];
    const history = {
      [assetPriceKey(stock)]: [
        { date: D0, close: 100 },
        { date: end, close: 200 },
      ],
    };
    const spotOnly: ValuationContext = { base: "EUR", fx: { USD: 1 } };
    // FX halves over the window (2 -> 1), exactly offsetting the native-price
    // doubling once converted to the base currency.
    const withHistory: ValuationContext = {
      base: "EUR",
      fx: { USD: 1 },
      fxHistory: { USD: [[D0, 2], [end, 1]] },
    };
    const spotTwr = twrSeries([stock], txs, "MAX", spotOnly, history);
    const histTwr = twrSeries([stock], txs, "MAX", withHistory, history);
    expect(spotTwr[spotTwr.length - 1].value).toBeCloseTo(1.0, 6); // +100%
    expect(histTwr[histTwr.length - 1].value).toBeCloseTo(0, 6); // FX drift cancels it out
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

  it("rateOn falls back to the spot fx rate when fxHistory has no series for the asset's own currency", () => {
    const stock = asset({ id: "a", type: "STOCK", name: "Stock8", currency: "GBP" });
    const D0 = addDays(today(), -400);
    const txs = [tx({ type: "BUY", quantity: 10, price: 100, date: `${D0}T00:00:00` })];
    const history = {
      [assetPriceKey(stock)]: [
        { date: D0, close: 100 },
        { date: today(), close: 150 },
      ],
    };
    // fxHistory only covers USD, not this GBP-priced asset, so it falls back to
    // the constant v.fx.GBP spot rate for every date, same as rateFor.
    const v: ValuationContext = {
      base: "EUR",
      fx: { GBP: 1.15 },
      fxHistory: { USD: [[D0, 1], [today(), 1]] },
    };
    const { abs, pct } = holdingPeriodProfit(stock, txs, "MAX", v, history);
    const startValue = 10 * 100 * 1.15;
    const endValue = 10 * 150 * 1.15;
    expect(abs).toBeCloseTo(endValue - startValue, 6);
    expect(pct).toBeCloseTo((endValue - startValue) / startValue, 6);
  });
});
