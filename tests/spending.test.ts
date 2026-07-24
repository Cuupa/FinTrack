import { describe, expect, it } from "vitest";
import { byCategoryAndMonth, incomeExpenseSplit, safeToSpend } from "@/lib/finance/spending";
import type { SpendingTransaction } from "@/lib/types";

function tx(overrides: Partial<SpendingTransaction> = {}): SpendingTransaction {
  return {
    id: "t1",
    accountId: "a1",
    categoryId: null,
    date: "2024-01-01",
    amount: -50,
    payee: "Rewe",
    note: null,
    recurringId: null,
    ...overrides,
  };
}

describe("byCategoryAndMonth", () => {
  it("sums signed amounts per (month, category), ascending by month", () => {
    const txs: SpendingTransaction[] = [
      tx({ id: "1", date: "2024-02-01", categoryId: "groceries", amount: -20 }),
      tx({ id: "2", date: "2024-02-15", categoryId: "groceries", amount: -30 }),
      tx({ id: "3", date: "2024-01-10", categoryId: "groceries", amount: -10 }),
      tx({ id: "4", date: "2024-01-10", categoryId: "rent", amount: -900 }),
    ];
    expect(byCategoryAndMonth(txs)).toEqual([
      { month: "2024-01", categoryId: "groceries", amount: -10 },
      { month: "2024-01", categoryId: "rent", amount: -900 },
      { month: "2024-02", categoryId: "groceries", amount: -50 },
    ]);
  });

  it("groups uncategorised transactions under a null categoryId bucket", () => {
    const txs: SpendingTransaction[] = [
      tx({ id: "1", date: "2024-01-01", categoryId: null, amount: -5 }),
      tx({ id: "2", date: "2024-01-02", categoryId: null, amount: -7 }),
    ];
    expect(byCategoryAndMonth(txs)).toEqual([{ month: "2024-01", categoryId: null, amount: -12 }]);
  });
});

describe("incomeExpenseSplit", () => {
  it("splits positive amounts as income and negative as expense magnitude", () => {
    const txs: SpendingTransaction[] = [
      tx({ id: "1", amount: 2000 }), // salary
      tx({ id: "2", amount: -900 }), // rent
      tx({ id: "3", amount: -50 }), // groceries
    ];
    expect(incomeExpenseSplit(txs)).toEqual({ income: 2000, expense: 950, net: 1050 });
  });

  it("returns zeros for an empty list", () => {
    expect(incomeExpenseSplit([])).toEqual({ income: 0, expense: 0, net: 0 });
  });
});

describe("safeToSpend", () => {
  it("nets only transactions on/after the given date", () => {
    const txs: SpendingTransaction[] = [
      tx({ id: "1", date: "2023-12-31", amount: 5000 }), // outside window
      tx({ id: "2", date: "2024-01-01", amount: 2000 }),
      tx({ id: "3", date: "2024-01-15", amount: -300 }),
    ];
    expect(safeToSpend(txs, "2024-01-01")).toBe(1700);
  });
});
