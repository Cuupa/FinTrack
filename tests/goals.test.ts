import { describe, expect, it } from "vitest";
import { goalProgress, goalProgressPct, requiredMonthlyContribution } from "@/lib/finance/goals";
import type { Account, AccountBalance, Goal } from "@/lib/types";

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "g1",
    name: "Emergency fund",
    targetAmount: 10000,
    targetDate: null,
    linkedAccountId: null,
    manualCurrentAmount: null,
    ...overrides,
  };
}

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "a1",
    name: "Savings",
    kind: "savings",
    currency: null,
    isLiability: false,
    openingBalance: 1000,
    openedOn: "2024-01-01",
    ...overrides,
  };
}

describe("goalProgress", () => {
  it("returns the manual amount when there is no linked account", () => {
    const g = goal({ manualCurrentAmount: 2500 });
    expect(goalProgress(g, [], [])).toBe(2500);
  });

  it("treats an unset manual amount as 0", () => {
    const g = goal({ manualCurrentAmount: null });
    expect(goalProgress(g, [], [])).toBe(0);
  });

  it("uses the linked account's current balance", () => {
    const a = account({ openingBalance: 1000 });
    const balances: AccountBalance[] = [{ accountId: "a1", date: "2024-06-01", balance: 4000 }];
    const g = goal({ linkedAccountId: "a1", manualCurrentAmount: 999 });
    expect(goalProgress(g, [a], balances)).toBe(4000);
  });

  it("counts what has been repaid when the linked account is a liability", () => {
    // 12000 borrowed, 7500 still owed -> 4500 paid off.
    const loan = account({ kind: "loan", isLiability: true, openingBalance: 12000 });
    const balances: AccountBalance[] = [{ accountId: "a1", date: "2024-06-01", balance: 7500 }];
    const g = goal({ name: "Pay off car loan", targetAmount: 12000, linkedAccountId: "a1" });
    expect(goalProgress(g, [loan], balances)).toBe(4500);
  });

  it("reports a fully repaid liability as complete", () => {
    const loan = account({ kind: "loan", isLiability: true, openingBalance: 12000 });
    const balances: AccountBalance[] = [{ accountId: "a1", date: "2024-06-01", balance: 0 }];
    const g = goal({ targetAmount: 12000, linkedAccountId: "a1" });
    expect(goalProgress(g, [loan], balances)).toBe(12000);
    expect(goalProgressPct(g.targetAmount, goalProgress(g, [loan], balances))).toBe(100);
  });

  it("clamps payoff progress at 0 when the debt grew past its original amount", () => {
    const loan = account({ kind: "loan", isLiability: true, openingBalance: 12000 });
    const balances: AccountBalance[] = [{ accountId: "a1", date: "2024-06-01", balance: 15000 }];
    const g = goal({ targetAmount: 12000, linkedAccountId: "a1" });
    expect(goalProgress(g, [loan], balances)).toBe(0);
  });

  it("FX-converts a linked account's native-currency balance to base", () => {
    const a = account({ currency: "USD", openingBalance: 1000 });
    const g = goal({ linkedAccountId: "a1" });
    expect(goalProgress(g, [a], [], { base: "EUR", fx: { USD: 0.9 } })).toBe(900);
  });

  it("falls back to spot rate 1 when no FX rate is known for the account currency", () => {
    const a = account({ currency: "USD", openingBalance: 1000 });
    const g = goal({ linkedAccountId: "a1" });
    expect(goalProgress(g, [a], [], { base: "EUR" })).toBe(1000);
  });

  it("falls back to 0 when the linked account no longer exists", () => {
    const g = goal({ linkedAccountId: "gone", manualCurrentAmount: 500 });
    expect(goalProgress(g, [], [])).toBe(0);
  });
});

describe("goalProgressPct", () => {
  it("clamps at 0 for a negative/zero current amount", () => {
    expect(goalProgressPct(1000, -50)).toBe(0);
    expect(goalProgressPct(1000, 0)).toBe(0);
  });

  it("clamps at 100 once the target is exceeded", () => {
    expect(goalProgressPct(1000, 1500)).toBe(100);
    expect(goalProgressPct(1000, 1000)).toBe(100);
  });

  it("computes the plain percentage in between", () => {
    expect(goalProgressPct(1000, 250)).toBe(25);
  });

  it("returns 0 for a non-positive target instead of dividing by zero", () => {
    expect(goalProgressPct(0, 100)).toBe(0);
  });
});

describe("requiredMonthlyContribution", () => {
  it("is null when there is no target date", () => {
    const g = goal({ targetDate: null });
    expect(requiredMonthlyContribution(g, 0, "2024-01-01")).toBeNull();
  });

  it("is null once the target is already met", () => {
    const g = goal({ targetAmount: 1000, targetDate: "2025-01-01" });
    expect(requiredMonthlyContribution(g, 1000, "2024-01-01")).toBeNull();
    expect(requiredMonthlyContribution(g, 1500, "2024-01-01")).toBeNull();
  });

  it("divides the remaining amount by the months remaining", () => {
    // ~12 months between 2024-01-01 and 2025-01-01.
    const g = goal({ targetAmount: 12000, targetDate: "2025-01-01" });
    const result = requiredMonthlyContribution(g, 0, "2024-01-01");
    expect(result).not.toBeNull();
    expect(result!).toBeCloseTo(12000 / (366 / 30.44), 1);
  });

  it("floors months remaining at 1 for a due-today target date", () => {
    const g = goal({ targetAmount: 1000, targetDate: "2024-01-01" });
    const result = requiredMonthlyContribution(g, 0, "2024-01-01");
    expect(result).toBe(1000);
  });

  it("never produces a negative or infinite result for a past-due target date", () => {
    const g = goal({ targetAmount: 1000, targetDate: "2023-01-01" });
    const result = requiredMonthlyContribution(g, 0, "2024-01-01");
    expect(result).not.toBeNull();
    expect(Number.isFinite(result!)).toBe(true);
    expect(result!).toBeGreaterThan(0);
  });
});
