import { describe, expect, it } from "vitest";
import {
  annualAmountOf,
  defaultWithdrawalPlan,
  planToFireAssumption,
  planToWithdrawalOptions,
  rateBasisOf,
  rateOf,
  type WithdrawalPlan,
} from "@/lib/finance/withdrawal-plan";
import {
  DEFAULT_GUARDRAIL_ADJUST,
  DEFAULT_GUARDRAIL_BAND,
  DEFAULT_VANGUARD_CEILING,
  DEFAULT_VANGUARD_FLOOR,
} from "@/lib/finance/withdrawal";

describe("defaultWithdrawalPlan", () => {
  it("reproduces today's behaviour: 4% initial rate, 2% inflation, no stress", () => {
    const plan = defaultWithdrawalPlan();
    expect(plan.strategy).toBe("initialRate");
    expect(rateOf(plan)).toBe(0.04);
    expect(plan.inflation).toEqual({ indexed: true, assumedRate: 0.02 });
    expect(plan.stress).toBe("none");
    expect(plan.guaranteedIncome).toBeUndefined();
  });
});

describe("rateOf / annualAmountOf / rateBasisOf", () => {
  it("rateOf is null for an amount-based plan", () => {
    const plan: WithdrawalPlan = {
      strategy: "fixedRealAmount",
      amount: { kind: "amount", value: 24000 },
      paymentInterval: "annual",
      inflation: { indexed: true, assumedRate: 0.02 },
      stress: "none",
    };
    expect(rateOf(plan)).toBeNull();
    expect(annualAmountOf(plan)).toBe(24000);
    expect(rateBasisOf(plan)).toBeNull();
  });

  it("annualAmountOf is null for a rate-based plan", () => {
    const plan = defaultWithdrawalPlan();
    expect(annualAmountOf(plan)).toBeNull();
  });

  // Test matrix #16: rounding + monthly/annual intervals.
  it("annualises a MONTHLY amount (x12) before it reaches the engine", () => {
    const plan: WithdrawalPlan = {
      strategy: "fixedRealAmount",
      amount: { kind: "amount", value: 2000 },
      paymentInterval: "monthly",
      inflation: { indexed: true, assumedRate: 0.02 },
      stress: "none",
    };
    expect(annualAmountOf(plan)).toBe(24000);
  });

  it("rateBasisOf: atRetirement for initialRate/guardrails, currentValue for currentPortfolioShare/vanguard", () => {
    expect(rateBasisOf({ ...defaultWithdrawalPlan(), strategy: "initialRate" })).toBe(
      "atRetirement",
    );
    expect(
      rateBasisOf({ ...defaultWithdrawalPlan(), strategy: "currentPortfolioShare" }),
    ).toBe("currentValue");
    expect(rateBasisOf({ ...defaultWithdrawalPlan(), strategy: "guardrails" })).toBe(
      "atRetirement",
    );
    expect(rateBasisOf({ ...defaultWithdrawalPlan(), strategy: "vanguard" })).toBe(
      "currentValue",
    );
  });
});

describe("planToWithdrawalOptions", () => {
  it("fixedRealAmount: maps to the engine's 'fixed' strategy with fixedAnnualAmount, no rate", () => {
    const plan: WithdrawalPlan = {
      strategy: "fixedRealAmount",
      amount: { kind: "amount", value: 24000 },
      paymentInterval: "annual",
      inflation: { indexed: true, assumedRate: 0.03 },
      stress: "none",
    };
    const options = planToWithdrawalOptions(plan);
    expect(options.withdrawalStrategy).toBe("fixed");
    expect(options.fixedAnnualAmount).toBe(24000);
    expect(options.withdrawalRate).toBeUndefined();
    expect(options.inflation).toBe(0.03);
  });

  it("fixedRealAmount without inflation indexing: inflation is forced to 0", () => {
    const plan: WithdrawalPlan = {
      strategy: "fixedRealAmount",
      amount: { kind: "amount", value: 24000 },
      paymentInterval: "annual",
      inflation: { indexed: false, assumedRate: 0.03 },
      stress: "none",
    };
    expect(planToWithdrawalOptions(plan).inflation).toBe(0);
  });

  it("initialRate: maps to the engine's 'fixed' strategy with a rate, no amount", () => {
    const plan = defaultWithdrawalPlan();
    const options = planToWithdrawalOptions(plan);
    expect(options.withdrawalStrategy).toBe("fixed");
    expect(options.withdrawalRate).toBe(0.04);
    expect(options.fixedAnnualAmount).toBeUndefined();
    expect(options.inflation).toBe(0.02);
  });

  it("currentPortfolioShare: maps to 'percentOfPortfolio' and forces inflation to 0", () => {
    const plan: WithdrawalPlan = {
      strategy: "currentPortfolioShare",
      amount: { kind: "rate", value: 0.05 },
      paymentInterval: "annual",
      // Even an "indexed: true" assumption must not leak through -- the
      // strategy already re-tracks the market every year (WITHDRAWAL_
      // REFACTOR_PLAN.md §6.3).
      inflation: { indexed: true, assumedRate: 0.05 },
      stress: "none",
    };
    const options = planToWithdrawalOptions(plan);
    expect(options.withdrawalStrategy).toBe("percentOfPortfolio");
    expect(options.withdrawalRate).toBe(0.05);
    expect(options.inflation).toBe(0);
  });

  it("guardrails: maps band/adjust, falling back to the engine defaults", () => {
    const withDefaults: WithdrawalPlan = {
      strategy: "guardrails",
      amount: { kind: "rate", value: 0.04 },
      paymentInterval: "annual",
      inflation: { indexed: true, assumedRate: 0.02 },
      stress: "none",
    };
    const defaults = planToWithdrawalOptions(withDefaults);
    expect(defaults.withdrawalStrategy).toBe("guardrails");
    expect(defaults.guardrailBand).toBe(DEFAULT_GUARDRAIL_BAND);
    expect(defaults.guardrailAdjust).toBe(DEFAULT_GUARDRAIL_ADJUST);

    const withCustom: WithdrawalPlan = {
      ...withDefaults,
      guardrails: { band: 0.15, adjust: 0.08 },
    };
    const custom = planToWithdrawalOptions(withCustom);
    expect(custom.guardrailBand).toBe(0.15);
    expect(custom.guardrailAdjust).toBe(0.08);
  });

  it("vanguard: maps ceiling/floor, falling back to Vanguard's own published defaults", () => {
    const withDefaults: WithdrawalPlan = {
      strategy: "vanguard",
      amount: { kind: "rate", value: 0.04 },
      paymentInterval: "annual",
      inflation: { indexed: true, assumedRate: 0.02 },
      stress: "none",
    };
    const defaults = planToWithdrawalOptions(withDefaults);
    expect(defaults.withdrawalStrategy).toBe("vanguard");
    expect(defaults.withdrawalRate).toBe(0.04);
    expect(defaults.vanguardCeiling).toBe(DEFAULT_VANGUARD_CEILING);
    expect(defaults.vanguardFloor).toBe(DEFAULT_VANGUARD_FLOOR);

    const withCustom: WithdrawalPlan = {
      ...withDefaults,
      vanguard: { ceiling: 0.1, floor: 0.05 },
    };
    const custom = planToWithdrawalOptions(withCustom);
    expect(custom.vanguardCeiling).toBe(0.1);
    expect(custom.vanguardFloor).toBe(0.05);
  });

  it("carries guaranteed income through without double-counting anything else", () => {
    const plan: WithdrawalPlan = {
      ...defaultWithdrawalPlan(),
      guaranteedIncome: { annualAmount: 12000, yearsUntilStart: 5 },
    };
    const options = planToWithdrawalOptions(plan);
    expect(options.annualPensionIncome).toBe(12000);
    expect(options.pensionYearsUntilStart).toBe(5);
  });

  it("omits pension fields when there is no guaranteed income", () => {
    const options = planToWithdrawalOptions(defaultWithdrawalPlan());
    expect(options.annualPensionIncome).toBeUndefined();
    expect(options.pensionYearsUntilStart).toBeUndefined();
  });

  it("carries the stress scenario through unchanged", () => {
    const plan: WithdrawalPlan = { ...defaultWithdrawalPlan(), stress: "earlyCrash" };
    expect(planToWithdrawalOptions(plan).stress).toBe("earlyCrash");
  });
});

describe("planToFireAssumption", () => {
  it("rate-based strategies: passes the rate through, hasStableTarget true except currentPortfolioShare", () => {
    expect(planToFireAssumption({ ...defaultWithdrawalPlan(), strategy: "initialRate" })).toEqual(
      { kind: "rate", rate: 0.04, hasStableTarget: true },
    );
    expect(
      planToFireAssumption({ ...defaultWithdrawalPlan(), strategy: "guardrails" }),
    ).toEqual({ kind: "rate", rate: 0.04, hasStableTarget: true });
    expect(
      planToFireAssumption({ ...defaultWithdrawalPlan(), strategy: "currentPortfolioShare" }),
    ).toEqual({ kind: "rate", rate: 0.04, hasStableTarget: false });
    // Same reasoning as currentPortfolioShare: a floor/ceiling that clips the
    // CURRENT-value base is not an equilibrium target either.
    expect(
      planToFireAssumption({ ...defaultWithdrawalPlan(), strategy: "vanguard" }),
    ).toEqual({ kind: "rate", rate: 0.04, hasStableTarget: false });
  });

  it("fixedRealAmount: reports the amount and inflation assumption for the perpetuity formula", () => {
    const plan: WithdrawalPlan = {
      strategy: "fixedRealAmount",
      amount: { kind: "amount", value: 2000 },
      paymentInterval: "monthly",
      inflation: { indexed: true, assumedRate: 0.025 },
      stress: "none",
    };
    expect(planToFireAssumption(plan)).toEqual({
      kind: "amountPerpetuity",
      annualAmount: 24000,
      inflationIndexed: true,
      assumedInflation: 0.025,
    });
  });
});
