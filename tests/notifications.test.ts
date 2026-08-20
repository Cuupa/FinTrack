import { describe, it, expect } from "vitest";
import {
  collectNotifications,
  notificationsByRoute,
  totalNotifications,
  kindAvailability,
  NOTIFICATION_KINDS,
  type NotificationInput,
  type NotificationKind,
} from "../lib/notifications/notifications";
import type { Account, Asset, Contract, PlannedCashflow, SavingsPlan } from "../lib/types";

const TODAY = "2026-08-02";

function allAvailable(over: Partial<Record<NotificationKind, boolean>> = {}) {
  const out = {} as Record<NotificationKind, boolean>;
  for (const kind of NOTIFICATION_KINDS) out[kind] = true;
  return { ...out, ...over };
}

function asset(over: Partial<Asset> = {}): Asset {
  return {
    id: "a1",
    isin: "IE00B4L5Y983",
    wkn: null,
    symbol: null,
    name: "World ETF",
    type: "ETF",
    currency: "EUR",
    notes: null,
    ...over,
  };
}

function plan(over: Partial<SavingsPlan> = {}): SavingsPlan {
  return {
    id: "p1",
    assetId: "a1",
    portfolioId: "pf1",
    amount: 100,
    interval: "MONTHLY",
    startDate: "2026-05-02",
    active: true,
    lastRunDate: null,
    ...over,
  };
}

function contract(over: Partial<Contract> = {}): Contract {
  return {
    id: "c1",
    name: "Insurance",
    amount: 30,
    interval: "MONTHLY",
    renewalDate: null,
    cancellationNoticeDays: null,
    categoryId: null,
    accountId: "acc1",
    bookingStartDate: "2026-06-01",
    lastBookedDate: null,
    ...over,
  };
}

function planned(over: Partial<PlannedCashflow> = {}): PlannedCashflow {
  return {
    id: "pc1",
    name: "Salary",
    accountId: "acc1",
    categoryId: null,
    amount: 2500,
    interval: "MONTHLY",
    startDate: "2026-07-01",
    endDate: null,
    lastBookedDate: null,
    transferAccountId: null,
    note: null,
    ...over,
  };
}

function input(over: Partial<NotificationInput> = {}): NotificationInput {
  return {
    today: TODAY,
    assets: [],
    transactions: [],
    savingsPlans: [],
    contracts: [],
    plannedCashflows: [],
    pensionContracts: [],
    accounts: [],
    accountBalances: [],
    spendingTransactions: [],
    householdInvites: 0,
    available: allAvailable(),
    ...over,
  };
}

describe("collectNotifications", () => {
  it("reports nothing when there is nothing to do", () => {
    expect(collectNotifications(input())).toEqual([]);
    expect(totalNotifications(collectNotifications(input()))).toBe(0);
  });

  it("counts every due savings-plan occurrence, not just the plans", () => {
    // May, June, July, August: four monthly executions, none booked yet.
    const items = collectNotifications(input({ assets: [asset()], savingsPlans: [plan()] }));
    expect(items).toEqual([{ kind: "savingsPlanDue", count: 4 }]);
  });

  // Mirrors the review dialog, which lists no rows for a plan whose asset is
  // gone — a count pointing at an empty dialog is worse than no count at all.
  it("ignores a plan whose asset no longer exists", () => {
    expect(collectNotifications(input({ assets: [], savingsPlans: [plan()] }))).toEqual([]);
  });

  it("ignores a paused plan", () => {
    const items = collectNotifications(
      input({ assets: [asset()], savingsPlans: [plan({ active: false })] }),
    );
    expect(items).toEqual([]);
  });

  it("counts household invitations addressed to this user", () => {
    expect(collectNotifications(input({ householdInvites: 2 }))).toEqual([
      { kind: "householdInvite", count: 2 },
    ]);
  });

  it("counts due contract and planned bookings separately", () => {
    const items = collectNotifications(
      input({ contracts: [contract()], plannedCashflows: [planned()] }),
    );
    expect(items).toEqual([
      { kind: "contractDue", count: 3 },
      { kind: "plannedDue", count: 2 },
    ]);
  });

  // Interest an account accrues is a due booking like any other, and used to
  // reach the review list without ever reaching the nav.
  it("counts due account interest", () => {
    const acc: Account = {
      id: "acc1",
      name: "Savings",
      kind: "savings",
      currency: null,
      isLiability: false,
      openingBalance: 1000,
      openedOn: "2026-07-02",
      interestRate: 12,
      interestFrequency: "MONTHLY",
    };
    expect(collectNotifications(input({ accounts: [acc] }))).toEqual([
      { kind: "accountInterestDue", count: 1 },
    ]);
    expect(
      collectNotifications(input({ accounts: [{ ...acc, interestSkippedUntil: "2026-08-02" }] })),
    ).toEqual([]);
  });

  // A liability's interest books itself, so a count would point at a review
  // list that does not hold it.
  it("does not count interest that books automatically", () => {
    const loan: Account = {
      id: "acc2",
      name: "Loan",
      kind: "loan",
      currency: null,
      isLiability: true,
      openingBalance: 1000,
      openedOn: "2026-07-02",
      interestRate: 12,
      interestFrequency: "MONTHLY",
    };
    expect(collectNotifications(input({ accounts: [loan] }))).toEqual([]);
  });

  // A flag that is off has no surface to act on, and a Pro-locked feature shows
  // a teaser rather than the review dialog: either way the promised task is not
  // on the page the count would send the user to.
  it("drops a kind whose feature is unavailable", () => {
    const items = collectNotifications(
      input({
        assets: [asset()],
        savingsPlans: [plan()],
        householdInvites: 1,
        available: allAvailable({ savingsPlanDue: false }),
      }),
    );
    expect(items).toEqual([{ kind: "householdInvite", count: 1 }]);
  });
});

describe("kindAvailability", () => {
  const flags: Record<NotificationKind, readonly string[]> = {
    householdInvite: ["household"],
    savingsPlanDue: ["savingsPlans"],
    cashInterestDue: ["cashInterest"],
    accountInterestDue: ["accounts", "spending"],
    contractDue: ["contracts"],
    plannedDue: ["plannedCashflow"],
    pensionPremiumDue: ["pension"],
  };

  it("keeps a received invite countable while the feature is Pro-locked", () => {
    // Accepting an invite lives outside the ProGate, so the lock must not hide
    // its count -- only a flag that is off outright does.
    const available = kindAvailability(flags, () => ({ enabled: true, locked: true }));
    expect(available.householdInvite).toBe(true);
    // Every other kind's action sits behind the gate, so the lock still hides it.
    expect(available.savingsPlanDue).toBe(false);
    expect(available.contractDue).toBe(false);
  });

  it("drops even the invite when its flag is off", () => {
    const available = kindAvailability(flags, (flag) => ({
      enabled: flag !== "household",
      locked: false,
    }));
    expect(available.householdInvite).toBe(false);
  });

  it("needs every flag of a multi-flag kind", () => {
    const available = kindAvailability(flags, (flag) => ({
      enabled: flag !== "spending",
      locked: false,
    }));
    expect(available.accountInterestDue).toBe(false);
  });
});

describe("notificationsByRoute", () => {
  it("sums the kinds that are acted on the same page", () => {
    const items = collectNotifications(
      input({ contracts: [contract()], plannedCashflows: [planned()], householdInvites: 1 }),
    );
    expect(notificationsByRoute(items)).toEqual({ "/accounts": 5, "/settings": 1 });
  });

  it("is empty when nothing waits", () => {
    expect(notificationsByRoute([])).toEqual({});
  });
});
