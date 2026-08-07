import { describe, it, expect } from "vitest";
import { hashSimParams, type SimulationMessage } from "@/lib/simulation/use-monte-carlo";
import type { MonteCarloParams } from "@/lib/finance/monte-carlo";

// One runner, one cache key: any field that changes the RESULT has to change
// the hash, or an identical-looking run replays a stale stored result.
const base: MonteCarloParams = {
  initialCapital: 100_000,
  monthlyContribution: 500,
  years: 20,
  expectedReturn: 0.07,
  volatility: 0.15,
  runs: 1000,
  seed: 1,
  withdrawalYears: 30,
  withdrawalRate: 0.04,
};

const msg = (params: Partial<MonteCarloParams> = {}): SimulationMessage => ({
  kind: "scalar",
  params: { ...base, ...params },
});

describe("hashSimParams", () => {
  it("ignores the seed, so identical inputs reuse a stored run", () => {
    expect(hashSimParams(msg({ seed: 42 }))).toBe(hashSimParams(msg({ seed: 7 })));
  });

  it("separates runs that count a pension from runs that do not", () => {
    const withPension = msg({ annualPensionIncome: 18_000, pensionYearsUntilStart: 12 });
    expect(hashSimParams(withPension)).not.toBe(hashSimParams(msg()));
    expect(
      hashSimParams(msg({ annualPensionIncome: 18_000, pensionYearsUntilStart: 20 })),
    ).not.toBe(hashSimParams(withPension));
  });

  it("separates runs by inflation, which indexes every withdrawal", () => {
    expect(hashSimParams(msg({ inflation: 0.02 }))).not.toBe(
      hashSimParams(msg({ inflation: 0.05 })),
    );
  });
});
