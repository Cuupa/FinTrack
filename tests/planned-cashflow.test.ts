import { describe, expect, it } from "vitest";
import {
  duePlannedBookings,
  duePlannedDates,
  monthlyEquivalent,
  nextPlannedOccurrence,
  plannedForecast,
  plannedMonthlyTotals,
  plannedOccurrenceAt,
  plannedOccurrences,
  MAX_DUE_PLANNED,
} from "@/lib/finance/planned";
import type {
  Account,
  Contract,
  PlannedCashflow,
  PlannedInterval,
  SpendingTransaction,
} from "@/lib/types";

function plan(over: Partial<PlannedCashflow> = {}): PlannedCashflow {
  return {
    id: "p1",
    name: "Salary",
    accountId: "a1",
    categoryId: null,
    amount: 2500,
    interval: "MONTHLY",
    startDate: "2026-01-30",
    endDate: null,
    lastBookedDate: null,
    transferAccountId: null,
    note: null,
    ...over,
  };
}

function account(over: Partial<Account> = {}): Account {
  return {
    id: "a1",
    name: "Checking",
    kind: "checking",
    currency: null,
    isLiability: false,
    openingBalance: 0,
    openedOn: "2020-01-01",
    ...over,
  };
}

function tx(over: Partial<SpendingTransaction> = {}): SpendingTransaction {
  return {
    id: "t1",
    accountId: "a1",
    categoryId: null,
    date: "2026-03-05",
    amount: -100,
    payee: "Shop",
    note: null,
    recurringId: null,
    ...over,
  };
}

function contract(over: Partial<Contract> = {}): Contract {
  return {
    id: "c1",
    name: "Rent",
    amount: 900,
    interval: "MONTHLY",
    renewalDate: null,
    cancellationNoticeDays: null,
    categoryId: null,
    accountId: "a1",
    bookingStartDate: "2026-01-01",
    lastBookedDate: null,
    targetAccountId: null,
    ...over,
  };
}

describe("plannedOccurrenceAt", () => {
  it("clamps the day of month to shorter months", () => {
    const p = plan({ startDate: "2026-01-31" });
    expect(plannedOccurrenceAt(p, 0)).toBe("2026-01-31");
    expect(plannedOccurrenceAt(p, 1)).toBe("2026-02-28");
    expect(plannedOccurrenceAt(p, 2)).toBe("2026-03-31");
  });

  it("has exactly one occurrence for ONCE", () => {
    const p = plan({ interval: "ONCE", startDate: "2026-08-01" });
    expect(plannedOccurrenceAt(p, 0)).toBe("2026-08-01");
    expect(plannedOccurrenceAt(p, 1)).toBeNull();
  });

  it("steps weekly, quarterly and annually", () => {
    expect(plannedOccurrenceAt(plan({ interval: "WEEKLY", startDate: "2026-03-02" }), 3)).toBe(
      "2026-03-23",
    );
    expect(plannedOccurrenceAt(plan({ interval: "QUARTERLY", startDate: "2026-01-15" }), 2)).toBe(
      "2026-07-15",
    );
    expect(plannedOccurrenceAt(plan({ interval: "ANNUAL", startDate: "2026-01-15" }), 2)).toBe(
      "2028-01-15",
    );
  });
});

describe("plannedOccurrences", () => {
  it("returns the dates inside the window only", () => {
    const dates = plannedOccurrences(plan({ startDate: "2026-01-15" }), "2026-03-01", "2026-05-31");
    expect(dates).toEqual(["2026-03-15", "2026-04-15", "2026-05-15"]);
  });

  it("stops at endDate", () => {
    const dates = plannedOccurrences(
      plan({ startDate: "2026-01-15", endDate: "2026-03-31" }),
      "2026-01-01",
      "2026-12-31",
    );
    expect(dates).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"]);
  });
});

describe("nextPlannedOccurrence", () => {
  it("skips what has already been booked", () => {
    const p = plan({ startDate: "2026-01-30", lastBookedDate: "2026-03-30" });
    expect(nextPlannedOccurrence(p, "2026-03-31")).toBe("2026-04-30");
  });

  it("is null once a ONCE entry is booked", () => {
    const p = plan({ interval: "ONCE", startDate: "2026-02-01", lastBookedDate: "2026-02-01" });
    expect(nextPlannedOccurrence(p, "2026-02-02")).toBeNull();
  });

  it("is null past endDate", () => {
    const p = plan({ startDate: "2026-01-15", endDate: "2026-02-28" });
    expect(nextPlannedOccurrence(p, "2026-06-01")).toBeNull();
  });
});

describe("monthlyEquivalent", () => {
  it("normalises every recurring interval", () => {
    const cases: [PlannedInterval, number | null][] = [
      ["MONTHLY", 1200],
      ["QUARTERLY", 400],
      ["ANNUAL", 100],
      ["ONCE", null],
    ];
    for (const [interval, expected] of cases) {
      expect(monthlyEquivalent(plan({ interval, amount: 1200 }))).toBe(expected);
    }
    expect(monthlyEquivalent(plan({ interval: "WEEKLY", amount: 120 }))).toBeCloseTo(520, 6);
  });

  it("keeps the sign of an expense", () => {
    expect(monthlyEquivalent(plan({ amount: -300, interval: "QUARTERLY" }))).toBe(-100);
  });
});

describe("duePlannedDates / duePlannedBookings", () => {
  it("returns everything up to today, once", () => {
    const p = plan({ startDate: "2026-01-30" });
    expect(duePlannedDates(p, "2026-03-31")).toEqual(["2026-01-30", "2026-02-28", "2026-03-30"]);
  });

  it("skips dates already booked", () => {
    const p = plan({ startDate: "2026-01-30", lastBookedDate: "2026-02-28" });
    expect(duePlannedDates(p, "2026-03-31")).toEqual(["2026-03-30"]);
  });

  it("caps a plan whose start sits years in the past", () => {
    const p = plan({ interval: "WEEKLY", startDate: "2020-01-01" });
    expect(duePlannedDates(p, "2026-07-26")).toHaveLength(MAX_DUE_PLANNED);
  });

  it("flattens plans into date-sorted bookings carrying the plan's sign", () => {
    const rows = duePlannedBookings(
      [
        plan({ id: "p1", startDate: "2026-03-01" }),
        plan({ id: "p2", name: "Insurance", amount: -80, startDate: "2026-02-15" }),
      ],
      "2026-03-05",
    );
    // p2's next occurrence is the 15th of March, still ahead of `today`.
    expect(rows.map((r) => [r.date, r.plannedId, r.amount])).toEqual([
      ["2026-02-15", "p2", -80],
      ["2026-03-01", "p1", 2500],
    ]);
  });
});

describe("plannedForecast", () => {
  const accounts = [account()];

  it("keeps a due but unbooked occurrence in the current month", () => {
    const months = plannedForecast({
      // Due on the 5th, never booked: the ledger has no row for it yet, so the
      // forecast must still show it as expected money.
      plans: [plan({ startDate: "2026-03-05" })],
      contracts: [],
      transactions: [],
      accounts: [account()],
      base: "EUR",
      today: "2026-03-10",
      months: 1,
    });
    expect(months[0].plannedIncome).toBe(2500);
  });

  it("mixes actuals with what is still coming in the current month", () => {
    const months = plannedForecast({
      plans: [plan({ startDate: "2026-03-30" })],
      contracts: [],
      transactions: [tx({ date: "2026-03-05", amount: -100 })],
      accounts,
      base: "EUR",
      today: "2026-03-10",
      months: 2,
    });
    expect(months[0].month).toBe("2026-03");
    expect(months[0].actualExpense).toBe(100);
    expect(months[0].plannedIncome).toBe(2500);
    expect(months[0].projectedNet).toBe(2400);
    // April is pure planning.
    expect(months[1]).toMatchObject({ month: "2026-04", actualIncome: 0, plannedIncome: 2500 });
    expect(months[1].projectedCumulative).toBe(4900);
  });

  it("never counts an occurrence that is already booked", () => {
    const months = plannedForecast({
      // Booked on the 1st, so the March payment must not be added again on top
      // of the transaction it produced.
      plans: [plan({ startDate: "2026-03-01", lastBookedDate: "2026-03-01" })],
      contracts: [],
      transactions: [tx({ date: "2026-03-01", amount: 2500, payee: "Salary", plannedId: "p1" })],
      accounts,
      base: "EUR",
      today: "2026-03-02",
      months: 1,
    });
    expect(months[0].actualIncome).toBe(2500);
    expect(months[0].plannedIncome).toBe(0);
  });

  it("includes a contract's still-due charges as planned expense", () => {
    const months = plannedForecast({
      plans: [],
      contracts: [contract({ amount: 900, lastBookedDate: "2026-03-01" })],
      transactions: [],
      accounts,
      base: "EUR",
      today: "2026-03-10",
      months: 2,
    });
    expect(months[0].plannedExpense).toBe(0); // March already booked
    expect(months[1].plannedExpense).toBe(900);
  });

  it("ignores register-only contracts", () => {
    // No account and no start date: it never posts anything, so forecasting it
    // would invent an expense out of a note.
    const months = plannedForecast({
      plans: [],
      contracts: [contract({ id: "c2", accountId: null, bookingStartDate: null })],
      transactions: [],
      accounts,
      base: "EUR",
      today: "2026-03-10",
      months: 2,
    });
    for (const m of months) {
      expect(m.plannedExpense).toBe(0);
      expect(m.actualExpense).toBe(0);
    }
  });

  it("counts a transfer OUT of the liquid pool as cash flowing out", () => {
    // A loan instalment is not an expense (net worth is unchanged), but the
    // cash does leave the current account. Dropping it made a ledger built
    // mostly of instalments forecast nothing at all -- `a2` here is a loan,
    // i.e. not part of the liquid pool.
    const loan = account({ id: "a2", kind: "loan", isLiability: true });
    const months = plannedForecast({
      plans: [plan({ transferAccountId: "a2", startDate: "2026-04-01", amount: -300 })],
      contracts: [contract({ id: "c3", targetAccountId: "a2" })],
      transactions: [tx({ date: "2026-03-20", amount: -500, transferAccountId: "a2" })],
      accounts: [...accounts, loan],
      base: "EUR",
      today: "2026-03-10",
      months: 2,
    });
    expect(months[0].actualExpense).toBe(500);
    expect(months[1].plannedExpense).toBeGreaterThan(0);
  });

  it("nets a liquid-to-liquid transfer to zero", () => {
    // Current account -> savings: moved, not spent, and the cash never left
    // the pool, so counting it either way would be wrong.
    const savings = account({ id: "a2", kind: "savings" });
    const months = plannedForecast({
      plans: [],
      contracts: [],
      transactions: [tx({ date: "2026-03-20", amount: -500, transferAccountId: "a2" })],
      accounts: [...accounts, savings],
      base: "EUR",
      today: "2026-03-10",
      months: 2,
    });
    expect(months[0].actualExpense).toBe(0);
    expect(months[0].actualIncome).toBe(0);
  });

  it("converts a foreign-currency account's plan at spot", () => {
    const months = plannedForecast({
      plans: [plan({ accountId: "usd", startDate: "2026-04-01", amount: 1000 })],
      contracts: [],
      transactions: [],
      accounts: [account({ id: "usd", currency: "USD" })],
      base: "EUR",
      fx: { USD: 0.9 },
      today: "2026-03-10",
      months: 2,
    });
    expect(months[1].plannedIncome).toBeCloseTo(900, 6);
  });

  it("returns nothing for a non-positive window", () => {
    expect(
      plannedForecast({
        plans: [plan()],
        contracts: [],
        transactions: [],
        accounts,
        base: "EUR",
        today: "2026-03-10",
        months: 0,
      }),
    ).toEqual([]);
  });
});

describe("plannedMonthlyTotals", () => {
  it("sums recurring plans per month, dropping ONCE and transfers", () => {
    const totals = plannedMonthlyTotals(
      [
        plan({ id: "p1", amount: 2400 }),
        plan({ id: "p2", amount: -600, interval: "QUARTERLY" }),
        plan({ id: "p3", amount: 5000, interval: "ONCE" }),
        plan({ id: "p4", amount: -300, transferAccountId: "a2" }),
      ],
      [account()],
      "EUR",
    );
    expect(totals).toEqual({ income: 2400, expense: 200, net: 2200 });
  });

  it("converts foreign-currency accounts at spot", () => {
    const totals = plannedMonthlyTotals(
      [plan({ accountId: "usd", amount: 1000 })],
      [account({ id: "usd", currency: "USD" })],
      "EUR",
      { USD: 0.9 },
    );
    expect(totals.income).toBeCloseTo(900, 6);
  });
});
