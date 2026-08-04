import { describe, expect, it } from "vitest";
import { accountMovements, isLedgerDriven } from "@/lib/finance/account-ledger";
import { balanceSeries, currentAccountBalance } from "@/lib/finance/accounts";
import type { Account, SpendingTransaction } from "@/lib/types";

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

function tx(overrides: Partial<SpendingTransaction> = {}): SpendingTransaction {
  return {
    id: "t1",
    accountId: "a1",
    categoryId: null,
    date: "2024-02-01",
    amount: -50,
    payee: "Shop",
    note: null,
    recurringId: null,
    ...overrides,
  };
}

describe("accountMovements", () => {
  it("moves an asset account by the signed amount", () => {
    const moves = accountMovements(
      [tx({ amount: -50 }), tx({ id: "t2", amount: 200 })],
      [account()],
    );
    expect(moves.get("a1")).toEqual([
      { accountId: "a1", date: "2024-02-01", delta: -50 },
      { accountId: "a1", date: "2024-02-01", delta: 200 },
    ]);
  });

  it("inverts the sign on a liability: money arriving retires debt", () => {
    // Paying 300 onto a credit card is amount -300 on that account (money
    // leaves the user), but the DEBT magnitude must shrink by 300.
    const card = account({ id: "c1", isLiability: true, kind: "credit" });
    const moves = accountMovements([tx({ accountId: "c1", amount: -300 })], [card]);
    expect(moves.get("c1")).toEqual([{ accountId: "c1", date: "2024-02-01", delta: 300 }]);
  });

  it("counter-books a transfer on the receiving account", () => {
    const checking = account();
    const loan = account({ id: "l1", isLiability: true, kind: "loan", openingBalance: 10_000 });
    const moves = accountMovements(
      [tx({ amount: -450, transferAccountId: "l1" })],
      [checking, loan],
    );
    // Checking loses 450 ...
    expect(moves.get("a1")).toEqual([{ accountId: "a1", date: "2024-02-01", delta: -450 }]);
    // ... and the loan's outstanding magnitude falls by the same 450.
    expect(moves.get("l1")).toEqual([{ accountId: "l1", date: "2024-02-01", delta: -450 }]);
  });

  it("ignores a self-transfer and non-finite amounts", () => {
    const moves = accountMovements(
      [tx({ transferAccountId: "a1" }), tx({ id: "t2", amount: Number.NaN })],
      [account()],
    );
    expect(moves.get("a1")).toEqual([{ accountId: "a1", date: "2024-02-01", delta: -50 }]);
  });

  it("sorts each account's movements by date", () => {
    const moves = accountMovements(
      [tx({ id: "t2", date: "2024-03-01" }), tx({ id: "t1", date: "2024-01-15" })],
      [account()],
    );
    expect(moves.get("a1")?.map((m) => m.date)).toEqual(["2024-01-15", "2024-03-01"]);
  });

  it("isLedgerDriven only for accounts the ledger touches", () => {
    const moves = accountMovements([tx()], [account()]);
    expect(isLedgerDriven("a1", moves)).toBe(true);
    expect(isLedgerDriven("other", moves)).toBe(false);
    expect(isLedgerDriven("a1", undefined)).toBe(false);
  });
});

describe("balanceSeries with movements (anchor + carry-forward)", () => {
  it("carries the opening balance forward through bookings", () => {
    const a = account();
    const moves = accountMovements([tx({ amount: -50, date: "2024-02-01" })], [a]);
    expect(balanceSeries(a, [], moves)).toEqual([
      { date: "2024-01-01", balance: 1000 },
      { date: "2024-02-01", balance: 950 },
    ]);
  });

  it("a reading wins outright and re-anchors, discarding earlier movements", () => {
    // The bank says 800 on 2024-02-15. Whatever the ledger thought before that
    // date is wrong by definition, so the chain restarts from 800.
    const a = account();
    const moves = accountMovements(
      [tx({ amount: -50, date: "2024-02-01" }), tx({ id: "t2", amount: -20, date: "2024-03-01" })],
      [a],
    );
    const series = balanceSeries(a, [{ accountId: "a1", date: "2024-02-15", balance: 800 }], moves);
    expect(series).toEqual([
      { date: "2024-01-01", balance: 1000 },
      { date: "2024-02-01", balance: 950 },
      { date: "2024-02-15", balance: 800 },
      { date: "2024-03-01", balance: 780 },
    ]);
  });

  it("a reading dated the same day as a booking wins: a statement already contains it", () => {
    const a = account();
    const moves = accountMovements([tx({ amount: -50, date: "2024-02-01" })], [a]);
    const series = balanceSeries(a, [{ accountId: "a1", date: "2024-02-01", balance: 900 }], moves);
    // Not 900 - 50: the reading is the truth for that day.
    expect(series).toEqual([
      { date: "2024-01-01", balance: 1000 },
      { date: "2024-02-01", balance: 900 },
    ]);
  });

  it("without movements the series is the old step series, unchanged", () => {
    const a = account();
    const balances = [{ accountId: "a1", date: "2024-03-01", balance: 1200 }];
    expect(balanceSeries(a, balances)).toEqual(balanceSeries(a, balances, new Map()));
  });

  it("drops movements dated before the account existed", () => {
    const a = account();
    const moves = accountMovements([tx({ date: "2023-06-01" })], [a]);
    expect(balanceSeries(a, [], moves)).toEqual([{ date: "2024-01-01", balance: 1000 }]);
  });

  it("uses a zero-balance account's first movement as its effective start", () => {
    const sparkasse = account({ id: "sparkasse", openingBalance: 500 });
    const c24 = account({ id: "c24", openingBalance: 0, openedOn: "2024-08-03" });
    const moves = accountMovements(
      [
        tx({
          accountId: "sparkasse",
          amount: -200,
          date: "2024-07-31",
          transferAccountId: "c24",
        }),
      ],
      [sparkasse, c24],
    );

    expect(currentAccountBalance(c24, [], moves, "2024-08-03")).toBe(200);
  });
});

describe("interest accrual on a ledger-driven liability", () => {
  const loan = () =>
    account({
      id: "l1",
      kind: "loan",
      isLiability: true,
      openingBalance: 10_000,
      openedOn: "2024-01-01",
      interestRate: 12, // 1 % per month, keeps the arithmetic checkable by hand
    });

  it("does not accrue interest without a separate booking", () => {
    const l = loan();
    const moves = accountMovements(
      [tx({ id: "p1", accountId: "x", amount: -1000, date: "2024-02-01", transferAccountId: "l1" })],
      [account({ id: "x" }), l],
    );
    const series = balanceSeries(l, [], moves);
    const feb = series.find((p) => p.date === "2024-02-01");
    expect(feb?.balance).toBeCloseTo(9000, 6);
  });

  it("leaves a liability with a rate but no bookings on the old behaviour", () => {
    // Entering a rate for the payoff planner must not silently move anyone's
    // net worth: with no movements the series stays the plain step series.
    const l = loan();
    expect(balanceSeries(l, [])).toEqual([{ date: "2024-01-01", balance: 10_000 }]);
  });

  it("leaves asset interest out until it is booked", () => {
    const a = account({ interestRate: 12 });
    const moves = accountMovements([tx({ amount: -50, date: "2024-02-01" })], [a]);
    const series = balanceSeries(a, [], moves, "2024-02-01");
    const feb = series.find((p) => p.date === "2024-02-01");
    expect(feb?.balance).toBeCloseTo(950, 6);
  });

  it("leaves an asset account with no rate on the plain carry-forward", () => {
    const a = account();
    const moves = accountMovements([tx({ amount: -50, date: "2024-02-01" })], [a]);
    expect(currentAccountBalance(a, [], moves)).toBe(950);
  });
});
