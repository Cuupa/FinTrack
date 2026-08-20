import { describe, expect, it } from "vitest";
import { keyInsights, RESERVE_TARGET_MONTHS } from "@/lib/finance/insights";

describe("keyInsights", () => {
  it("returns nothing when every figure is healthy or unmeasurable", () => {
    expect(
      keyInsights({
        monthsOfExpensesCovered: 6,
        savingsRate: 0.2,
        debtToIncomeRatio: 1,
        goalsReached: 0,
      }),
    ).toEqual([]);
  });

  it("flags a negative savings rate as the most urgent insight", () => {
    const out = keyInsights({
      monthsOfExpensesCovered: 1,
      savingsRate: -0.1,
      debtToIncomeRatio: null,
      goalsReached: 0,
    });
    expect(out[0].id).toBe("negativeSavings");
    expect(out[0].severity).toBe("negative");
    expect(out[0].href).toBe("/spending");
  });

  it("flags a reserve below the three-month floor with the shortfall", () => {
    const out = keyInsights({
      monthsOfExpensesCovered: 1.5,
      savingsRate: 0.3,
      debtToIncomeRatio: 0.5,
      goalsReached: 0,
    });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("reserveLow");
    expect(out[0].params.months).toBe(1.5);
    expect(out[0].params.target).toBe(RESERVE_TARGET_MONTHS);
  });

  it("does not flag a reserve at or above the floor", () => {
    const out = keyInsights({
      monthsOfExpensesCovered: RESERVE_TARGET_MONTHS,
      savingsRate: 0.3,
      debtToIncomeRatio: 0.5,
      goalsReached: 0,
    });
    expect(out).toEqual([]);
  });

  it("flags high leverage only above the multiple", () => {
    expect(
      keyInsights({
        monthsOfExpensesCovered: 6,
        savingsRate: 0.3,
        debtToIncomeRatio: 3,
        goalsReached: 0,
      }),
    ).toEqual([]);
    const out = keyInsights({
      monthsOfExpensesCovered: 6,
      savingsRate: 0.3,
      debtToIncomeRatio: 4.2,
      goalsReached: 0,
    });
    expect(out[0].id).toBe("highDebt");
    expect(out[0].params.multiple).toBe(4.2);
  });

  it("surfaces reached goals as a positive note, ranked last", () => {
    const out = keyInsights({
      monthsOfExpensesCovered: 1,
      savingsRate: -0.1,
      debtToIncomeRatio: null,
      goalsReached: 2,
    });
    // negative savings and low reserve outrank the positive note.
    expect(out.map((i) => i.id)).toEqual(["negativeSavings", "reserveLow", "goalsReached"]);
    const reached = out.find((i) => i.id === "goalsReached")!;
    expect(reached.severity).toBe("positive");
    expect(reached.params.count).toBe(2);
  });

  it("caps the result at three, keeping the highest-ranked", () => {
    const out = keyInsights(
      {
        monthsOfExpensesCovered: 1,
        savingsRate: -0.1,
        debtToIncomeRatio: 4,
        goalsReached: 3,
      },
      3,
    );
    expect(out).toHaveLength(3);
    // goalsReached (rank 20) is the one dropped.
    expect(out.map((i) => i.id)).toEqual(["negativeSavings", "reserveLow", "highDebt"]);
  });
});
