import { describe, expect, it } from "vitest";
import {
  dueOccurrences,
  MAX_DUE_OCCURRENCES,
  monthlyContributionOf,
  nextOccurrence,
  occurrenceAt,
} from "../lib/finance/savings-plans";
import { savingsPlanFee } from "../lib/finance/fees";
import { deriveRow, type DueRow } from "../components/dashboard/savings-plans-card";
import type { Asset, Portfolio, SavingsPlan } from "../lib/types";

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

// Cash will not have fees per default, but can be set manually per
// transaction. components/dashboard/savings-plans-card.tsx's `dueRows`
// useMemo hardcodes feeDefault: 0 for CASH plans (a deposit has no broker
// execution fee) and feeDefault: savingsPlanFee(portfolio) for every other
// asset type. `dueRows` itself is a component-internal useMemo that would
// need a full render (providers + a mocked /api/history fetch for the
// review dialog) to exercise directly, so this exercises `deriveRow` — the
// pure function `dueRows`' output feeds into — with the same feeDefault
// each branch computes, confirming the CASH default surfaces as 0 while a
// security in the same portfolio still gets the portfolio's fee, and that
// the per-row fee input still allows a manual override either way.
describe("deriveRow fee default (savings-plans-card dueRows CASH branch)", () => {
  const portfolio: Portfolio = {
    id: "p1",
    name: "Broker",
    feeOrderFlat: 1,
    feeOrderFreeFrom: null,
    feeSavingsPlan: 2.5,
  };

  function dueRow(over: Partial<DueRow>): DueRow {
    return {
      plan: plan({ portfolioId: portfolio.id, amount: 100 }),
      asset: asset({}),
      date: "2026-07-15",
      price: 10,
      synthetic: false,
      feeDefault: 0,
      ...over,
    };
  }

  it("defaults a CASH row's fee to 0 (no broker execution fee)", () => {
    const row = dueRow({ asset: asset({ type: "CASH" }), price: 1, feeDefault: 0 });
    const derived = deriveRow(row, undefined);
    expect(derived.feeInput).toBe("0");
    expect(derived.effectiveFee).toBe(0);
  });

  it("still defaults a security row in the same portfolio to feeSavingsPlan", () => {
    const row = dueRow({
      asset: asset({ type: "ETF" }),
      feeDefault: savingsPlanFee(portfolio),
    });
    const derived = deriveRow(row, undefined);
    expect(derived.feeInput).toBe("2.5");
    expect(derived.effectiveFee).toBe(2.5);
  });

  it("still allows a manual fee override on a CASH row", () => {
    const row = dueRow({ asset: asset({ type: "CASH" }), price: 1, feeDefault: 0 });
    const derived = deriveRow(row, { fee: "3" });
    expect(derived.feeInput).toBe("3");
    expect(derived.effectiveFee).toBe(3);
  });
});
