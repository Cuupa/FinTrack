import { describe, expect, it } from "vitest";
import {
  dueAccountInterest,
  interestIsAutomatic,
  nextAccountInterestDate,
} from "@/lib/finance/account-interest";
import { accountMovements } from "@/lib/finance/account-ledger";
import type { Account, SpendingTransaction } from "@/lib/types";

const account = (overrides: Partial<Account> = {}): Account => ({
  id: "a1",
  name: "Savings",
  kind: "savings",
  currency: null,
  isLiability: false,
  openingBalance: 1000,
  openedOn: "2024-01-01",
  interestRate: 12,
  interestFrequency: "MONTHLY",
  ...overrides,
});

const tx = (overrides: Partial<SpendingTransaction> = {}): SpendingTransaction => ({
  id: "tx",
  accountId: "a1",
  categoryId: null,
  date: "2024-01-01",
  amount: 0,
  payee: "test",
  note: null,
  recurringId: null,
  ...overrides,
});

describe("account interest recurring bookings", () => {
  it("creates a dynamic monthly due amount", () => {
    expect(dueAccountInterest(account(), [], [], new Map(), "2024-02-01")).toEqual([
      { accountId: "a1", date: "2024-02-01", amount: 10 },
    ]);
  });

  // A skipped occurrence leaves no transaction behind, so the cursor lives on
  // the account itself — without it the same row came back every reload.
  it("does not offer a skipped occurrence again", () => {
    const skipped = account({ interestSkippedUntil: "2024-02-01" });
    expect(dueAccountInterest(skipped, [], [], new Map(), "2024-02-01")).toEqual([]);
    expect(nextAccountInterestDate(skipped, [], "2024-02-01")).toBe("2024-03-01");
  });

  it("resumes after whichever cursor is later, booked or skipped", () => {
    const booked = tx({ interestAccountId: "a1", date: "2024-03-01" });
    const acc = account({ interestSkippedUntil: "2024-02-01" });
    expect(nextAccountInterestDate(acc, [booked], "2024-03-01")).toBe("2024-04-01");
  });

  it("does not offer an already booked occurrence twice", () => {
    const booked = tx({ interestAccountId: "a1", date: "2024-02-01" });
    expect(nextAccountInterestDate(account(), [booked], "2024-02-01")).toBe("2024-03-01");
    expect(dueAccountInterest(account(), [booked], [], new Map(), "2024-03-01")).toEqual([
      { accountId: "a1", date: "2024-03-01", amount: 10 },
    ]);
  });

  it("does not backfill every old anniversary on first use", () => {
    expect(dueAccountInterest(account(), [], [], new Map(), "2026-08-04")).toEqual([
      { accountId: "a1", date: "2026-08-01", amount: 10 },
    ]);
  });

  it("reaches today on an account older than the period cap", () => {
    const old = account({ openedOn: "2015-01-01" });
    expect(dueAccountInterest(old, [], [], new Map(), "2026-08-04")).toEqual([
      { accountId: "a1", date: "2026-08-01", amount: 10 },
    ]);
    expect(nextAccountInterestDate(old, [], "2026-08-04")).toBe("2026-09-01");
  });

  it("charges the follow-up rate once the fixed period ended", () => {
    const stepped = account({ rateFixedUntil: "2024-02-29", followUpRate: 24 });
    expect(dueAccountInterest(stepped, [], [], new Map(), "2024-02-01")).toEqual([
      { accountId: "a1", date: "2024-02-01", amount: 10 },
    ]);
    expect(dueAccountInterest(stepped, [], [], new Map(), "2024-03-01")).toEqual([
      { accountId: "a1", date: "2024-03-01", amount: 20 },
    ]);
  });

  // The lender charges it whatever the app thinks, so there is nothing to
  // review — see interestIsAutomatic.
  it("marks only a liability's interest as automatic", () => {
    expect(interestIsAutomatic(account())).toBe(false);
    expect(interestIsAutomatic(account({ isLiability: true, kind: "loan" }))).toBe(true);
  });

  it("books liability interest as a negative expense", () => {
    const loan = account({ id: "l1", isLiability: true, kind: "loan" });
    const payment = tx({ accountId: "a1", amount: -100, transferAccountId: "l1", date: "2024-01-15" });
    const movements = accountMovements([payment], [account({ id: "a1" }), loan]);
    expect(dueAccountInterest(loan, [], [], movements, "2024-02-01")).toEqual([
      { accountId: "l1", date: "2024-02-01", amount: -9 },
    ]);
  });
});
