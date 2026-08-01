import { describe, expect, it } from "vitest";
import { lastDayOfMonth } from "@/lib/finance/dates";
import { plannedOccurrenceAt, duePlannedDates } from "@/lib/finance/planned";
import { bookingOccurrenceAt, dueBookings } from "@/lib/finance/contract-bookings";
import type { Contract, PlannedCashflow } from "@/lib/types";

// "The last day of the month" as a schedule. The day-of-month clamp cannot
// express it: it walks a start date forward and only shortens it where the
// target month is shorter, so a plan anchored on the 28th stays on the 28th
// forever. Hence a stored flag rather than something read off the start date.

function plan(over: Partial<PlannedCashflow> = {}): PlannedCashflow {
  return {
    id: "p1",
    name: "Rent",
    accountId: "a1",
    categoryId: null,
    amount: -900,
    interval: "MONTHLY",
    startDate: "2026-01-15",
    endDate: null,
    lastBookedDate: null,
    transferAccountId: null,
    note: null,
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
    bookingStartDate: "2026-01-15",
    lastBookedDate: null,
    ...over,
  } as Contract;
}

describe("lastDayOfMonth", () => {
  it("finds the end of long, short and leap months", () => {
    expect(lastDayOfMonth("2026-01-01")).toBe("2026-01-31");
    expect(lastDayOfMonth("2026-04-10")).toBe("2026-04-30");
    expect(lastDayOfMonth("2026-02-05")).toBe("2026-02-28");
    expect(lastDayOfMonth("2024-02-05")).toBe("2024-02-29");
  });

  it("is idempotent on a date that already is the last day", () => {
    expect(lastDayOfMonth("2026-01-31")).toBe("2026-01-31");
  });
});

describe("month-end planned occurrences", () => {
  it("ignores the anchor day entirely", () => {
    const p = plan({ monthEnd: true });
    expect(plannedOccurrenceAt(p, 0)).toBe("2026-01-31");
    expect(plannedOccurrenceAt(p, 1)).toBe("2026-02-28");
    expect(plannedOccurrenceAt(p, 2)).toBe("2026-03-31");
    expect(plannedOccurrenceAt(p, 3)).toBe("2026-04-30");
  });

  it("keeps the literal day when the flag is off", () => {
    // The regression this flag exists for: a plan anchored on the 28th never
    // reaches the 31st on its own, however many months pass.
    const p = plan({ startDate: "2026-02-28" });
    expect(plannedOccurrenceAt(p, 1)).toBe("2026-03-28");
    expect(plannedOccurrenceAt({ ...p, monthEnd: true }, 1)).toBe("2026-03-31");
  });

  it("does not disturb an unflagged plan", () => {
    const p = plan({ startDate: "2026-01-30" });
    expect(plannedOccurrenceAt(p, 1)).toBe("2026-02-28");
    expect(plannedOccurrenceAt(p, 2)).toBe("2026-03-30");
  });

  it("leaves weekly and one-off alone", () => {
    // "The last day of the month, weekly" is not a schedule, and a one-off is
    // a date the user picked outright.
    const weekly = plan({ interval: "WEEKLY", startDate: "2026-03-02", monthEnd: true });
    expect(plannedOccurrenceAt(weekly, 1)).toBe("2026-03-09");
    const once = plan({ interval: "ONCE", startDate: "2026-03-02", monthEnd: true });
    expect(plannedOccurrenceAt(once, 0)).toBe("2026-03-02");
  });

  it("carries into the due list", () => {
    const p = plan({ monthEnd: true, startDate: "2026-01-15" });
    expect(duePlannedDates(p, "2026-03-15")).toEqual(["2026-01-31", "2026-02-28"]);
  });

  it("honours quarterly and annual cadences", () => {
    expect(plannedOccurrenceAt(plan({ interval: "QUARTERLY", monthEnd: true }), 1)).toBe(
      "2026-04-30",
    );
    expect(plannedOccurrenceAt(plan({ interval: "ANNUAL", monthEnd: true }), 1)).toBe("2027-01-31");
  });
});

describe("month-end contract bookings", () => {
  it("pins each booking to the month's end", () => {
    expect(bookingOccurrenceAt("2026-01-15", "MONTHLY", 1, true)).toBe("2026-02-28");
    expect(bookingOccurrenceAt("2026-01-15", "MONTHLY", 3, true)).toBe("2026-04-30");
  });

  it("defaults to the literal day, so existing contracts do not move", () => {
    expect(bookingOccurrenceAt("2026-01-15", "MONTHLY", 1)).toBe("2026-02-15");
  });

  it("carries into the due list", () => {
    expect(dueBookings(contract({ monthEnd: true }), "2026-03-15")).toEqual([
      "2026-01-31",
      "2026-02-28",
    ]);
  });
});
