import { describe, expect, it } from "vitest";
import {
  dueInterest,
  nextInterestDate,
  MAX_INTEREST_OCCURRENCES,
} from "../lib/finance/cash-interest";
import type { Asset, Transaction } from "../lib/types";

function cash(over: Partial<Asset> = {}): Asset {
  return {
    id: "c1",
    isin: null,
    wkn: null,
    symbol: null,
    name: "Tagesgeld",
    type: "CASH",
    currency: "EUR",
    notes: null,
    interestRate: 3.6,
    interestFrequency: "MONTHLY",
    ...over,
  };
}

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    assetId: "c1",
    portfolioId: "p1",
    type: "BUY",
    quantity: 0,
    price: 1,
    fee: 0,
    tax: 0,
    date: "2026-01-15",
    ...over,
  };
}

describe("dueInterest", () => {
  it("returns nothing without a rate or frequency", () => {
    const txs = [tx({ quantity: 1000 })];
    expect(dueInterest(cash({ interestRate: null }), txs, "2026-06-30")).toEqual([]);
    expect(dueInterest(cash({ interestFrequency: null }), txs, "2026-06-30")).toEqual([]);
    expect(dueInterest(cash({ interestRate: 0 }), txs, "2026-06-30")).toEqual([]);
  });

  it("returns nothing for a non-cash asset", () => {
    const stock = cash({ type: "STOCK" });
    expect(dueInterest(stock, [tx({ quantity: 1000 })], "2026-06-30")).toEqual([]);
  });

  it("returns nothing with no transactions (no anchor)", () => {
    expect(dueInterest(cash(), [], "2026-06-30")).toEqual([]);
  });

  it("credits monthly interest compounding on the running balance", () => {
    // 1000 EUR deposited 2026-01-15, 3.6% p.a. monthly = 0.3%/month.
    const txs = [tx({ quantity: 1000, date: "2026-01-15" })];
    const due = dueInterest(cash(), txs, "2026-03-20");
    expect(due.map((d) => d.date)).toEqual(["2026-02-15", "2026-03-15"]);
    // Feb: 1000 * 0.003 = 3.00
    expect(due[0].amount).toBeCloseTo(3.0, 2);
    // Mar: (1000 + 3) * 0.003 = 3.009 -> 3.01 (compounded)
    expect(due[1].amount).toBeCloseTo(3.01, 2);
  });

  it("resumes after the last booked INTEREST transaction", () => {
    const txs = [
      tx({ quantity: 1000, date: "2026-01-15" }),
      tx({ type: "INTEREST", quantity: 3, date: "2026-02-15" }),
    ];
    const due = dueInterest(cash(), txs, "2026-03-20");
    // Feb already booked -> only March is due; balance = 1000 + 3 = 1003.
    expect(due.map((d) => d.date)).toEqual(["2026-03-15"]);
    expect(due[0].amount).toBeCloseTo(3.01, 2);
  });

  it("reflects a mid-period deposit in the balance", () => {
    const txs = [
      tx({ quantity: 1000, date: "2026-01-15" }),
      tx({ quantity: 1000, date: "2026-02-10" }),
    ];
    const due = dueInterest(cash(), txs, "2026-02-28");
    // By the 2026-02-15 payout the balance is 2000 -> 2000 * 0.003 = 6.00
    expect(due).toHaveLength(1);
    expect(due[0].amount).toBeCloseTo(6.0, 2);
  });

  it("skips periods where the balance is zero or negative", () => {
    const txs = [
      tx({ quantity: 1000, date: "2026-01-15" }),
      tx({ type: "SELL", quantity: 1000, date: "2026-01-20" }),
    ];
    expect(dueInterest(cash(), txs, "2026-06-30")).toEqual([]);
  });

  it("applies the quarterly divisor", () => {
    const txs = [tx({ quantity: 1000, date: "2026-01-15" })];
    const due = dueInterest(cash({ interestFrequency: "QUARTERLY" }), txs, "2026-05-01");
    // 3.6% / 4 = 0.9% per quarter, first payout 2026-04-15.
    expect(due.map((d) => d.date)).toEqual(["2026-04-15"]);
    expect(due[0].amount).toBeCloseTo(9.0, 2);
  });

  it("caps the number of payouts", () => {
    const txs = [tx({ quantity: 1000, date: "2010-01-15" })];
    const due = dueInterest(cash(), txs, "2026-06-30", MAX_INTEREST_OCCURRENCES);
    expect(due.length).toBe(MAX_INTEREST_OCCURRENCES);
  });

  it("clamps the payout day to shorter months", () => {
    const txs = [tx({ quantity: 1000, date: "2026-01-31" })];
    const due = dueInterest(cash(), txs, "2026-03-01");
    // Jan 31 -> Feb 28 (2026 is not a leap year).
    expect(due[0].date).toBe("2026-02-28");
  });
});

describe("nextInterestDate", () => {
  it("returns the first payout strictly after today", () => {
    const txs = [tx({ quantity: 1000, date: "2026-01-15" })];
    expect(nextInterestDate(cash(), txs, "2026-02-20")).toBe("2026-03-15");
  });

  it("is null without a configured rate", () => {
    const txs = [tx({ quantity: 1000, date: "2026-01-15" })];
    expect(nextInterestDate(cash({ interestRate: null }), txs, "2026-02-20")).toBeNull();
  });
});
