import { describe, expect, it } from "vitest";
import { detectRecurringCandidates } from "@/lib/finance/recurring";
import type { Account, SpendingTransaction } from "@/lib/types";

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-loan",
    name: "Autokredit",
    kind: "loan",
    currency: null,
    isLiability: true,
    openingBalance: 12000,
    openedOn: "2024-01-01",
    ...overrides,
  };
}

function tx(overrides: Partial<SpendingTransaction> = {}): SpendingTransaction {
  return {
    id: "t1",
    accountId: "a1",
    categoryId: null,
    date: "2024-01-01",
    amount: -50,
    payee: "Netflix",
    note: null,
    recurringId: null,
    ...overrides,
  };
}

describe("detectRecurringCandidates — loan instalments", () => {
  const instalments: SpendingTransaction[] = [
    tx({ id: "l1", date: "2024-01-05", amount: -299, payee: "Autokredit" }),
    tx({ id: "l2", date: "2024-02-05", amount: -299, payee: "Autokredit" }),
    tx({ id: "l3", date: "2024-03-06", amount: -299, payee: "Autokredit" }),
  ];

  it("suggests them as a contract when no accounts are known", () => {
    // The old single-argument behaviour, unchanged for existing call sites.
    expect(detectRecurringCandidates(instalments)).toHaveLength(1);
  });

  it("drops them once the matching liability account is known", () => {
    expect(detectRecurringCandidates(instalments, [account()])).toEqual([]);
  });

  it("matches the payee case- and whitespace-insensitively", () => {
    const messy = instalments.map((t) => ({ ...t, payee: "  AUTOKREDIT " }));
    expect(detectRecurringCandidates(messy, [account()])).toEqual([]);
  });

  it("keeps suggesting a real contract paid to an asset account's namesake", () => {
    // Only liabilities are excluded; an asset account named like a payee must
    // not silently swallow a genuine subscription.
    const checking = account({ id: "acc-1", name: "Netflix", kind: "checking", isLiability: false });
    const subs = [
      tx({ id: "s1", date: "2024-01-05", amount: -12.99 }),
      tx({ id: "s2", date: "2024-02-05", amount: -12.99 }),
      tx({ id: "s3", date: "2024-03-06", amount: -12.99 }),
    ];
    expect(detectRecurringCandidates(subs, [checking])).toHaveLength(1);
  });

  it("leaves unrelated payees alone when a liability exists", () => {
    const mixed = [
      ...instalments,
      tx({ id: "s1", date: "2024-01-07", amount: -12.99 }),
      tx({ id: "s2", date: "2024-02-07", amount: -12.99 }),
      tx({ id: "s3", date: "2024-03-08", amount: -12.99 }),
    ];
    const found = detectRecurringCandidates(mixed, [account()]);
    expect(found).toHaveLength(1);
    expect(found[0].payee).toBe("Netflix");
  });
});

describe("detectRecurringCandidates", () => {
  it("detects a monthly-cadence expense cluster", () => {
    const txs: SpendingTransaction[] = [
      tx({ id: "1", date: "2024-01-05", amount: -12.99 }),
      tx({ id: "2", date: "2024-02-05", amount: -12.99 }),
      tx({ id: "3", date: "2024-03-06", amount: -12.99 }),
      tx({ id: "4", date: "2024-04-05", amount: -12.99 }),
    ];
    const candidates = detectRecurringCandidates(txs);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      payee: "Netflix",
      amount: 12.99,
      interval: "MONTHLY",
    });
    expect(candidates[0].transactionIds).toEqual(["1", "2", "3", "4"]);
  });

  it("detects a quarterly and annual cadence", () => {
    const quarterly: SpendingTransaction[] = [
      tx({ id: "q1", payee: "Insurer", date: "2024-01-01", amount: -90 }),
      tx({ id: "q2", payee: "Insurer", date: "2024-04-01", amount: -90 }),
      tx({ id: "q3", payee: "Insurer", date: "2024-07-01", amount: -90 }),
    ];
    const annual: SpendingTransaction[] = [
      tx({ id: "a1", payee: "Domain Registrar", date: "2022-06-01", amount: -15 }),
      tx({ id: "a2", payee: "Domain Registrar", date: "2023-06-01", amount: -15 }),
      tx({ id: "a3", payee: "Domain Registrar", date: "2024-06-02", amount: -15 }),
    ];
    const candidates = detectRecurringCandidates([...quarterly, ...annual]);
    const byPayee = new Map(candidates.map((c) => [c.payee, c]));
    expect(byPayee.get("Insurer")?.interval).toBe("QUARTERLY");
    expect(byPayee.get("Domain Registrar")?.interval).toBe("ANNUAL");
  });

  it("requires at least 3 occurrences", () => {
    const txs: SpendingTransaction[] = [
      tx({ id: "1", date: "2024-01-05" }),
      tx({ id: "2", date: "2024-02-05" }),
    ];
    expect(detectRecurringCandidates(txs)).toEqual([]);
  });

  it("ignores income (positive amounts)", () => {
    const txs: SpendingTransaction[] = [
      tx({ id: "1", date: "2024-01-01", amount: 2000, payee: "Employer" }),
      tx({ id: "2", date: "2024-02-01", amount: 2000, payee: "Employer" }),
      tx({ id: "3", date: "2024-03-01", amount: 2000, payee: "Employer" }),
    ];
    expect(detectRecurringCandidates(txs)).toEqual([]);
  });

  it("excludes transactions already linked to a contract", () => {
    const txs: SpendingTransaction[] = [
      tx({ id: "1", date: "2024-01-05", recurringId: "c1" }),
      tx({ id: "2", date: "2024-02-05", recurringId: "c1" }),
      tx({ id: "3", date: "2024-03-06", recurringId: "c1" }),
    ];
    expect(detectRecurringCandidates(txs)).toEqual([]);
  });

  it("separates different amounts from the same payee into distinct clusters", () => {
    const txs: SpendingTransaction[] = [
      tx({ id: "1", date: "2024-01-05", amount: -10 }),
      tx({ id: "2", date: "2024-02-05", amount: -10 }),
      tx({ id: "3", date: "2024-03-06", amount: -10 }),
      tx({ id: "4", date: "2024-01-05", amount: -30 }),
      tx({ id: "5", date: "2024-02-05", amount: -30 }),
      tx({ id: "6", date: "2024-03-06", amount: -30 }),
    ];
    const candidates = detectRecurringCandidates(txs);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.amount).sort((a, b) => a - b)).toEqual([10, 30]);
  });

  it("skips irregular gaps that classify into no known cadence", () => {
    const txs: SpendingTransaction[] = [
      tx({ id: "1", date: "2024-01-01" }),
      tx({ id: "2", date: "2024-01-08" }),
      tx({ id: "3", date: "2024-01-20" }),
    ];
    expect(detectRecurringCandidates(txs)).toEqual([]);
  });
});
