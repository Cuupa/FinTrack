import { describe, expect, it } from "vitest";
import {
  dueOccurrences,
  MAX_DUE_OCCURRENCES,
  monthlyContributionOf,
  nextOccurrence,
  occurrenceAt,
} from "../lib/finance/savings-plans";
import type { Asset, SavingsPlan } from "../lib/types";

function plan(over: Partial<SavingsPlan>): SavingsPlan {
  return {
    id: "sp1",
    assetId: "a",
    portfolioId: "p1",
    amount: 100,
    interval: "MONTHLY",
    startDate: "2026-01-15",
    active: true,
    lastRunDate: null,
    ...over,
  };
}

describe("occurrenceAt", () => {
  it("keeps the day of month and clamps to shorter months", () => {
    const p = plan({ startDate: "2026-01-31" });
    expect(occurrenceAt(p, 0)).toBe("2026-01-31");
    expect(occurrenceAt(p, 1)).toBe("2026-02-28"); // clamped, 2026 not a leap year
    expect(occurrenceAt(p, 2)).toBe("2026-03-31"); // back to the anchor day
  });

  it("steps weekly plans by 7 days", () => {
    const p = plan({ interval: "WEEKLY", startDate: "2026-06-01" });
    expect(occurrenceAt(p, 1)).toBe("2026-06-08");
    expect(occurrenceAt(p, 4)).toBe("2026-06-29");
  });

  it("steps quarterly plans by 3 months", () => {
    const p = plan({ interval: "QUARTERLY", startDate: "2026-01-15" });
    expect(occurrenceAt(p, 1)).toBe("2026-04-15");
    expect(occurrenceAt(p, 2)).toBe("2026-07-15");
  });
});

describe("dueOccurrences", () => {
  it("returns every occurrence from start through today when never run", () => {
    const p = plan({ startDate: "2026-04-15" });
    expect(dueOccurrences(p, "2026-07-06")).toEqual([
      "2026-04-15",
      "2026-05-15",
      "2026-06-15",
    ]);
  });

  it("resumes strictly after lastRunDate", () => {
    const p = plan({ startDate: "2026-01-15", lastRunDate: "2026-05-15" });
    expect(dueOccurrences(p, "2026-07-06")).toEqual(["2026-06-15"]);
  });

  it("is empty for paused plans and future start dates", () => {
    expect(dueOccurrences(plan({ active: false }), "2026-07-06")).toEqual([]);
    expect(dueOccurrences(plan({ startDate: "2026-08-01" }), "2026-07-06")).toEqual([]);
  });

  it("caps a long-overdue plan at MAX_DUE_OCCURRENCES", () => {
    const p = plan({ interval: "WEEKLY", startDate: "2020-01-06" });
    expect(dueOccurrences(p, "2026-07-06")).toHaveLength(MAX_DUE_OCCURRENCES);
  });
});

describe("nextOccurrence", () => {
  it("is the first occurrence strictly after today", () => {
    expect(nextOccurrence(plan({ startDate: "2026-01-15" }), "2026-07-06")).toBe("2026-07-15");
    expect(nextOccurrence(plan({ startDate: "2026-07-15" }), "2026-07-06")).toBe("2026-07-15");
  });
});

function asset(over: Partial<Asset>): Asset {
  return {
    id: "a",
    isin: null,
    wkn: null,
    symbol: "X",
    name: "Asset",
    type: "ETF",
    currency: "EUR",
    notes: null,
    ...over,
  };
}

describe("monthlyContributionOf", () => {
  it("normalizes weekly/monthly/quarterly plans to a monthly amount", () => {
    const assets = [asset({ id: "a1" }), asset({ id: "a2" }), asset({ id: "a3" })];
    const plans: SavingsPlan[] = [
      plan({ id: "p1", assetId: "a1", interval: "WEEKLY", amount: 50 }),
      plan({ id: "p2", assetId: "a2", interval: "MONTHLY", amount: 200 }),
      plan({ id: "p3", assetId: "a3", interval: "QUARTERLY", amount: 300 }),
    ];
    // 50*52/12 + 200 + 300/3 = 216.666... + 200 + 100
    expect(monthlyContributionOf(plans, assets)).toBeCloseTo(516.6667, 3);
  });

  it("skips inactive plans and plans whose asset no longer exists", () => {
    const assets = [asset({ id: "a1" })];
    const plans: SavingsPlan[] = [
      plan({ id: "p1", assetId: "a1", amount: 100, active: false }),
      plan({ id: "p2", assetId: "missing", amount: 100 }),
    ];
    expect(monthlyContributionOf(plans, assets)).toBe(0);
  });

  it("converts each plan's amount from its asset's native currency to the base", () => {
    const assets = [asset({ id: "a1", currency: "USD" }), asset({ id: "a2", currency: "EUR" })];
    const plans: SavingsPlan[] = [
      plan({ id: "p1", assetId: "a1", interval: "MONTHLY", amount: 100 }),
      plan({ id: "p2", assetId: "a2", interval: "MONTHLY", amount: 100 }),
    ];
    const v = { base: "EUR", fx: { USD: 0.9 } };
    // USD plan converts at 0.9, EUR plan (== base) passes through 1:1.
    expect(monthlyContributionOf(plans, assets, v)).toBeCloseTo(190, 6);
  });

  it("is currency-agnostic (1:1) without a valuation context", () => {
    const assets = [asset({ id: "a1", currency: "USD" })];
    const plans: SavingsPlan[] = [plan({ id: "p1", assetId: "a1", amount: 100 })];
    expect(monthlyContributionOf(plans, assets)).toBe(100);
  });
});
