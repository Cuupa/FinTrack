// Tax pack (ROADMAP item #11, flag `taxPack`): extends the capital-gains tax
// report (lib/finance/tax.ts) with two DE-first additions for handing the
// year to an advisor / preparing an Elster filing -- deductible-expense
// totals from spending categories flagged `taxDeductible` (reusing ROADMAP
// #2's taxonomy rather than duplicating it) and non-investment income
// context from the spending ledger. Pure, no React, no lib/server imports --
// mirrors lib/finance/spending.ts's conventions.

import type { SpendingCategory, SpendingTransaction } from "../types";

export interface DeductibleCategoryTotal {
  categoryId: string;
  name: string;
  groupName: string;
  /** Sum of expense magnitudes for the year, positive. */
  amount: number;
}

export interface TaxPackYear {
  year: string;
  /** Sum of every deductible category's amount for the year. */
  deductibleTotal: number;
  deductibleByCategory: DeductibleCategoryTotal[];
  /** Non-investment income for the year (from the spending ledger), positive. */
  income: number;
  /** Non-investment expense for the year, positive magnitude. */
  expense: number;
}

/**
 * Buckets spending transactions by calendar year: income and total expense
 * (for context alongside the capital-gains breakdown), plus expenses in
 * categories flagged `taxDeductible`, broken out per category. `transactions`
 * should already be in the profile's base currency (see `toBaseCurrency` in
 * spending.ts) so amounts sum cleanly across accounts.
 */
export function taxPackByYear(
  transactions: SpendingTransaction[],
  categories: SpendingCategory[],
): TaxPackYear[] {
  const categoryById = new Map(categories.map((c) => [c.id, c]));
  const byYear = new Map<string, TaxPackYear>();
  const deductibleByYear = new Map<string, Map<string, number>>();

  const yearBucket = (year: string) => {
    let y = byYear.get(year);
    if (!y) {
      y = { year, deductibleTotal: 0, deductibleByCategory: [], income: 0, expense: 0 };
      byYear.set(year, y);
    }
    return y;
  };

  for (const t of transactions) {
    const year = t.date.slice(0, 4);
    const y = yearBucket(year);
    if (t.amount >= 0) {
      y.income += t.amount;
      continue;
    }
    y.expense += -t.amount;
    const category = t.categoryId ? categoryById.get(t.categoryId) : undefined;
    if (!category?.taxDeductible) continue;
    const perCategory = deductibleByYear.get(year) ?? new Map<string, number>();
    perCategory.set(category.id, (perCategory.get(category.id) ?? 0) + -t.amount);
    deductibleByYear.set(year, perCategory);
  }

  for (const [year, perCategory] of deductibleByYear) {
    const y = yearBucket(year);
    y.deductibleByCategory = [...perCategory.entries()]
      .map(([categoryId, amount]) => {
        const c = categoryById.get(categoryId)!;
        return { categoryId, name: c.name, groupName: c.groupName, amount };
      })
      .sort((a, b) => b.amount - a.amount);
    y.deductibleTotal = y.deductibleByCategory.reduce((s, c) => s + c.amount, 0);
  }

  return [...byYear.values()].sort((a, b) => (a.year < b.year ? -1 : 1));
}
