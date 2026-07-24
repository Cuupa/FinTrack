// Spending transactions (ROADMAP item #2, flag `spending`) — pure, no React,
// no lib/server imports. `amount` is signed (income positive, expense
// negative) in the account's native currency; these aggregations stay in
// native currency (like `summarizeHolding`'s spot-rate convention) since a
// spending ledger is per-account, not a cross-currency net-worth rollup.

import type { Account, Budget, SpendingCategory, SpendingTransaction } from "../types";

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

export interface BudgetProgress {
  budgetId: string;
  categoryId: string;
  /** Monthly cap, in whatever currency `transactions` are already in. */
  cap: number;
  /** Sum of expense magnitudes in the category for the month (positive). */
  spent: number;
  /** cap - spent; negative once over budget. */
  remaining: number;
  overBudget: boolean;
}

/**
 * Budget-vs-actual for one calendar month (ROADMAP item #4): only EXPENSE
 * amounts count against a cap (income never offsets it). `transactions`
 * should already be in the same currency as `budgets[].amount` (the caller
 * converts to base via `toBaseCurrency` first, same convention as the
 * Sankey card). Categories without a budget are simply absent from the
 * result -- this is budget-vs-actual, not a full category breakdown.
 */
export function budgetProgress(
  transactions: SpendingTransaction[],
  budgets: Budget[],
  month: string,
): BudgetProgress[] {
  const spentByCategory = new Map<string, number>();
  for (const t of transactions) {
    if (t.amount >= 0 || t.date.slice(0, 7) !== month || !t.categoryId) continue;
    spentByCategory.set(t.categoryId, (spentByCategory.get(t.categoryId) ?? 0) + -t.amount);
  }
  return budgets.map((b) => {
    const spent = spentByCategory.get(b.categoryId) ?? 0;
    return {
      budgetId: b.id,
      categoryId: b.categoryId,
      cap: b.amount,
      spent,
      remaining: b.amount - spent,
      overBudget: spent > b.amount,
    };
  });
}

/**
 * Converts every transaction's native-currency `amount` to the base currency
 * at spot (same convention as `summarizeHolding`'s spot-rate conversion),
 * looking up each transaction's currency via its account. Missing accounts or
 * FX rates fall back to 1:1 like `spending-view.tsx`'s original inline logic.
 */
export function toBaseCurrency(
  transactions: SpendingTransaction[],
  accounts: Account[],
  base: string,
  fx?: Record<string, number>,
): SpendingTransaction[] {
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  return transactions.map((t) => {
    const currency = accountsById.get(t.accountId)?.currency || base;
    const rate = !currency || currency === base ? 1 : (fx?.[currency] ?? 1);
    return rate === 1 ? t : { ...t, amount: t.amount * rate };
  });
}

export interface SankeyGraph {
  /** `column` tags the layout role so the chart's node renderer can anchor
   *  labels without re-deriving graph topology: `source` = leftmost (income
   *  categories + shortfall), `hub` = the Total node, `target` = rightmost
   *  (expense categories + savings). */
  nodes: { name: string; column: "source" | "hub" | "target" }[];
  links: { source: number; target: number; value: number }[];
}

export interface SpendingSankeyLabels {
  total: string;
  savings: string;
  shortfall: string;
  uncategorizedIncome: string;
  uncategorizedExpense: string;
}

/**
 * Sums entries below 1% of `total` into the `fallback` bucket, mirroring
 * `AllocationPie`'s `groupSmallSlices` so a Sankey side doesn't get cluttered
 * with slivers. The fallback bucket itself is always kept even if small.
 */
function foldSmallGroups(
  groups: Map<string, number>,
  total: number,
  fallback: string,
): Map<string, number> {
  if (total <= 0) return groups;
  const threshold = 0.01 * total;
  const kept = new Map<string, number>();
  let otherSum = 0;
  for (const [label, value] of groups) {
    if (value >= threshold || label === fallback) kept.set(label, (kept.get(label) ?? 0) + value);
    else otherSum += value;
  }
  if (otherSum > 0) kept.set(fallback, (kept.get(fallback) ?? 0) + otherSum);
  return kept;
}

/**
 * Builds a cash-flow Sankey graph for a set of (already period-filtered,
 * base-currency) transactions: income category groups -> "Total" -> expense
 * category groups, plus a `Total -> savings` link when the period's net is
 * positive or a `shortfall -> Total` link when it's negative (money drawn
 * from savings/reserves) — so the Total node always balances. Returns empty
 * nodes/links when there's nothing to show.
 */
export function spendingSankeyData(
  transactions: SpendingTransaction[],
  categories: SpendingCategory[],
  labels: SpendingSankeyLabels,
): SankeyGraph {
  const groupNameById = new Map(categories.map((c) => [c.id, c.groupName]));
  const groupLabel = (categoryId: string | null, fallback: string) =>
    (categoryId && groupNameById.get(categoryId)) || fallback;

  const income = transactions.filter((t) => t.amount > 0);
  const expense = transactions.filter((t) => t.amount < 0);
  const incomeTotal = income.reduce((s, t) => s + t.amount, 0);
  const expenseTotal = expense.reduce((s, t) => s - t.amount, 0);
  if (incomeTotal <= 0 && expenseTotal <= 0) return { nodes: [], links: [] };

  const groupSum = (txs: SpendingTransaction[], magnitude: (t: SpendingTransaction) => number, fallback: string) => {
    const map = new Map<string, number>();
    for (const t of txs) {
      const label = groupLabel(t.categoryId, fallback);
      map.set(label, (map.get(label) ?? 0) + magnitude(t));
    }
    return map;
  };

  const sortedEntries = (map: Map<string, number>) =>
    [...map.entries()].sort((a, b) => b[1] - a[1]);

  const incomeGroups = sortedEntries(
    foldSmallGroups(groupSum(income, (t) => t.amount, labels.uncategorizedIncome), incomeTotal, labels.uncategorizedIncome),
  );
  const expenseGroups = sortedEntries(
    foldSmallGroups(groupSum(expense, (t) => -t.amount, labels.uncategorizedExpense), expenseTotal, labels.uncategorizedExpense),
  );

  const nodes: SankeyGraph["nodes"] = [];
  const links: { source: number; target: number; value: number }[] = [];
  const addNode = (name: string, column: SankeyGraph["nodes"][number]["column"]) =>
    nodes.push({ name, column }) - 1;

  const totalIdx = addNode(labels.total, "hub");
  for (const [label, value] of incomeGroups) {
    if (value <= 0) continue;
    links.push({ source: addNode(label, "source"), target: totalIdx, value });
  }
  for (const [label, value] of expenseGroups) {
    if (value <= 0) continue;
    links.push({ source: totalIdx, target: addNode(label, "target"), value });
  }

  const net = incomeTotal - expenseTotal;
  if (net > 0) links.push({ source: totalIdx, target: addNode(labels.savings, "target"), value: net });
  else if (net < 0) links.push({ source: addNode(labels.shortfall, "source"), target: totalIdx, value: -net });

  return { nodes, links };
}
