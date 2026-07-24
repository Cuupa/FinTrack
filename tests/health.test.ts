import { describe, expect, it } from "vitest";
import {
  computeFinancialHealth,
  debtToIncomeRatio,
  liquidBalance,
  monthsOfExpensesCovered,
  netWorthToIncome,
  savingsRate,
} from "@/lib/finance/health";
import type { Account, AccountBalance, SpendingTransaction } from "@/lib/types";

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "a1",
    name: "Checking",
    kind: "checking",
    currency: null,
    isLiability: false,
    openingBalance: 1000,
    openedOn: "2024-01-01",
    ...overrides,
  };
}

function tx(overrides: Partial<SpendingTransaction> = {}): SpendingTransaction {
  return {
    id: "t1",
    accountId: "a1",
    categoryId: null,
    date: "2024-06-01",
    amount: -100,
    payee: "Test",
    note: null,
    recurringId: null,
    ...overrides,
  };
}

describe("monthsOfExpensesCovered", () => {
  it("divides liquid balance by average monthly expense", () => {
    expect(monthsOfExpensesCovered(6000, 2000)).toBe(3);
  });

  it("is null when average monthly expense is 0", () => {
    expect(monthsOfExpensesCovered(6000, 0)).toBeNull();
  });
});

describe("savingsRate", () => {
  it("computes (income - expense) / income as a 0-1 fraction", () => {
    expect(savingsRate(4000, 3000)).toBeCloseTo(0.25);
  });

  it("is null when monthly income is 0", () => {
    expect(savingsRate(0, 100)).toBeNull();
  });

  it("can be negative when expenses exceed income", () => {
    expect(savingsRate(1000, 1500)).toBeCloseTo(-0.5);
  });
});

describe("debtToIncomeRatio", () => {
  it("divides total liabilities by annualized income", () => {
    expect(debtToIncomeRatio(24000, 48000)).toBe(0.5);
  });

  it("is null when annual income is 0", () => {
    expect(debtToIncomeRatio(24000, 0)).toBeNull();
  });

  it("is 0 when there are no liabilities", () => {
    expect(debtToIncomeRatio(0, 48000)).toBe(0);
  });
});

describe("netWorthToIncome", () => {
  it("divides net worth by annual income", () => {
    expect(netWorthToIncome(96000, 48000)).toBe(2);
  });

  it("is null when annual income is 0", () => {
    expect(netWorthToIncome(96000, 0)).toBeNull();
  });

  it("can be negative for a negative net worth", () => {
    expect(netWorthToIncome(-24000, 48000)).toBe(-0.5);
  });
});

describe("liquidBalance", () => {
  it("sums checking + savings, excluding other_asset and liabilities", () => {
    const accounts: Account[] = [
      account({ id: "checking", kind: "checking", openingBalance: 2000 }),
      account({ id: "savings", kind: "savings", openingBalance: 5000 }),
      account({ id: "house", kind: "other_asset", openingBalance: 300000 }),
      account({ id: "cc", kind: "credit", isLiability: true, openingBalance: 1500 }),
    ];
    expect(liquidBalance(accounts, [])).toBe(7000);
  });

  it("FX-converts a native-currency liquid account to base", () => {
    const accounts: Account[] = [account({ currency: "USD", openingBalance: 1000 })];
    expect(liquidBalance(accounts, [], { base: "EUR", fx: { USD: 0.9 } })).toBe(900);
  });
});

describe("computeFinancialHealth", () => {
  it("wires accounts + spending transactions into all four gauges", () => {
    const accounts: Account[] = [
      account({ id: "checking", kind: "checking", openingBalance: 6000, openedOn: "2023-01-01" }),
      account({
        id: "loan",
        kind: "loan",
        isLiability: true,
        openingBalance: 12000,
        openedOn: "2023-01-01",
      }),
    ];
    const balances: AccountBalance[] = [];
    // Three months of spending history: 2000 income / 1000 expense each month.
    const transactions: SpendingTransaction[] = [
      tx({ id: "i1", date: "2024-04-15", amount: 2000 }),
      tx({ id: "e1", date: "2024-04-20", amount: -1000 }),
      tx({ id: "i2", date: "2024-05-15", amount: 2000 }),
      tx({ id: "e2", date: "2024-05-20", amount: -1000 }),
      tx({ id: "i3", date: "2024-06-15", amount: 2000 }),
      tx({ id: "e3", date: "2024-06-20", amount: -1000 }),
    ];
    const netWorth = 6000 - 12000;

    const snapshot = computeFinancialHealth(
      accounts,
      balances,
      transactions,
      netWorth,
      "2024-06-30",
    );

    // avg monthly income = 2000, avg monthly expense = 1000 (3 distinct months).
    expect(snapshot.monthsOfExpensesCovered).toBe(6);
    expect(snapshot.savingsRate).toBeCloseTo(0.5);
    // annual income = 24000; liabilities = 12000 -> ratio 0.5.
    expect(snapshot.debtToIncomeRatio).toBeCloseTo(0.5);
    // net worth -6000 / annual income 24000.
    expect(snapshot.netWorthToIncome).toBeCloseTo(-0.25);
  });

  it("returns nulls across the board when there is no spending history", () => {
    const accounts: Account[] = [account({ openingBalance: 1000 })];
    const snapshot = computeFinancialHealth(accounts, [], [], 1000, "2024-06-30");
    expect(snapshot.monthsOfExpensesCovered).toBeNull();
    expect(snapshot.savingsRate).toBeNull();
    expect(snapshot.debtToIncomeRatio).toBeNull();
    expect(snapshot.netWorthToIncome).toBeNull();
  });
});
