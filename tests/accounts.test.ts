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

// Credit interest on an ASSET account (Tagesgeld/Sparkonto). Unlike a
// liability's rate, it needs no ledger movement to take effect: a savings
// account whose balance was typed in once is exactly the case that has to
// work.
describe("credit interest on asset accounts", () => {
  const savings = (overrides: Partial<Account> = {}) =>
    account({ kind: "savings", openingBalance: 1000, interestRate: 12, ...overrides });

  it("compounds monthly onto a balance nobody ever moved", () => {
    const a = savings();
    // 1 % a month, credited on each anniversary of 1 Jan: eleven postings by
    // 31 Dec (1 Feb ... 1 Dec).
    expect(accountBalanceOn(a, [], "2024-12-31")).toBeCloseTo(1000 * 1.01 ** 11, 6);
  });

  it("charges a quarter's worth per posting when credited quarterly", () => {
    const a = savings({ interestFrequency: "QUARTERLY" });
    // Two postings in six months, 3 % each.
    expect(accountBalanceOn(a, [], "2024-07-01")).toBeCloseTo(1000 * 1.03 ** 2, 6);
    // ...and none before the first one falls due.
    expect(accountBalanceOn(a, [], "2024-03-31")).toBe(1000);
  });

  it("credits annually on the account's anniversary", () => {
    const a = savings({ interestFrequency: "ANNUAL" });
    expect(accountBalanceOn(a, [], "2024-12-31")).toBe(1000);
    expect(accountBalanceOn(a, [], "2025-01-01")).toBeCloseTo(1120, 6);
  });

  it("a dated reading re-anchors and interest continues from it", () => {
    const a = savings();
    const balances: AccountBalance[] = [{ accountId: "a1", date: "2024-06-01", balance: 5000 }];
    // The statement is the truth: everything accrued before it is discarded.
    expect(accountBalanceOn(a, balances, "2024-06-01")).toBe(5000);
    expect(accountBalanceOn(a, balances, "2024-07-01")).toBeCloseTo(5050, 6);
  });

  it("does nothing without a rate, or with a zero rate", () => {
    expect(accountBalanceOn(account(), [], "2030-01-01")).toBe(1000);
    expect(accountBalanceOn(savings({ interestRate: 0 }), [], "2030-01-01")).toBe(1000);
  });

  // A liability keeps its old gate: a rate may exist purely for the payoff
  // planner, and nobody's net worth may shift because of that.
  it("leaves a liability with no ledger movements alone", () => {
    const loan = account({ kind: "loan", isLiability: true, interestRate: 12 });
    expect(accountBalanceOn(loan, [], "2025-01-01")).toBe(1000);
  });

  // The one that made the whole feature necessary: without a horizon of
  // "today" the rate would silently do nothing until some unrelated event
  // moved the account.
  it("current balance accrues up to today with no events at all", () => {
    const a = savings({ openedOn: "2020-01-01" });
    expect(currentAccountBalance(a, [])).toBeGreaterThan(1000);
    expect(accountsTotals([a], []).assets).toBeGreaterThan(1000);
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
