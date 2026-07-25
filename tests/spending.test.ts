import { describe, expect, it } from "vitest";
import {
  budgetProgress,
  byCategoryAndMonth,
  incomeExpenseSplit,
  safeToSpend,
  spendingSankeyData,
  toBaseCurrency,
  type SpendingSankeyLabels,
} from "@/lib/finance/spending";
import type { Account, Budget, SpendingCategory, SpendingTransaction } from "@/lib/types";

describe("transfers are neither income nor expense", () => {
  // A Riester premium, a kapitalbildende Lebensversicherung, a loan
  // instalment: the money moves to another account of the user's own, so net
  // worth is unchanged and only its composition shifts. Counting them as
  // spending overstated expenses by the full premium every month.
  const salary = () => tx({ id: "i1", date: "2024-01-01", amount: 3000, payee: "Salary" });
  const groceries = () =>
    tx({ id: "e1", date: "2024-01-05", amount: -200, payee: "Rewe", categoryId: "cat-food" });
  const riester = () =>
    tx({
      id: "t1",
      date: "2024-01-10",
      amount: -250,
      payee: "Riester",
      categoryId: "cat-food",
      transferAccountId: "acc-policy",
    });

  it("excludes them from the income and expense split", () => {
    const split = incomeExpenseSplit([salary(), groceries(), riester()]);
    expect(split).toEqual({ income: 3000, expense: 200, net: 2800 });
  });

  it("excludes them from category totals", () => {
    const totals = byCategoryAndMonth([groceries(), riester()]);
    expect(totals).toEqual([{ month: "2024-01", categoryId: "cat-food", amount: -200 }]);
  });

  it("does not let them eat a budget", () => {
    const budgets: Budget[] = [{ id: "b1", categoryId: "cat-food", amount: 300 }];
    const [progress] = budgetProgress([groceries(), riester()], budgets, "2024-01");
    expect(progress.spent).toBe(200);
    expect(progress.overBudget).toBe(false);
  });

  it("excludes them from safe-to-spend", () => {
    expect(safeToSpend([salary(), groceries(), riester()], "2024-01-01")).toBe(2800);
  });

  it("still counts an ordinary charge that has no transfer target", () => {
    const netflix = tx({ id: "n1", date: "2024-01-12", amount: -12.99, payee: "Netflix" });
    expect(incomeExpenseSplit([netflix]).expense).toBe(12.99);
  });
});

const labels: SpendingSankeyLabels = {
  total: "Total",
  savings: "Savings",
  shortfall: "Shortfall",
  uncategorizedIncome: "Income",
  uncategorizedExpense: "Uncategorized",
};

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

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "a1",
    name: "Checking",
    kind: "checking",
    currency: null,
    isLiability: false,
    openingBalance: 0,
    openedOn: "2020-01-01",
    ...overrides,
  };
}

describe("toBaseCurrency", () => {
  it("leaves amounts unchanged when the account currency matches base", () => {
    const accounts = [account({ id: "a1", currency: "EUR" })];
    const txs = [tx({ accountId: "a1", amount: -50 })];
    expect(toBaseCurrency(txs, accounts, "EUR")).toEqual(txs);
  });

  it("converts using the fx rate for the account's native currency", () => {
    const accounts = [account({ id: "a1", currency: "USD" })];
    const txs = [tx({ accountId: "a1", amount: -100 })];
    const [converted] = toBaseCurrency(txs, accounts, "EUR", { USD: 0.9 });
    expect(converted.amount).toBe(-90);
  });

  it("falls back to 1:1 when the account or its fx rate is missing", () => {
    const txs = [tx({ accountId: "missing", amount: -100 })];
    expect(toBaseCurrency(txs, [], "EUR")[0].amount).toBe(-100);

    const accounts = [account({ id: "a1", currency: "USD" })];
    expect(toBaseCurrency(txs.map((t) => ({ ...t, accountId: "a1" })), accounts, "EUR")[0].amount).toBe(-100);
  });
});

describe("spendingSankeyData", () => {
  const categories: SpendingCategory[] = [
    { id: "sal", groupName: "Salary", name: "Salary" },
    { id: "rent", groupName: "Housing", name: "Rent" },
  ];

  it("returns empty nodes/links for no transactions", () => {
    expect(spendingSankeyData([], categories, labels)).toEqual({ nodes: [], links: [] });
  });

  it("builds income -> Total -> expense links plus a Savings link when net is positive", () => {
    const txs: SpendingTransaction[] = [
      tx({ id: "1", categoryId: "sal", amount: 2000 }),
      tx({ id: "2", categoryId: "rent", amount: -900 }),
    ];
    const graph = spendingSankeyData(txs, categories, labels);
    expect(graph.nodes.map((n) => n.name)).toEqual(["Total", "Salary", "Housing", "Savings"]);
    expect(graph.links).toEqual([
      { source: 1, target: 0, value: 2000 },
      { source: 0, target: 2, value: 900 },
      { source: 0, target: 3, value: 1100 },
    ]);
  });

  it("builds a Shortfall -> Total link when net is negative", () => {
    const txs: SpendingTransaction[] = [
      tx({ id: "1", categoryId: "sal", amount: 500 }),
      tx({ id: "2", categoryId: "rent", amount: -900 }),
    ];
    const graph = spendingSankeyData(txs, categories, labels);
    expect(graph.nodes.map((n) => n.name)).toEqual(["Total", "Salary", "Housing", "Shortfall"]);
    expect(graph.links).toEqual([
      { source: 1, target: 0, value: 500 },
      { source: 0, target: 2, value: 900 },
      { source: 3, target: 0, value: 400 },
    ]);
  });

  it("omits the savings/shortfall link entirely when net is exactly zero", () => {
    const txs: SpendingTransaction[] = [
      tx({ id: "1", categoryId: "sal", amount: 500 }),
      tx({ id: "2", categoryId: "rent", amount: -500 }),
    ];
    const graph = spendingSankeyData(txs, categories, labels);
    expect(graph.nodes.map((n) => n.name)).toEqual(["Total", "Salary", "Housing"]);
    expect(graph.links).toHaveLength(2);
  });

  it("groups uncategorised transactions under the fallback bucket per side", () => {
    const txs: SpendingTransaction[] = [
      tx({ id: "1", categoryId: null, amount: 1000 }),
      tx({ id: "2", categoryId: null, amount: -200 }),
      tx({ id: "3", categoryId: null, amount: -300 }),
    ];
    const graph = spendingSankeyData(txs, categories, labels);
    expect(graph.nodes.map((n) => n.name)).toEqual(["Total", "Income", "Uncategorized", "Savings"]);
    const expenseLink = graph.links.find((l) => graph.nodes[l.target]?.name === "Uncategorized");
    expect(expenseLink?.value).toBe(500);
  });

  it("folds expense categories below 1% of the expense total into the fallback bucket", () => {
    const many: SpendingCategory[] = [
      { id: "big", groupName: "Housing", name: "Rent" },
      { id: "tiny", groupName: "Fees", name: "ATM fee" },
    ];
    const txs: SpendingTransaction[] = [
      tx({ id: "1", categoryId: "sal", amount: 10000 }),
      tx({ id: "2", categoryId: "big", amount: -9900 }),
      tx({ id: "3", categoryId: "tiny", amount: -1 }), // < 1% of 9901 expense total
    ];
    const graph = spendingSankeyData(txs, many.concat(categories[0]), labels);
    expect(graph.nodes.map((n) => n.name)).not.toContain("Fees");
    const uncategorized = graph.links.find((l) => graph.nodes[l.target]?.name === "Uncategorized");
    expect(uncategorized?.value).toBe(1);
  });
});

describe("budgetProgress", () => {
  const budget = (overrides: Partial<Budget> = {}): Budget => ({
    id: "b1",
    categoryId: "groceries",
    amount: 300,
    ...overrides,
  });

  it("sums only expense magnitudes in the month against the cap", () => {
    const txs: SpendingTransaction[] = [
      tx({ id: "1", date: "2024-02-05", categoryId: "groceries", amount: -100 }),
      tx({ id: "2", date: "2024-02-20", categoryId: "groceries", amount: -50 }),
      // Income in the same category never offsets the cap.
      tx({ id: "3", date: "2024-02-10", categoryId: "groceries", amount: 40 }),
      // A different month is excluded.
      tx({ id: "4", date: "2024-01-15", categoryId: "groceries", amount: -900 }),
    ];
    const [progress] = budgetProgress(txs, [budget()], "2024-02");
    expect(progress).toMatchObject({ cap: 300, spent: 150, remaining: 150, overBudget: false });
  });

  it("flags overBudget once spend exceeds the cap", () => {
    const txs: SpendingTransaction[] = [
      tx({ id: "1", date: "2024-02-05", categoryId: "groceries", amount: -350 }),
    ];
    const [progress] = budgetProgress(txs, [budget()], "2024-02");
    expect(progress.overBudget).toBe(true);
    expect(progress.remaining).toBe(-50);
  });

  it("ignores transactions in categories with no budget, and budgets with no spend", () => {
    const txs: SpendingTransaction[] = [
      tx({ id: "1", date: "2024-02-05", categoryId: "rent", amount: -1200 }),
    ];
    const [progress] = budgetProgress(txs, [budget()], "2024-02");
    expect(progress).toMatchObject({ spent: 0, remaining: 300, overBudget: false });
  });
});
