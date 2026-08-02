import { describe, expect, it } from "vitest";
import {
  MAX_DUE_BOOKINGS,
  booksSpending,
  bookingOccurrenceAt,
  dueBookings,
  nextBooking,
  pendingBookings,
} from "@/lib/finance/contract-bookings";
import type { Account, Contract } from "@/lib/types";

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    id: "c1",
    name: "Netflix",
    amount: 12.99,
    interval: "MONTHLY",
    renewalDate: null,
    cancellationNoticeDays: null,
    categoryId: null,
    accountId: "acc-1",
    bookingStartDate: "2024-01-15",
    lastBookedDate: null,
    ...overrides,
  };
}

describe("bookingOccurrenceAt", () => {
  it("steps by one month, three months and a year", () => {
    expect(bookingOccurrenceAt("2024-01-15", "MONTHLY", 2)).toBe("2024-03-15");
    expect(bookingOccurrenceAt("2024-01-15", "QUARTERLY", 2)).toBe("2024-07-15");
    expect(bookingOccurrenceAt("2024-01-15", "ANNUAL", 2)).toBe("2026-01-15");
  });

  it("clamps a month-end start to shorter months", () => {
    expect(bookingOccurrenceAt("2024-01-31", "MONTHLY", 1)).toBe("2024-02-29");
    expect(bookingOccurrenceAt("2023-01-31", "MONTHLY", 1)).toBe("2023-02-28");
  });
});

describe("booksSpending", () => {
  it("is false without an account or without a start date", () => {
    expect(booksSpending(contract({ accountId: null }))).toBe(false);
    expect(booksSpending(contract({ bookingStartDate: null }))).toBe(false);
    expect(booksSpending(contract())).toBe(true);
  });

  it("treats a contract predating booking as register-only", () => {
    // Fields absent entirely, as on every row before migration 0095.
    expect(booksSpending({ accountId: undefined, bookingStartDate: undefined })).toBe(false);
  });
});

describe("dueBookings", () => {
  it("returns every occurrence up to today when never booked", () => {
    expect(dueBookings(contract(), "2024-03-20")).toEqual([
      "2024-01-15",
      "2024-02-15",
      "2024-03-15",
    ]);
  });

  it("excludes dates already booked", () => {
    const c = contract({ lastBookedDate: "2024-02-15" });
    expect(dueBookings(c, "2024-04-20")).toEqual(["2024-03-15", "2024-04-15"]);
  });

  it("returns nothing when the start date is still in the future", () => {
    expect(dueBookings(contract({ bookingStartDate: "2025-01-15" }), "2024-06-01")).toEqual([]);
  });

  it("returns nothing for a register-only contract", () => {
    expect(dueBookings(contract({ accountId: null }), "2030-01-01")).toEqual([]);
  });

  it("caps a long-dormant contract instead of flooding the review", () => {
    expect(dueBookings(contract({ bookingStartDate: "2000-01-15" }), "2030-01-01")).toHaveLength(
      MAX_DUE_BOOKINGS,
    );
  });
});

describe("nextBooking", () => {
  it("gives the upcoming date, not a past one", () => {
    expect(nextBooking(contract({ lastBookedDate: "2024-03-15" }), "2024-03-20")).toBe("2024-04-15");
  });

  it("is null for a register-only contract", () => {
    expect(nextBooking(contract({ accountId: null }), "2024-03-20")).toBeNull();
  });
});

describe("pendingBookings", () => {
  it("books a contract charge as a negative amount", () => {
    const rows = pendingBookings([contract()], "2024-01-20");
    expect(rows).toEqual([
      {
        contractId: "c1",
        contractName: "Netflix",
        accountId: "acc-1",
        categoryId: null,
        date: "2024-01-15",
        amount: -12.99,
        interestAmount: 0,
        transferAccountId: null,
      },
    ]);
  });

  it("splits a loan instalment into interest and principal", () => {
    // 100,000 outstanding at 12 % p.a. = 1 % a month = 1,000 interest, so a
    // 1,500 instalment repays 500. Booking the whole 1,500 as a transfer would
    // hide the 1,000 from every expense figure.
    const loan: Account = {
      id: "acc-loan",
      name: "Loan",
      kind: "loan",
      currency: null,
      isLiability: true,
      openingBalance: 100_000,
      openedOn: "2023-01-01",
      interestRate: 12,
    };
    const rows = pendingBookings(
      [contract({ name: "Instalment", amount: 1500, targetAccountId: "acc-loan" })],
      "2024-01-20",
      [loan],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(-1500);
    expect(rows[0].interestAmount).toBeCloseTo(1000, 6);
    expect(rows[0].transferAccountId).toBe("acc-loan");
  });

  it("does not split when the target is not an interest-bearing liability", () => {
    const policy: Account = {
      id: "acc-policy",
      name: "Policy",
      kind: "other_asset",
      currency: null,
      isLiability: false,
      openingBalance: 0,
      openedOn: "2023-01-01",
    };
    const rows = pendingBookings(
      [contract({ name: "Riester", amount: 250, targetAccountId: "acc-policy" })],
      "2024-01-20",
      [policy],
      [],
    );
    expect(rows[0].interestAmount).toBe(0);
  });

  it("carries the target account so the booking counts as a transfer", () => {
    // A Riester premium or a loan instalment: money moved, not consumed.
    const rows = pendingBookings(
      [contract({ name: "Riester", amount: 250, targetAccountId: "acc-policy" })],
      "2024-01-20",
    );
    expect(rows[0]).toMatchObject({ amount: -250, transferAccountId: "acc-policy" });
  });

  it("keeps the charge an expense even if the amount was stored negative", () => {
    const rows = pendingBookings([contract({ amount: -12.99 })], "2024-01-20");
    expect(rows[0].amount).toBe(-12.99);
  });

  it("merges contracts in date order", () => {
    const rows = pendingBookings(
      [
        contract({ id: "c1", name: "Netflix", bookingStartDate: "2024-01-20" }),
        contract({ id: "c2", name: "Rent", bookingStartDate: "2024-01-05" }),
      ],
      "2024-01-31",
    );
    expect(rows.map((r) => [r.date, r.contractName])).toEqual([
      ["2024-01-05", "Rent"],
      ["2024-01-20", "Netflix"],
    ]);
  });

  it("skips register-only contracts entirely", () => {
    expect(pendingBookings([contract({ accountId: null })], "2024-06-01")).toEqual([]);
  });
});

describe("pausing a contract", () => {
  it("stops due bookings and the next date, without touching what was booked", () => {
    const paused = contract({ active: false, lastBookedDate: "2024-02-15" });
    expect(booksSpending(paused)).toBe(false);
    expect(dueBookings(paused, "2024-06-01")).toEqual([]);
    expect(nextBooking(paused, "2024-06-01")).toBeNull();
    expect(pendingBookings([paused], "2024-06-01")).toEqual([]);
  });

  it("keeps booking a row stored before pausing existed", () => {
    // `active` is absent, not false: every contract written before migration
    // 0118 has to keep running.
    const legacy = contract();
    expect(booksSpending(legacy)).toBe(true);
    expect(dueBookings(legacy, "2024-03-01")).toEqual(["2024-01-15", "2024-02-15"]);
  });

  it("resumes from today, not from the whole paused stretch", () => {
    const resumed = contract({ active: true, lastBookedDate: "2024-02-15" });
    expect(nextBooking(resumed, "2024-06-01")).toBe("2024-06-15");
  });
});
