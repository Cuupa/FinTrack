import { describe, expect, it } from "vitest";
import {
  computeFirePlan,
  fatFireNumber,
  fireNumber,
  fireNumberWithPension,
  leanFireNumber,
  trailingAnnualExpenses,
  yearsToFire,
} from "@/lib/finance/fire";
import type { SpendingTransaction } from "@/lib/types";

function tx(overrides: Partial<SpendingTransaction> = {}): SpendingTransaction {
  return {
    id: "t1",
    accountId: "a1",
    categoryId: null,
    date: "2024-06-01",
    amount: -100,
    payee: "Test",
    note: null,
    recurringId: null,
    ...overrides,
  };
}

describe("fireNumber", () => {
  it("produces the classic '25x expenses' result at the 4% rule", () => {
    expect(fireNumber(40000, 0.04)).toBeCloseTo(1000000);
  });

  it("is Infinity at a zero withdrawal rate", () => {
    expect(fireNumber(40000, 0)).toBe(Infinity);
  });

  it("is Infinity at a negative withdrawal rate", () => {
    expect(fireNumber(40000, -0.01)).toBe(Infinity);
  });

  it("clamps negative expenses to zero", () => {
    expect(fireNumber(-500, 0.04)).toBe(0);
  });
});

describe("lean/regular/fat ordering", () => {
  it("orders lean < regular < fat for the same expenses and rate", () => {
    const lean = leanFireNumber(40000, 0.04);
    const regular = fireNumber(40000, 0.04);
    const fat = fatFireNumber(40000, 0.04);
    expect(lean).toBeLessThan(regular);
    expect(regular).toBeLessThan(fat);
  });

  it("lean is 70% and fat is 130% of the regular number", () => {
    const regular = fireNumber(40000, 0.04);
    expect(leanFireNumber(40000, 0.04)).toBeCloseTo(regular * 0.7);
    expect(fatFireNumber(40000, 0.04)).toBeCloseTo(regular * 1.3);
  });
});

describe("yearsToFire", () => {
  it("returns 0 when the target is already met", () => {
    expect(yearsToFire(1000000, 1000000, 0, 0.05)).toBe(0);
    expect(yearsToFire(1200000, 1000000, 0, 0.05)).toBe(0);
  });

  it("returns null when the target is never reached (no growth, no contribution)", () => {
    expect(yearsToFire(1000, 1000000, 0, 0)).toBeNull();
  });

  it("returns null when the target is not finite (0% withdrawal rate upstream)", () => {
    expect(yearsToFire(1000, Infinity, 1000, 0.05)).toBeNull();
  });

  it("computes a positive number of years under normal compounding + contributions", () => {
    const years = yearsToFire(10000, 100000, 500, 0.06);
    expect(years).not.toBeNull();
    expect(years as number).toBeGreaterThan(0);
    expect(years as number).toBeLessThan(100);
  });

  it("reaching a bigger target takes longer, all else equal", () => {
    const smaller = yearsToFire(10000, 50000, 300, 0.05) as number;
    const bigger = yearsToFire(10000, 500000, 300, 0.05) as number;
    expect(bigger).toBeGreaterThan(smaller);
  });
});

describe("trailingAnnualExpenses", () => {
  it("annualises the average monthly expense over distinct months in the window", () => {
    const transactions: SpendingTransaction[] = [
      tx({ id: "e1", date: "2024-04-20", amount: -1000 }),
      tx({ id: "e2", date: "2024-05-20", amount: -1000 }),
      tx({ id: "e3", date: "2024-06-20", amount: -1000 }),
    ];
    // avg monthly expense = 1000 (3 distinct months) -> annualised = 12000.
    expect(trailingAnnualExpenses(transactions, "2024-06-30")).toBeCloseTo(12000);
  });

  it("is 0 with no spending history", () => {
    expect(trailingAnnualExpenses([], "2024-06-30")).toBe(0);
  });

  it("ignores income rows, only counting expense magnitude", () => {
    const transactions: SpendingTransaction[] = [
      tx({ id: "i1", date: "2024-06-01", amount: 3000 }),
      tx({ id: "e1", date: "2024-06-20", amount: -900 }),
    ];
    expect(trailingAnnualExpenses(transactions, "2024-06-30")).toBeCloseTo(900 * 12);
  });
});

describe("computeFirePlan", () => {
  it("wires net worth, expenses, contribution and return into a full plan", () => {
    const plan = computeFirePlan(50000, 40000, 500, 0.06, 0.04);
    expect(plan.withdrawalRate).toBe(0.04);
    expect(plan.regular).toBeCloseTo(1000000);
    expect(plan.lean).toBeCloseTo(700000);
    expect(plan.fat).toBeCloseTo(1300000);
    // Not yet there, but growing -- years should be finite and ordered lean < regular < fat.
    expect(plan.yearsToLean).not.toBeNull();
    expect(plan.yearsToRegular).not.toBeNull();
    expect(plan.yearsToFat).not.toBeNull();
    expect(plan.yearsToLean as number).toBeLessThan(plan.yearsToRegular as number);
    expect(plan.yearsToRegular as number).toBeLessThan(plan.yearsToFat as number);
  });

  it("returns 0 years across the board once net worth already covers fat FIRE", () => {
    const plan = computeFirePlan(2000000, 40000, 0, 0.05, 0.04);
    expect(plan.yearsToLean).toBe(0);
    expect(plan.yearsToRegular).toBe(0);
    expect(plan.yearsToFat).toBe(0);
  });

  it("produces Infinity targets and null years-to-FI at a zero withdrawal rate", () => {
    const plan = computeFirePlan(50000, 40000, 500, 0.06, 0);
    expect(plan.regular).toBe(Infinity);
    expect(plan.yearsToRegular).toBeNull();
  });
});

// Folding the pension in (owner, 2026-08: "rente ist für fire ja schon
// wichtig oder nicht?"). It is: guaranteed income from a certain year onward
// is capital you do not have to accumulate, and ignoring it overstates the
// target by a large multiple for anyone with a pension record.
describe("FIRE with a pension", () => {
  const EXPENSES = 40000;
  const RATE = 0.04;

  it("is identical to the pension-free number when there is none", () => {
    expect(fireNumberWithPension(EXPENSES, RATE, 0, 20)).toBe(fireNumber(EXPENSES, RATE));
    const plain = computeFirePlan(100000, EXPENSES, 1000, 0.06, RATE);
    const withNone = computeFirePlan(100000, EXPENSES, 1000, 0.06, RATE, {
      annualIncome: 0,
      yearsUntilStart: 20,
    });
    expect(withNone.regular).toBe(plain.regular);
    expect(withNone.yearsToRegular).toBe(plain.yearsToRegular);
  });

  it("collapses to the residual perpetuity once the pension is already flowing", () => {
    // No bridge to fund: the portfolio only ever covers what the pension does
    // not, so this is the classic formula on the shortfall.
    expect(fireNumberWithPension(EXPENSES, RATE, 15000, 0)).toBeCloseTo(
      (EXPENSES - 15000) / RATE,
      6,
    );
  });

  it("needs only the bridge when the pension covers the whole budget", () => {
    // 10 years to fund, then the pension takes over entirely: the target is
    // the present value of those 10 years, NOT 25x expenses forever.
    const target = fireNumberWithPension(EXPENSES, RATE, EXPENSES, 10);
    const annuity = (EXPENSES * (1 - Math.pow(1 + RATE, -10))) / RATE;
    expect(target).toBeCloseTo(annuity, 6);
    expect(target).toBeLessThan(fireNumber(EXPENSES, RATE));
  });

  it("lowers the target, and a longer bridge lowers it less", () => {
    const soon = fireNumberWithPension(EXPENSES, RATE, 20000, 5);
    const later = fireNumberWithPension(EXPENSES, RATE, 20000, 25);
    const never = fireNumber(EXPENSES, RATE);
    expect(soon).toBeLessThan(later);
    expect(later).toBeLessThan(never);
  });

  it("reports what accounting for the pension was worth", () => {
    const plan = computeFirePlan(200000, EXPENSES, 1500, 0.06, RATE, {
      annualIncome: 18000,
      yearsUntilStart: 30,
    });
    expect(plan.regularWithoutPension).toBe(fireNumber(EXPENSES, RATE));
    expect(plan.regular).toBeLessThan(plan.regularWithoutPension);
    expect(plan.pensionAnnual).toBe(18000);
    // Retiring before the pension starts leaves a real bridge to fund.
    expect(plan.bridgeYears).toBeGreaterThan(0);
  });

  it("reaches FIRE no later once the pension is counted", () => {
    const without = computeFirePlan(200000, EXPENSES, 1500, 0.06, RATE);
    const with_ = computeFirePlan(200000, EXPENSES, 1500, 0.06, RATE, {
      annualIncome: 18000,
      yearsUntilStart: 30,
    });
    expect(with_.yearsToRegular).not.toBeNull();
    expect(with_.yearsToRegular!).toBeLessThanOrEqual(without.yearsToRegular!);
  });

  it("nets the pension against each variant's own budget", () => {
    const plan = computeFirePlan(200000, EXPENSES, 1500, 0.06, RATE, {
      annualIncome: 18000,
      yearsUntilStart: 30,
    });
    // Lean still costs less than regular, which still costs less than fat.
    expect(plan.lean).toBeLessThan(plan.regular);
    expect(plan.regular).toBeLessThan(plan.fat);
  });
});
