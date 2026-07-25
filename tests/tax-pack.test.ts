import { describe, expect, it } from "vitest";
import { taxPackByYear } from "@/lib/finance/tax-pack";
import type { SpendingCategory, SpendingTransaction } from "@/lib/types";

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

function cat(overrides: Partial<SpendingCategory> = {}): SpendingCategory {
  return { id: "c1", groupName: "Housing", name: "Rent", ...overrides };
}

describe("taxPackByYear", () => {
  it("splits income and expense per calendar year", () => {
    const txs = [
      tx({ id: "1", date: "2024-01-05", amount: -100 }),
      tx({ id: "2", date: "2024-03-01", amount: 500 }),
      tx({ id: "3", date: "2025-01-05", amount: -20 }),
    ];
    const years = taxPackByYear(txs, []);
    expect(years).toEqual([
      { year: "2024", deductibleTotal: 0, deductibleByCategory: [], income: 500, expense: 100 },
      { year: "2025", deductibleTotal: 0, deductibleByCategory: [], income: 0, expense: 20 },
    ]);
  });

  it("sums only expenses in taxDeductible categories, per category per year", () => {
    const categories = [
      cat({ id: "work", groupName: "Work", name: "Home office", taxDeductible: true }),
      cat({ id: "groceries", groupName: "Living", name: "Groceries", taxDeductible: false }),
    ];
    const txs = [
      tx({ id: "1", date: "2024-02-01", categoryId: "work", amount: -300 }),
      tx({ id: "2", date: "2024-05-01", categoryId: "work", amount: -200 }),
      tx({ id: "3", date: "2024-02-10", categoryId: "groceries", amount: -80 }),
      tx({ id: "4", date: "2024-06-01", categoryId: null, amount: -40 }),
    ];
    const [year] = taxPackByYear(txs, categories);
    expect(year.deductibleTotal).toBe(500);
    expect(year.deductibleByCategory).toEqual([
      { categoryId: "work", name: "Home office", groupName: "Work", amount: 500 },
    ]);
    expect(year.expense).toBe(620);
    expect(year.income).toBe(0);
  });

  it("ignores income transactions for deductible totals even in a deductible category", () => {
    const categories = [cat({ id: "work", taxDeductible: true })];
    const txs = [tx({ id: "1", date: "2024-01-01", categoryId: "work", amount: 1000 })];
    const [year] = taxPackByYear(txs, categories);
    expect(year.deductibleTotal).toBe(0);
    expect(year.income).toBe(1000);
  });

  it("treats an undefined taxDeductible as not deductible", () => {
    const categories = [cat({ id: "c1", taxDeductible: undefined })];
    const txs = [tx({ id: "1", categoryId: "c1", amount: -50 })];
    const [year] = taxPackByYear(txs, categories);
    expect(year.deductibleTotal).toBe(0);
  });

  it("sorts years ascending and categories by amount descending", () => {
    const categories = [
      cat({ id: "a", name: "A", taxDeductible: true }),
      cat({ id: "b", name: "B", taxDeductible: true }),
    ];
    const txs = [
      tx({ id: "1", date: "2025-01-01", categoryId: "a", amount: -10 }),
      tx({ id: "2", date: "2023-01-01", categoryId: "a", amount: -10 }),
      tx({ id: "3", date: "2023-01-01", categoryId: "b", amount: -90 }),
    ];
    const years = taxPackByYear(txs, categories);
    expect(years.map((y) => y.year)).toEqual(["2023", "2025"]);
    expect(years[0].deductibleByCategory.map((c) => c.categoryId)).toEqual(["b", "a"]);
  });
});
