import { describe, expect, it } from "vitest";
import {
  DEFAULT_CEILING,
  DEFAULT_FLOOR,
  EARLY_CRASH_DROP,
  LOST_DECADE_YEARS,
  DEFAULT_INFLATION,
  HIGH_INFLATION_EXTRA,
  WITHDRAWAL_STRATEGIES,
  annualWithdrawal,
  stressedReturn,
  summarizeStrategy,
  type WithdrawalPlan,
} from "../lib/finance/withdrawal";
import { runMonteCarlo, type MonteCarloParams } from "../lib/finance/monte-carlo";

const plan = (over: Partial<WithdrawalPlan> = {}): WithdrawalPlan => ({
  strategy: "fixed",
  rate: 0.04,
  // Off by default so these cases pin the STRATEGY shape; indexing has its own
  // cases below.
  inflation: 0,
  ...over,
});

describe("annualWithdrawal", () => {
  it("starts every strategy at the same first-year income", () => {
    // The strategies differ in what happens NEXT, so year one must not be a
    // difference between them -- otherwise the comparison is unreadable.
    for (const strategy of ["fixed", "percentOfPortfolio", "guardrails", "floorCeiling"] as const) {
      const income = annualWithdrawal(plan({ strategy }), {
        initialWithdrawal: 40000,
        portfolioValue: 1_000_000,
        previousWithdrawal: 0,
        yearsIntoRetirement: 0,
        yearsRemaining: 30,
      });
      expect(income).toBe(40000);
    }
  });

  it("pays nothing out of a depleted portfolio", () => {
    for (const strategy of ["fixed", "percentOfPortfolio", "guardrails", "floorCeiling"] as const) {
      expect(
        annualWithdrawal(plan({ strategy }), {
          initialWithdrawal: 40000,
          portfolioValue: 0,
          previousWithdrawal: 40000,
          yearsIntoRetirement: 5, yearsRemaining: 30,
        }),
      ).toBe(0);
    }
  });

  it("fixed ignores what the portfolio did", () => {
    const ctx = { initialWithdrawal: 40000, previousWithdrawal: 40000, yearsIntoRetirement: 3, yearsRemaining: 30 };
    expect(annualWithdrawal(plan(), { ...ctx, portfolioValue: 300_000 })).toBe(40000);
    expect(annualWithdrawal(plan(), { ...ctx, portfolioValue: 2_000_000 })).toBe(40000);
  });

  it("percentOfPortfolio follows the portfolio in both directions", () => {
    const p = plan({ strategy: "percentOfPortfolio" });
    const ctx = { initialWithdrawal: 40000, previousWithdrawal: 40000, yearsIntoRetirement: 3, yearsRemaining: 30 };
    expect(annualWithdrawal(p, { ...ctx, portfolioValue: 500_000 })).toBeCloseTo(20000, 6);
    expect(annualWithdrawal(p, { ...ctx, portfolioValue: 2_000_000 })).toBeCloseTo(80000, 6);
  });

  it("floorCeiling clips the swing to the configured bounds", () => {
    const p = plan({ strategy: "floorCeiling" });
    const ctx = { initialWithdrawal: 40000, previousWithdrawal: 40000, yearsIntoRetirement: 3, yearsRemaining: 30 };
    // A halved portfolio would pay 20k; the floor holds it up.
    expect(annualWithdrawal(p, { ...ctx, portfolioValue: 500_000 })).toBeCloseTo(
      DEFAULT_FLOOR * 40000,
      6,
    );
    // A doubled portfolio would pay 80k; the ceiling caps it.
    expect(annualWithdrawal(p, { ...ctx, portfolioValue: 2_000_000 })).toBeCloseTo(
      DEFAULT_CEILING * 40000,
      6,
    );
    // In between it simply tracks the portfolio.
    expect(annualWithdrawal(p, { ...ctx, portfolioValue: 1_050_000 })).toBeCloseTo(42000, 6);
  });

  it("guardrails hold the income steady inside the band and step it outside", () => {
    const p = plan({ strategy: "guardrails" });
    const ctx = { initialWithdrawal: 40000, previousWithdrawal: 40000, yearsIntoRetirement: 3, yearsRemaining: 30 };

    // Current rate 4.0% — dead on target, so nothing moves.
    expect(annualWithdrawal(p, { ...ctx, portfolioValue: 1_000_000 })).toBe(40000);
    // 4.3% — inside the ±20% band (3.2%–4.8%), still nothing moves.
    expect(annualWithdrawal(p, { ...ctx, portfolioValue: 930_000 })).toBe(40000);
    // 5.7% — above the upper guardrail, so the income is cut by 10%.
    expect(annualWithdrawal(p, { ...ctx, portfolioValue: 700_000 })).toBeCloseTo(36000, 6);
    // 2.7% — below the lower guardrail, so the income is raised by 10%.
    expect(annualWithdrawal(p, { ...ctx, portfolioValue: 1_500_000 })).toBeCloseTo(44000, 6);
  });
});

describe("stressedReturn", () => {
  it("leaves the accumulation phase alone", () => {
    // Sequence risk is a decumulation problem: while you are still paying in, a
    // bad year is a discount, not a loss you have locked in.
    expect(stressedReturn("earlyCrash", 0.01, -1, 0.005)).toBe(0.01);
    expect(stressedReturn("lostDecade", 0.01, -50, 0.005)).toBe(0.01);
  });

  it("earlyCrash hits only the first month of retirement", () => {
    expect(stressedReturn("earlyCrash", 0.01, 0, 0.005)).toBeCloseTo(0.01 - EARLY_CRASH_DROP, 10);
    expect(stressedReturn("earlyCrash", 0.01, 1, 0.005)).toBe(0.01);
  });

  it("lostDecade removes the drift for exactly ten years", () => {
    expect(stressedReturn("lostDecade", 0.01, 0, 0.005)).toBeCloseTo(0.005, 10);
    expect(stressedReturn("lostDecade", 0.01, LOST_DECADE_YEARS * 12 - 1, 0.005)).toBeCloseTo(
      0.005,
      10,
    );
    expect(stressedReturn("lostDecade", 0.01, LOST_DECADE_YEARS * 12, 0.005)).toBe(0.01);
  });

  it("none is the identity", () => {
    expect(stressedReturn("none", 0.0123, 5, 0.005)).toBe(0.0123);
  });
});

describe("summarizeStrategy", () => {
  it("reports the worst year per run, not the worst across runs", () => {
    // The figure that matters is "the leanest year I have to survive", and a
    // pooled minimum would report one catastrophic run as everyone's floor.
    const out = summarizeStrategy("guardrails", [
      { incomes: [40000, 38000, 42000], endValue: 500_000, depleted: false },
      { incomes: [40000, 30000, 36000], endValue: 100_000, depleted: false },
    ]);
    // Per-run worsts are 38000 and 30000; the median of those is the upper one.
    expect(out.medianWorstYearIncome).toBe(38000);
    expect(out.successRate).toBe(1);
  });

  it("counts a depleted run as a failure", () => {
    const out = summarizeStrategy("fixed", [
      { incomes: [40000], endValue: 0, depleted: true },
      { incomes: [40000], endValue: 10, depleted: false },
      { incomes: [40000], endValue: 20, depleted: false },
    ]);
    expect(out.successRate).toBeCloseTo(2 / 3, 10);
  });

  it("is empty-safe", () => {
    expect(summarizeStrategy("fixed", []).successRate).toBe(0);
  });
});

// End-to-end through the simulation: the strategies have to actually change
// the outcome, and the comparison has to be run over identical market paths.
describe("runMonteCarlo with withdrawal strategies", () => {
  const base: MonteCarloParams = {
    initialCapital: 500_000,
    monthlyContribution: 0,
    years: 1,
    expectedReturn: 0.05,
    volatility: 0.18,
    runs: 200,
    seed: 42,
    withdrawalYears: 30,
    withdrawalRate: 0.05,
  };

  it("percentOfPortfolio never depletes, fixed can", () => {
    const compared = runMonteCarlo({ ...base, compareStrategies: true });
    const rows = compared.strategyComparison!;
    const pct = rows.find((r) => r.strategy === "percentOfPortfolio")!;
    const fixed = rows.find((r) => r.strategy === "fixed")!;
    // Taking a share of what is left is arithmetically incapable of hitting
    // zero; drawing a fixed amount out of a falling portfolio is not.
    expect(pct.successRate).toBe(1);
    expect(fixed.successRate).toBeLessThan(1);
  });

  it("compares every strategy over the same market, so the rows are commensurable", () => {
    const compared = runMonteCarlo({ ...base, compareStrategies: true });
    expect(compared.strategyComparison).toHaveLength(WITHDRAWAL_STRATEGIES.length);
    for (const row of compared.strategyComparison!) {
      expect(row.medianIncome).toBeGreaterThan(0);
      expect(row.medianTotalIncome).toBeGreaterThan(0);
    }
  });

  it("omits the comparison unless it was asked for", () => {
    expect(runMonteCarlo(base).strategyComparison).toBeUndefined();
  });

  it("a bad sequence of returns is worse than the same returns in any order", () => {
    // Identical seed, identical draws: the ONLY difference is that the losses
    // are forced to the front. That is sequence-of-returns risk, and the whole
    // reason an average return is not a plan.
    // A rate the portfolio actually survives unstressed — at `base`'s 5% the
    // median run is already depleted, and "0 < 0" would prove nothing.
    const survivable = { ...base, withdrawalRate: 0.035, expectedReturn: 0.06 };
    const calm = runMonteCarlo({ ...survivable, stress: "none" });
    const crash = runMonteCarlo({ ...survivable, stress: "earlyCrash" });
    const lost = runMonteCarlo({ ...survivable, stress: "lostDecade" });

    const median = (r: typeof calm) => r.bands[r.bands.length - 1].median;
    expect(median(calm)).toBeGreaterThan(0);
    expect(median(crash)).toBeLessThan(median(calm));
    expect(median(lost)).toBeLessThan(median(calm));
  });

  it("stays reproducible for a given seed", () => {
    const a = runMonteCarlo({ ...base, withdrawalStrategy: "guardrails" });
    const b = runMonteCarlo({ ...base, withdrawalStrategy: "guardrails" });
    expect(a.finalDistribution).toEqual(b.finalDistribution);
  });
});

describe("inflation indexing", () => {
  it("raises the fixed income every year, because the 4% rule is a real rule", () => {
    const p = plan({ inflation: 0.02 });
    const ctx = { portfolioValue: 1_000_000, initialWithdrawal: 40000, previousWithdrawal: 40000 };
    expect(
      annualWithdrawal(p, { ...ctx, yearsIntoRetirement: 1, yearsRemaining: 29 }),
    ).toBeCloseTo(40000 * 1.02, 6);
    expect(
      annualWithdrawal(p, { ...ctx, yearsIntoRetirement: 10, yearsRemaining: 20 }),
    ).toBeCloseTo(40000 * Math.pow(1.02, 10), 6);
  });

  it("defaults to an indexed withdrawal rather than a nominal one", () => {
    const income = annualWithdrawal(
      { strategy: "fixed", rate: 0.04 },
      {
        portfolioValue: 1_000_000,
        initialWithdrawal: 40000,
        previousWithdrawal: 40000,
        yearsIntoRetirement: 1,
        yearsRemaining: 29,
      },
    );
    expect(income).toBeCloseTo(40000 * (1 + DEFAULT_INFLATION), 6);
  });

  it("moves the floor and the ceiling with it", () => {
    const p = plan({ strategy: "floorCeiling", inflation: 0.02 });
    const ctx = { initialWithdrawal: 40000, previousWithdrawal: 40000, yearsRemaining: 25 };
    expect(
      annualWithdrawal(p, { ...ctx, portfolioValue: 500_000, yearsIntoRetirement: 5 }),
    ).toBeCloseTo(DEFAULT_FLOOR * 40000 * Math.pow(1.02, 5), 6);
  });
});

describe("vpw", () => {
  it("spreads the portfolio over the years actually left", () => {
    const p = plan({ strategy: "vpw", expectedReturn: 0 });
    const ctx = { initialWithdrawal: 40000, previousWithdrawal: 40000, portfolioValue: 200_000 };
    expect(annualWithdrawal(p, { ...ctx, yearsIntoRetirement: 10, yearsRemaining: 20 })).toBeCloseTo(
      10000,
      6,
    );
    // Same portfolio, fewer years left: the rate rises, which is the point.
    expect(annualWithdrawal(p, { ...ctx, yearsIntoRetirement: 25, yearsRemaining: 5 })).toBeCloseTo(
      40000,
      6,
    );
  });

  it("cannot deplete the portfolio", () => {
    const p = plan({ strategy: "vpw", expectedReturn: 0.05 });
    const income = annualWithdrawal(p, {
      initialWithdrawal: 40000,
      previousWithdrawal: 40000,
      portfolioValue: 100_000,
      yearsIntoRetirement: 5,
      yearsRemaining: 25,
    });
    expect(income).toBeGreaterThan(0);
    expect(income).toBeLessThan(100_000);
  });
});

describe("stress without a withdrawal phase", () => {
  it("bites from month zero when the run only accumulates", () => {
    // monthsFromAnchor 0 is the crash month whether that anchor is retirement
    // or the very first month of the run.
    expect(stressedReturn("earlyCrash", 0.01, 0, 0.005)).toBeCloseTo(0.01 - EARLY_CRASH_DROP, 6);
    expect(stressedReturn("earlyCrash", 0.01, 5, 0.005)).toBeCloseTo(0.01, 6);
  });

  it("the inflation shock takes the same bite every month, and never gives it back", () => {
    expect(stressedReturn("highInflation", 0.01, 0, 0.005)).toBeCloseTo(
      0.01 - HIGH_INFLATION_EXTRA / 12,
      6,
    );
    expect(stressedReturn("highInflation", 0.01, LOST_DECADE_YEARS * 12 + 1, 0.005)).toBeCloseTo(
      0.01 - HIGH_INFLATION_EXTRA / 12,
      6,
    );
  });
});
