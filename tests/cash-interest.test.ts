import { describe, expect, it } from "vitest";
import { computePosition, twrSeries, cashAssetInPortfolio } from "../lib/finance/portfolio";
import type { Asset, Transaction } from "../lib/types";
import type { HistoryMap } from "../lib/history/history";

function asset(over: Partial<Asset> & Pick<Asset, "id">): Asset {
  return {
    isin: null,
    wkn: null,
    symbol: null,
    name: over.id,
    type: "STOCK",
    currency: "EUR",
    notes: null,
    ...over,
  };
}
function tx(p: Partial<Transaction> & Pick<Transaction, "type" | "quantity" | "price">): Transaction {
  return { id: Math.random().toString(36), assetId: "a", portfolioId: "p1", fee: 0, tax: 0, date: "2025-01-01T00:00:00", ...p };
}

describe("computePosition: INTEREST", () => {
  it("adds shares at zero cost basis, same as an equivalent BOOKING", () => {
    const withInterest = computePosition([
      tx({ type: "BUY", quantity: 1000, price: 1 }),
      tx({ type: "INTEREST", quantity: 5, price: 1, date: "2025-02-01T00:00:00" }),
    ]);
    const withBooking = computePosition([
      tx({ type: "BUY", quantity: 1000, price: 1 }),
      tx({ type: "BOOKING", quantity: 5, price: 1, date: "2025-02-01T00:00:00" }),
    ]);
    expect(withInterest.shares).toBe(1005);
    // avgCost is diluted toward zero by the free credit — 1000*1 / 1005 shares.
    expect(withInterest.avgCost).toBeCloseTo(1000 / 1005, 10);
    expect(withInterest.costBasis).toBeCloseTo(1000, 10);
    // Unrealized P&L (at price 1) is market value minus cost basis: the 5
    // interest units are pure profit, same as the booking.
    expect(withInterest.shares * 1 - withInterest.costBasis).toBeCloseTo(5, 10);
    expect(withInterest).toEqual(withBooking);
  });

  it("a fee on the interest still raises the basis", () => {
    const pos = computePosition([
      tx({ type: "BUY", quantity: 1000, price: 1 }),
      tx({ type: "INTEREST", quantity: 5, price: 1, fee: 1, date: "2025-02-01T00:00:00" }),
    ]);
    // basis becomes 1000 + 1 (fee) = 1001 across 1005 shares.
    expect(pos.shares).toBe(1005);
    expect(pos.costBasis).toBeCloseTo(1001, 10);
    expect(pos.avgCost).toBeCloseTo(1001 / 1005, 10);
  });
});

describe("cashAssetInPortfolio", () => {
  const cash = asset({ id: "cash", type: "CASH", currency: "EUR" });
  const stock = asset({ id: "stock", type: "STOCK", currency: "EUR" });

  it("returns the cash asset id when the CASH asset has a positive balance", () => {
    const txs = [
      tx({ assetId: "cash", type: "BUY", quantity: 1000, price: 1, portfolioId: "p1" }),
    ];
    expect(cashAssetInPortfolio([cash], txs, "p1")).toBe("cash");
  });

  it("returns null when there is no CASH asset", () => {
    const txs = [tx({ assetId: "stock", type: "BUY", quantity: 10, price: 100, portfolioId: "p1" })];
    expect(cashAssetInPortfolio([stock], txs, "p1")).toBeNull();
  });

  it("returns null once the cash has been fully sold off", () => {
    const txs = [
      tx({ assetId: "cash", type: "BUY", quantity: 1000, price: 1, portfolioId: "p1", date: "2025-01-01T00:00:00" }),
      tx({ assetId: "cash", type: "SELL", quantity: 1000, price: 1, portfolioId: "p1", date: "2025-02-01T00:00:00" }),
    ];
    expect(cashAssetInPortfolio([cash], txs, "p1")).toBeNull();
  });

  it("ignores CASH assets/transactions belonging to another portfolio", () => {
    const txs = [
      tx({ assetId: "cash", type: "BUY", quantity: 1000, price: 1, portfolioId: "p2" }),
    ];
    expect(cashAssetInPortfolio([cash], txs, "p1")).toBeNull();
  });
});

describe("twrSeries: cash interest counts as return", () => {
  const cashAsset = [asset({ id: "cash", type: "CASH", currency: "EUR" })];
  const history: HistoryMap = {};

  it("a deposit followed by an interest credit shows positive TWR", () => {
    const txs = [
      tx({ assetId: "cash", type: "BUY", quantity: 1000, price: 1, date: "2025-01-01T00:00:00" }),
      tx({ assetId: "cash", type: "INTEREST", quantity: 10, price: 1, date: "2025-06-01T00:00:00" }),
    ];
    const out = twrSeries(cashAsset, txs, "MAX", undefined, history);
    expect(out[0].value).toBe(0);
    expect(out[out.length - 1].value).toBeGreaterThan(0);
  });

  it("without the interest transaction, a pure deposit stays flat at 0", () => {
    const txs = [tx({ assetId: "cash", type: "BUY", quantity: 1000, price: 1, date: "2025-01-01T00:00:00" })];
    const out = twrSeries(cashAsset, txs, "MAX", undefined, history);
    expect(out[0].value).toBe(0);
    expect(out[out.length - 1].value).toBeCloseTo(0, 10);
  });
});
