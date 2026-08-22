// The single withdrawal assumption shared by FIRE and the Monte Carlo
// simulation (see WITHDRAWAL_REFACTOR_PLAN.md). FIRE reads it to size the
// target portfolio (`planToFireAssumption`); the simulation reads it to
// drive the existing path-wise decumulation engine
// (`planToWithdrawalOptions` -> lib/finance/monte-carlo.ts /
// lib/finance/withdrawal.ts, both otherwise UNCHANGED). This module is a
// translation layer, not a second engine -- the two formula worlds
// (perpetuity vs. path simulation) stay separate, they just read the same
// assumption.
//
// Five strategies are first-class here; `floorCeiling` and `vpw` stay
// available in the underlying engine (`WithdrawalStrategyId`) for backward
// compatibility, but are not offered through this model. `floorCeiling`'s
// band never moves off year one -- `vanguard` below supersedes it for anyone
// who wants a floor/ceiling that tracks what was actually spent last year.

import {
  DEFAULT_GUARDRAIL_ADJUST,
  DEFAULT_GUARDRAIL_BAND,
  DEFAULT_INFLATION,
  DEFAULT_VANGUARD_CEILING,
  DEFAULT_VANGUARD_FLOOR,
  type StressScenario,
} from "./withdrawal";
import type { WithdrawalOptions } from "./monte-carlo";

/** What a rate is a percentage OF. */
export type WithdrawalRateBasis =
  /** % of the portfolio's value at the moment retirement starts, fixed once
      and never re-evaluated. */
  | "atRetirement"
  /** % of the CURRENT portfolio value, re-evaluated every year. */
  | "currentValue";

/** The five strategies with a reproducible, testable definition. */
export type WithdrawalStrategyKind =
  | "fixedRealAmount"
  | "initialRate"
  | "currentPortfolioShare"
  | "guardrails"
  | "vanguard";

export const WITHDRAWAL_STRATEGY_KINDS: readonly WithdrawalStrategyKind[] = [
  "fixedRealAmount",
  "initialRate",
  "currentPortfolioShare",
  "guardrails",
  "vanguard",
];

/** The rate basis each rate-based strategy implies -- not user-choosable,
    since pairing a strategy with the "wrong" basis is not a real
    combination anyone asked for. */
export const STRATEGY_RATE_BASIS: Record<
  Exclude<WithdrawalStrategyKind, "fixedRealAmount">,
  WithdrawalRateBasis
> = {
  initialRate: "atRetirement",
  currentPortfolioShare: "currentValue",
  guardrails: "atRetirement",
  // Vanguard's own base step re-reads the CURRENT portfolio every year (see
  // withdrawal.ts) -- the floor/ceiling then clip how far that base may move,
  // it does not change what the base is a percentage OF.
  vanguard: "currentValue",
};

export interface WithdrawalPlan {
  strategy: WithdrawalStrategyKind;
  /** `fixedRealAmount`: a literal amount, interpreted via `paymentInterval`.
      Every other strategy: a rate (fraction, e.g. 0.04). */
  amount: { kind: "amount"; value: number } | { kind: "rate"; value: number };
  /** How `amount.value` is stated when `kind === "amount"` -- "monthly"
      means the value is monthly and gets annualised (x12) before reaching
      the engine. Ignored for rate-based strategies (a rate has no interval
      of its own). */
  paymentInterval: "monthly" | "annual";
  /** Whether -- and at what assumed rate -- the withdrawal rises with
      inflation. `currentPortfolioShare` ignores this: re-tracking the
      market every year already is its inflation adjustment, applying both
      would adjust the same figure twice. `guardrails` always indexes
      (Guyton-Klinger's own rule) regardless of what is set here. */
  inflation: { indexed: boolean; assumedRate: number };
  /** `guardrails` only: the drift allowed before an adjustment fires, and
      the adjustment's size. Defaults apply when omitted. */
  guardrails?: { band: number; adjust: number };
  /** `vanguard` only: the year-over-year ceiling/floor around last year's
      actual spending. Defaults apply when omitted (Vanguard's own published
      5% / 2.5%). */
  vanguard?: { ceiling: number; floor: number };
  /** Other guaranteed income (statutory + private pension, combined into
      one bridge -- not per source). Reduces the portfolio's withdrawal need
      once it starts; absent when there is none. */
  guaranteedIncome?: { annualAmount: number; yearsUntilStart: number };
  /** Forced bad market sequence to test the plan against. */
  stress: StressScenario;
}

/** Today's behaviour, unchanged: 4% initial rate, 2% inflation, no stress,
    no guaranteed income -- introducing this model changes nothing for a
    page that has not opted into a different strategy yet. */
export function defaultWithdrawalPlan(): WithdrawalPlan {
  return {
    strategy: "initialRate",
    amount: { kind: "rate", value: 0.04 },
    paymentInterval: "annual",
    inflation: { indexed: true, assumedRate: DEFAULT_INFLATION },
    stress: "none",
  };
}

/** The rate basis implied by a plan's strategy, or null for an amount plan. */
export function rateBasisOf(plan: WithdrawalPlan): WithdrawalRateBasis | null {
  if (plan.strategy === "fixedRealAmount") return null;
  return STRATEGY_RATE_BASIS[plan.strategy];
}

/** The plan's rate as a fraction, or null for an amount-based plan. */
export function rateOf(plan: WithdrawalPlan): number | null {
  return plan.amount.kind === "rate" ? Math.max(0, plan.amount.value) : null;
}

/** The plan's ANNUAL amount (converted from monthly if needed), or null for
    a rate-based plan. */
export function annualAmountOf(plan: WithdrawalPlan): number | null {
  if (plan.amount.kind !== "amount") return null;
  const value = Math.max(0, plan.amount.value);
  return plan.paymentInterval === "monthly" ? value * 12 : value;
}

/** The effective annual inflation rate the engine should index by --
    `currentPortfolioShare` forces 0 regardless of the stored assumption
    (see the field doc on `inflation` above). */
function effectiveInflation(plan: WithdrawalPlan): number {
  if (plan.strategy === "currentPortfolioShare") return 0;
  return plan.inflation.indexed ? Math.max(0, plan.inflation.assumedRate) : 0;
}

/**
 * Translate a domain plan into the engine's `WithdrawalOptions` -- the ONLY
 * place that maps a `WithdrawalStrategyKind` to the underlying
 * `WithdrawalStrategyId`. The path-wise engine itself stays untouched:
 * `fixedRealAmount` and `initialRate` both reuse its existing `"fixed"` case
 * (inflation-indexed carry-forward of a first-year amount), differing only
 * in whether that first year comes from a stated amount or from
 * rate x portfolio value.
 */
export function planToWithdrawalOptions(plan: WithdrawalPlan): WithdrawalOptions {
  const guaranteed = plan.guaranteedIncome;
  const base: WithdrawalOptions = {
    stress: plan.stress,
    inflation: effectiveInflation(plan),
    annualPensionIncome: guaranteed?.annualAmount,
    pensionYearsUntilStart: guaranteed?.yearsUntilStart,
  };
  switch (plan.strategy) {
    case "fixedRealAmount":
      return {
        ...base,
        withdrawalStrategy: "fixed",
        fixedAnnualAmount: annualAmountOf(plan) ?? 0,
      };
    case "initialRate":
      return {
        ...base,
        withdrawalStrategy: "fixed",
        withdrawalRate: rateOf(plan) ?? 0,
      };
    case "currentPortfolioShare":
      return {
        ...base,
        withdrawalStrategy: "percentOfPortfolio",
        withdrawalRate: rateOf(plan) ?? 0,
      };
    case "guardrails":
      return {
        ...base,
        withdrawalStrategy: "guardrails",
        withdrawalRate: rateOf(plan) ?? 0,
        guardrailBand: plan.guardrails?.band ?? DEFAULT_GUARDRAIL_BAND,
        guardrailAdjust: plan.guardrails?.adjust ?? DEFAULT_GUARDRAIL_ADJUST,
      };
    case "vanguard":
      return {
        ...base,
        withdrawalStrategy: "vanguard",
        withdrawalRate: rateOf(plan) ?? 0,
        vanguardCeiling: plan.vanguard?.ceiling ?? DEFAULT_VANGUARD_CEILING,
        vanguardFloor: plan.vanguard?.floor ?? DEFAULT_VANGUARD_FLOOR,
      };
  }
}

/**
 * What FIRE's closed-form perpetuity math needs out of a plan -- either a
 * rate (fed to `fireNumber`/`fireNumberWithPension`, unchanged) or a stated
 * amount (fed to the amount-based perpetuity in `lib/finance/fire.ts`).
 * Kept separate from `WithdrawalOptions` because FIRE and the simulation ask
 * genuinely different questions of the same plan (see WITHDRAWAL_REFACTOR_
 * PLAN.md §5.3): FIRE wants "what portfolio sustains this forever", the
 * simulation wants "what happens on this path".
 */
export type FireAssumption =
  | { kind: "rate"; rate: number; hasStableTarget: boolean }
  | {
      kind: "amountPerpetuity";
      annualAmount: number;
      inflationIndexed: boolean;
      assumedInflation: number;
    };

export function planToFireAssumption(plan: WithdrawalPlan): FireAssumption {
  if (plan.strategy === "fixedRealAmount") {
    return {
      kind: "amountPerpetuity",
      annualAmount: annualAmountOf(plan) ?? 0,
      inflationIndexed: plan.inflation.indexed,
      assumedInflation: plan.inflation.assumedRate,
    };
  }
  return {
    kind: "rate",
    rate: rateOf(plan) ?? 0,
    // A rate re-evaluated against the CURRENT portfolio every year has no
    // closed-form "holds forever" target in the classic sense: the formula
    // still returns a number (the first year happens to match it), but
    // later years diverge with the market. Every other strategy's target
    // genuinely means "this portfolio lasts forever at this assumption".
    // `vanguard` shares this: its floor/ceiling clip how far the CURRENT-
    // value base may move, they do not turn it into an equilibrium target.
    hasStableTarget: plan.strategy !== "currentPortfolioShare" && plan.strategy !== "vanguard",
  };
}
