import { describe, expect, it } from "vitest";
import {
  booksPremiums,
  duePremiums,
  nextPremium,
  pendingPremiums,
} from "../lib/finance/pension-bookings";
import { MAX_DUE_BOOKINGS } from "../lib/finance/contract-bookings";
import type { PensionContract } from "../lib/types";

function contract(over: Partial<PensionContract> = {}): PensionContract {
  return {
    id: "c1",
    name: "Allianz",
    kind: "private",
    provider: null,
    monthlyContribution: 100,
    currentValue: null,
    expectedMonthlyPension: null,
    rentenfaktor: null,
    contributionDynamicPct: null,
    expectedReturnPct: null,
    startsOn: null,
    accountId: "acc1",
    bookingStartDate: "2026-01-15",
    lastBookedDate: null,
    note: null,
    ...over,
  };
}

describe("booksPremiums", () => {
  it("needs an account, a start date and a premium", () => {
    expect(booksPremiums(contract())).toBe(true);
    expect(booksPremiums(contract({ accountId: null }))).toBe(false);
    expect(booksPremiums(contract({ bookingStartDate: null }))).toBe(false);
    expect(booksPremiums(contract({ monthlyContribution: 0 }))).toBe(false);
  });
});

describe("duePremiums", () => {
  it("counts one premium a month up to today", () => {
    expect(duePremiums(contract(), "2026-04-20")).toEqual([
      "2026-01-15",
      "2026-02-15",
      "2026-03-15",
      "2026-04-15",
    ]);
  });

  it("skips everything already booked", () => {
    expect(duePremiums(contract({ lastBookedDate: "2026-03-15" }), "2026-04-20")).toEqual([
      "2026-04-15",
    ]);
  });

  it("never dumps more than the review cap at once", () => {
    expect(duePremiums(contract({ bookingStartDate: "2000-01-15" }), "2026-04-20")).toHaveLength(
      MAX_DUE_BOOKINGS,
    );
  });

  it("is empty for a policy that only records", () => {
    expect(duePremiums(contract({ accountId: null }), "2026-04-20")).toEqual([]);
  });
});

describe("nextPremium", () => {
  it("names the next unbooked date, null when nothing books", () => {
    expect(nextPremium(contract({ lastBookedDate: "2026-03-15" }), "2026-03-20")).toBe(
      "2026-04-15",
    );
    expect(nextPremium(contract({ accountId: null }), "2026-03-20")).toBeNull();
  });
});

describe("pendingPremiums", () => {
  it("debits the account, oldest first", () => {
    const rows = pendingPremiums([contract({ monthlyContribution: 250 })], "2026-02-20");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      contractId: "c1",
      contractName: "Allianz",
      accountId: "acc1",
      date: "2026-01-15",
      amount: -250,
    });
    expect(rows[1].date).toBe("2026-02-15");
  });
});
