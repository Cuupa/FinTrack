// Spending transactions (ROADMAP item #2, flag `spending`) — pure, no React,
// no lib/server imports. `amount` is signed (income positive, expense
// negative) in the account's native currency; these aggregations stay in
// native currency (like `summarizeHolding`'s spot-rate convention) since a
// spending ledger is per-account, not a cross-currency net-worth rollup.

import type { SpendingTransaction } from "../types";

export interface CategoryMonthTotal {
  /** YYYY-MM. */
  month: string;
  categoryId: string | null;
  /** Signed sum: income positive, expense negative. */
  amount: number;
}

/**
 * Sums transaction amounts by (month, category), ascending by month. A
 * `categoryId` of null groups every uncategorised transaction together.
 */
export function byCategoryAndMonth(transactions: SpendingTransaction[]): CategoryMonthTotal[] {
  const byKey = new Map<string, CategoryMonthTotal>();
  for (const t of transactions) {
    const month = t.date.slice(0, 7);
    const key = `${month}|${t.categoryId ?? ""}`;
    const existing = byKey.get(key);
    if (existing) existing.amount += t.amount;
    else byKey.set(key, { month, categoryId: t.categoryId, amount: t.amount });
  }
  return [...byKey.values()].sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));
}

export interface IncomeExpenseSplit {
  /** Sum of positive amounts. */
  income: number;
  /** Sum of negative amounts, as a positive magnitude. */
  expense: number;
  /** income - expense. */
  net: number;
}

/** Splits a set of transactions into income/expense totals + their net. */
export function incomeExpenseSplit(transactions: SpendingTransaction[]): IncomeExpenseSplit {
  let income = 0;
  let expense = 0;
  for (const t of transactions) {
    if (t.amount >= 0) income += t.amount;
    else expense += -t.amount;
  }
  return { income, expense, net: income - expense };
}

/**
 * Safe-to-spend: net income minus expenses across every transaction dated
 * on/after `sinceIsoDate` (inclusive). A simple point-in-time cash position,
 * not a budget projection (that's ROADMAP item #4).
 */
export function safeToSpend(transactions: SpendingTransaction[], sinceIsoDate: string): number {
  const windowed = transactions.filter((t) => t.date >= sinceIsoDate);
  return incomeExpenseSplit(windowed).net;
}
