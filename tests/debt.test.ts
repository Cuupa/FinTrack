import { describe, expect, it } from "vitest";
import {
  accountRateSteps,
  amortizationSchedule,
  planPayoff,
  rateOnDate,
  yearlySplit,
  type DebtInput,
} from "@/lib/finance/debt";
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
    expect(r).toEqual({ order: [], perDebt: [], totalMonths: 0, totalInterest: 0, series: [] });
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

describe("rate schedule", () => {
  it("keeps the initial rate before the first step and switches on its date", () => {
    const steps = [{ from: "2030-01-01", annualRatePct: 6 }];
    expect(rateOnDate(3, steps, "2029-12-31")).toBe(3);
    expect(rateOnDate(3, steps, "2030-01-01")).toBe(6);
    expect(rateOnDate(3, steps, "2044-07-01")).toBe(6);
  });

  it("derives a step from an account's fixed-rate period, starting the day after", () => {
    const account = {
      id: "a1",
      name: "Mortgage",
      kind: "mortgage" as const,
      currency: null,
      isLiability: true,
      openingBalance: 300000,
      openedOn: "2024-01-01",
      interestRate: 4,
      minPayment: 1400,
      rateFixedUntil: "2036-07-31",
      followUpRate: 5.5,
    };
    expect(accountRateSteps(account)).toEqual([{ from: "2036-08-01", annualRatePct: 5.5 }]);
    // Half a pair is not a schedule: it would silently change nothing.
    expect(accountRateSteps({ ...account, followUpRate: null })).toEqual([]);
    expect(accountRateSteps({ ...account, rateFixedUntil: null })).toEqual([]);
  });

  it("charges the follow-up rate only after the fixed period, leaving today's rate alone", () => {
    const flat = amortizationSchedule(100000, 3, 600, "2024-01-01");
    const stepped = amortizationSchedule(100000, 3, 600, "2024-01-01", [
      { from: "2030-01-01", annualRatePct: 8 },
    ]);
    // Identical while the rate is still fixed...
    expect(stepped.points[0].annualRatePct).toBe(3);
    expect(stepped.points[0].interest).toBeCloseTo(flat.points[0].interest, 8);
    // ...and more expensive afterwards.
    const afterStep = stepped.points.find((p) => p.date >= "2030-01-01")!;
    expect(afterStep.annualRatePct).toBe(8);
    expect(stepped.totalInterest).toBeGreaterThan(flat.totalInterest);
  });

  it("still pays off when a payment too small at first is enough after a rate drop", () => {
    // 10% on 10000 is ~83/month interest; 60 doesn't cover it until the rate
    // falls, so the balance grows first and shrinks later.
    const r = amortizationSchedule(10000, 10, 60, "2024-01-01", [
      { from: "2026-01-01", annualRatePct: 1 },
    ]);
    expect(r.months).not.toBeNull();
    expect(r.points[0].principal).toBeLessThan(0);
  });
});

describe("planPayoff rollover", () => {
  const two = () => [
    debt({ id: "small", balance: 5000, annualRatePct: 15, minPayment: 200 }),
    debt({ id: "big", balance: 40000, annualRatePct: 4, minPayment: 300 }),
  ];

  it("keeps a cleared debt's payment working on the rest for good, not for one month", () => {
    const plan = planPayoff(two(), "avalanche", 0, "2024-01-01");
    const alone = amortizationSchedule(40000, 4, 300, "2024-01-01");
    // Once "small" is gone its 200/month rolls into "big", so the plan must
    // beat servicing "big" on its own minimum forever.
    expect(plan.totalMonths).not.toBeNull();
    expect(plan.totalMonths!).toBeLessThan(alone.months!);
    const big = plan.perDebt.find((p) => p.id === "big")!;
    expect(big.totalInterest).toBeLessThan(alone.totalInterest);
  });

  it("makes the strategy change the outcome even with no extra payment", () => {
    // Three debts, because with two the freed payment has only one possible
    // target and every strategy agrees by default. The rate order and the
    // balance order deliberately disagree.
    const three = () => [
      debt({ id: "first", balance: 4000, annualRatePct: 4, minPayment: 200 }),
      debt({ id: "highRate", balance: 8000, annualRatePct: 20, minPayment: 100 }),
      debt({ id: "smallest", balance: 3000, annualRatePct: 6, minPayment: 100 }),
    ];
    const avalanche = planPayoff(three(), "avalanche", 0, "2024-01-01");
    const snowball = planPayoff(three(), "snowball", 0, "2024-01-01");
    expect(avalanche.totalInterest).not.toBeCloseTo(snowball.totalInterest, 2);
    expect(avalanche.totalInterest).toBeLessThanOrEqual(snowball.totalInterest);
  });
});

describe("plan series", () => {
  it("opens at the full balance and ends at zero", () => {
    const r = planPayoff([debt({ balance: 1200, annualRatePct: 0, minPayment: 100 })], "avalanche", 0, "2024-01-01");
    expect(r.series[0]).toMatchObject({ month: 0, date: "2024-01-01", balance: 1200 });
    expect(r.series).toHaveLength(13);
    expect(r.series[12].balance).toBeCloseTo(0, 6);
    expect(r.series[12].date).toBe("2025-01-01");
  });

  it("splits into calendar years whose principal reconstructs the balance", () => {
    const r = planPayoff([debt({ balance: 12000, annualRatePct: 5, minPayment: 400 })], "avalanche", 0, "2024-01-01");
    const years = yearlySplit(r.series);
    expect(years[0].year).toBe(2024);
    expect(years.reduce((s, y) => s + y.principal, 0)).toBeCloseTo(12000, 4);
    expect(years.reduce((s, y) => s + y.interest, 0)).toBeCloseTo(r.totalInterest, 4);
    expect(years[years.length - 1].endBalance).toBeCloseTo(0, 6);
  });

  it("narrows to one debt when given its id", () => {
    const r = planPayoff(
      [
        debt({ id: "a", balance: 3000, annualRatePct: 10, minPayment: 200 }),
        debt({ id: "b", balance: 6000, annualRatePct: 5, minPayment: 200 }),
      ],
      "avalanche",
      0,
      "2024-01-01",
    );
    const onlyA = yearlySplit(r.series, "a");
    expect(onlyA.reduce((s, y) => s + y.principal, 0)).toBeCloseTo(3000, 4);
    const a = r.perDebt.find((p) => p.id === "a")!;
    expect(onlyA.reduce((s, y) => s + y.interest, 0)).toBeCloseTo(a.totalInterest, 4);
  });
});
