import { describe, expect, it } from "vitest";
import {
  accountBalanceOn,
  accountValueOn,
  accountsTotals,
  accountsValueOn,
  balanceSeries,
  currentAccountBalance,
} from "@/lib/finance/accounts";
import { netWorthSeries } from "@/lib/finance/portfolio";
import type { Account, AccountBalance } from "@/lib/types";

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

describe("balanceSeries + carry-forward", () => {
  it("seeds the opening balance at openedOn", () => {
    const a = account();
    expect(balanceSeries(a, [])).toEqual([{ date: "2024-01-01", balance: 1000 }]);
  });

  it("a reading on the opening date overrides the opening balance", () => {
    const a = account();
    const balances: AccountBalance[] = [{ accountId: "a1", date: "2024-01-01", balance: 1500 }];
    expect(balanceSeries(a, balances)).toEqual([{ date: "2024-01-01", balance: 1500 }]);
  });

  it("orders readings ascending and carries forward", () => {
    const a = account();
    const balances: AccountBalance[] = [
      { accountId: "a1", date: "2024-06-01", balance: 1200 },
      { accountId: "a1", date: "2024-03-01", balance: 900 },
    ];
    expect(accountBalanceOn(a, balances, "2024-02-01")).toBe(1000); // opening
    expect(accountBalanceOn(a, balances, "2024-03-15")).toBe(900);
    expect(accountBalanceOn(a, balances, "2024-12-31")).toBe(1200);
  });

  it("contributes 0 before the account was opened", () => {
    const a = account();
    expect(accountBalanceOn(a, [], "2023-12-31")).toBe(0);
    expect(accountValueOn(a, [], "2023-12-31")).toBe(0);
  });

  it("current balance is the latest reading, else the opening balance", () => {
    const a = account();
    expect(currentAccountBalance(a, [])).toBe(1000);
    expect(
      currentAccountBalance(a, [{ accountId: "a1", date: "2024-05-01", balance: 2500 }]),
    ).toBe(2500);
  });

  it("ignores readings belonging to other accounts", () => {
    const a = account();
    const balances: AccountBalance[] = [{ accountId: "other", date: "2024-05-01", balance: 9 }];
    expect(currentAccountBalance(a, balances)).toBe(1000);
  });
});

describe("signed net-worth fold", () => {
  it("a liability subtracts its balance", () => {
    const loan = account({ id: "l1", kind: "loan", isLiability: true, openingBalance: 10000 });
    expect(accountValueOn(loan, [], "2024-02-01")).toBe(-10000);
  });

  it("net = assets - liabilities", () => {
    const checking = account({ id: "a1", openingBalance: 5000 });
    const loan = account({ id: "l1", kind: "loan", isLiability: true, openingBalance: 12000 });
    const totals = accountsTotals([checking, loan], []);
    expect(totals.assets).toBe(5000);
    expect(totals.liabilities).toBe(12000);
    expect(totals.net).toBe(-7000);
    expect(accountsValueOn([checking, loan], [], "2024-02-01")).toBe(-7000);
  });

  it("converts native balances to the base currency at spot", () => {
    const usd = account({ id: "u1", currency: "USD", openingBalance: 1000 });
    const v = { base: "EUR", fx: { USD: 0.9 } };
    expect(accountValueOn(usd, [], "2024-02-01", v)).toBeCloseTo(900);
    expect(accountsTotals([usd], [], v).assets).toBeCloseTo(900);
  });
});

describe("netWorthSeries accounts fold", () => {
  it("a €-10k loan drops net worth by 10k across the window", () => {
    const loan = account({ id: "l1", kind: "loan", isLiability: true, openingBalance: 10000 });
    const { points } = netWorthSeries([], [], "1M", { base: "EUR" }, undefined, [loan], []);
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) expect(p.value).toBe(-10000);
  });

  it("without accounts the series is unchanged (0 with no holdings)", () => {
    const { points } = netWorthSeries([], [], "1M", { base: "EUR" });
    for (const p of points) expect(p.value).toBe(0);
  });

  it("a dated balance change is reflected historically", () => {
    const a = account({ openedOn: "2020-01-01", openingBalance: 1000 });
    const balances: AccountBalance[] = [{ accountId: "a1", date: "2020-06-01", balance: 3000 }];
    const { points } = netWorthSeries([], [], "MAX", { base: "EUR" }, undefined, [a], balances);
    // Earliest sampled point uses the carry-forward opening balance...
    expect(points[0].value).toBe(1000);
    // ...and the most recent reflects the later reading.
    expect(points[points.length - 1].value).toBe(3000);
  });
});
