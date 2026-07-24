import { describe, expect, it } from "vitest";
import { applyCategoryRules, buildCategoryRules, suggestCategory } from "@/lib/finance/categorize";
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

describe("buildCategoryRules + suggestCategory", () => {
  it("learns a payee -> category rule from a categorised transaction", () => {
    const rules = buildCategoryRules([tx({ payee: "Rewe", categoryId: "groceries" })]);
    expect(suggestCategory("Rewe", rules)).toBe("groceries");
  });

  it("matches case- and whitespace-insensitively", () => {
    const rules = buildCategoryRules([tx({ payee: "  Rewe  ", categoryId: "groceries" })]);
    expect(suggestCategory("REWE", rules)).toBe("groceries");
  });

  it("ignores uncategorised transactions when learning rules", () => {
    const rules = buildCategoryRules([tx({ payee: "Rewe", categoryId: null })]);
    expect(suggestCategory("Rewe", rules)).toBeNull();
  });

  it("the most recently dated categorisation wins for a payee seen twice", () => {
    const rules = buildCategoryRules([
      tx({ id: "1", payee: "Amazon", date: "2024-01-01", categoryId: "shopping" }),
      tx({ id: "2", payee: "Amazon", date: "2024-03-01", categoryId: "electronics" }),
    ]);
    expect(suggestCategory("Amazon", rules)).toBe("electronics");
  });

  it("returns null for a payee with no learned rule", () => {
    const rules = buildCategoryRules([tx({ payee: "Rewe", categoryId: "groceries" })]);
    expect(suggestCategory("Netflix", rules)).toBeNull();
  });
});

describe("applyCategoryRules", () => {
  it("suggests categories only for currently-uncategorised transactions", () => {
    const txs: SpendingTransaction[] = [
      tx({ id: "1", payee: "Rewe", date: "2024-01-01", categoryId: "groceries" }),
      tx({ id: "2", payee: "Rewe", date: "2024-02-01", categoryId: null }),
      tx({ id: "3", payee: "Netflix", date: "2024-02-01", categoryId: null }),
    ];
    expect(applyCategoryRules(txs)).toEqual([{ id: "2", categoryId: "groceries" }]);
  });

  it("returns an empty array when nothing can be suggested", () => {
    const txs: SpendingTransaction[] = [tx({ id: "1", payee: "Netflix", categoryId: null })];
    expect(applyCategoryRules(txs)).toEqual([]);
  });
});
