import { describe, expect, it } from "vitest";
import { dueAccountInterest, nextAccountInterestDate } from "@/lib/finance/account-interest";
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

  it("does not offer an already booked occurrence twice", () => {
    const booked = tx({ interestAccountId: "a1", date: "2024-02-01" });
    expect(nextAccountInterestDate(account(), [booked], "2024-02-01")).toBe("2024-03-01");
    expect(dueAccountInterest(account(), [booked], [], new Map(), "2024-03-01")).toEqual([
      { accountId: "a1", date: "2024-03-01", amount: 10 },
    ]);
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
