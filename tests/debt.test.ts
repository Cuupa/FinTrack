import { describe, expect, it } from "vitest";
import { amortizationSchedule, planPayoff, type DebtInput } from "@/lib/finance/debt";
import { addMonthsToDate } from "@/lib/finance/dates";

describe("addMonthsToDate", () => {
  it("adds whole months", () => {
    expect(addMonthsToDate("2024-01-15", 3)).toBe("2024-04-15");
  });

  it("clamps the day to the target month's length", () => {
    expect(addMonthsToDate("2024-01-31", 1)).toBe("2024-02-29"); // 2024 is a leap year
    expect(addMonthsToDate("2023-01-31", 1)).toBe("2023-02-28");
  });

  it("rolls over the year", () => {
    expect(addMonthsToDate("2024-11-01", 3)).toBe("2025-02-01");
  });
});

describe("amortizationSchedule", () => {
  it("returns an immediately-paid-off result for a zero balance", () => {
    const r = amortizationSchedule(0, 5, 100, "2024-01-01");
    expect(r.months).toBe(0);
    expect(r.totalInterest).toBe(0);
    expect(r.payoffDate).toBe("2024-01-01");
    expect(r.points).toEqual([]);
  });

  it("pays off a 0% loan in exactly balance/payment months", () => {
    const r = amortizationSchedule(1200, 0, 100, "2024-01-01");
    expect(r.months).toBe(12);
    expect(r.totalInterest).toBe(0);
    expect(r.payoffDate).toBe("2025-01-01");
    expect(r.points).toHaveLength(12);
    expect(r.points[11].balance).toBeCloseTo(0, 6);
  });

  it("accrues interest and produces a strictly decreasing balance", () => {
    const r = amortizationSchedule(10000, 6, 300, "2024-01-01");
    expect(r.months).not.toBeNull();
    expect(r.totalInterest).toBeGreaterThan(0);
    for (let i = 1; i < r.points.length; i++) {
      expect(r.points[i].balance).toBeLessThan(r.points[i - 1].balance);
    }
    // Total principal paid should reconstruct the original balance.
    const totalPrincipal = r.points.reduce((s, p) => s + p.principal, 0);
    expect(totalPrincipal).toBeCloseTo(10000, 1);
  });

  it("never pays off when the payment doesn't cover interest", () => {
    // 20% annual on 10000 is ~166.67/month interest; a 100 payment can't keep up.
    const r = amortizationSchedule(10000, 20, 100, "2024-01-01");
    expect(r.months).toBeNull();
    expect(r.payoffDate).toBeNull();
  });
});

function debt(overrides: Partial<DebtInput> = {}): DebtInput {
  return { id: "d1", name: "Card", balance: 1000, annualRatePct: 20, minPayment: 50, ...overrides };
}

describe("planPayoff", () => {
  it("returns an empty plan for no debts", () => {
    const r = planPayoff([], "avalanche", 0);
    expect(r).toEqual({ order: [], perDebt: [], totalMonths: 0, totalInterest: 0 });
  });

  it("pays off a single debt matching a standalone amortization schedule's month count", () => {
    const d = debt({ balance: 1200, annualRatePct: 0, minPayment: 100 });
    const r = planPayoff([d], "avalanche", 0);
    expect(r.totalMonths).toBe(12);
    expect(r.perDebt[0].payoffMonth).toBe(12);
    expect(r.order).toEqual(["d1"]);
  });

  it("avalanche prioritizes the highest-rate debt for extra payments", () => {
    const low = debt({ id: "low", balance: 1000, annualRatePct: 5, minPayment: 50 });
    const high = debt({ id: "high", balance: 1000, annualRatePct: 25, minPayment: 50 });
    const r = planPayoff([low, high], "avalanche", 200);
    expect(r.order[0]).toBe("high");
  });

  it("snowball prioritizes the smallest-balance debt for extra payments", () => {
    const small = debt({ id: "small", balance: 300, annualRatePct: 25, minPayment: 30 });
    const big = debt({ id: "big", balance: 2000, annualRatePct: 5, minPayment: 50 });
    const r = planPayoff([small, big], "snowball", 200);
    expect(r.order[0]).toBe("small");
  });

  it("avalanche never accrues more total interest than snowball for the same debts/budget", () => {
    const debts = [
      debt({ id: "a", balance: 3000, annualRatePct: 22, minPayment: 60 }),
      debt({ id: "b", balance: 1500, annualRatePct: 8, minPayment: 40 }),
      debt({ id: "c", balance: 500, annualRatePct: 15, minPayment: 25 }),
    ];
    const avalanche = planPayoff(debts, "avalanche", 150);
    const snowball = planPayoff(debts, "snowball", 150);
    expect(avalanche.totalInterest).toBeLessThanOrEqual(snowball.totalInterest);
  });

  it("extra payments reduce total months and total interest versus minimums only", () => {
    const d = debt({ balance: 5000, annualRatePct: 18, minPayment: 100 });
    const baseline = planPayoff([d], "avalanche", 0);
    const withExtra = planPayoff([d], "avalanche", 200);
    expect(baseline.totalMonths).not.toBeNull();
    expect(withExtra.totalMonths).not.toBeNull();
    expect(withExtra.totalMonths!).toBeLessThan(baseline.totalMonths!);
    expect(withExtra.totalInterest).toBeLessThan(baseline.totalInterest);
  });

  it("marks totalMonths null when a debt never pays off within the cap", () => {
    const d = debt({ balance: 100000, annualRatePct: 30, minPayment: 10 });
    const r = planPayoff([d], "avalanche", 0);
    expect(r.totalMonths).toBeNull();
  });
});
