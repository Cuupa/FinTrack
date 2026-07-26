// Named savings goals (ROADMAP item #6, flag `goals`) -- pure, no React, no
// lib/server imports. A goal's progress either mirrors a linked Account's
// current balance (converted to the base currency at spot FX -- same
// convention as `accountsTotals` in lib/finance/accounts.ts) or is entered
// manually.

import type { Account, AccountBalance, Asset, Goal, Transaction } from "../types";
import { summarizeAll, type ValuationContext } from "./portfolio";
import { balanceSeries, currentAccountBalance } from "./accounts";
import { amortizationSchedule } from "./debt";
import { daysBetween } from "./dates";

/**
 * Depot value, base currency, for goals that track investments rather than an
 * account. Passed in rather than computed here so this module stays free of
 * the holdings/valuation machinery (and testable without it).
 */
export interface GoalInvestments {
  /** Market value of every holding. */
  total: number;
  /** Market value per portfolio (= per broker) id. */
  byPortfolio: Record<string, number>;
}

/**
 * Current depot value overall and per broker. A holding belongs to a broker
 * through its TRANSACTIONS (an `Asset` carries no portfolio id), so the
 * per-broker figure is a full re-summary over that broker's transactions,
 * not a regrouping of the combined one. Portfolio counts are single digits,
 * so the repeated pass is cheaper than threading portfolio ids through the
 * holding summaries.
 */
export function goalInvestments(
  assets: Asset[],
  transactions: Transaction[],
  portfolios: readonly { id: string }[],
  v?: ValuationContext,
): GoalInvestments {
  const sum = (txs: Transaction[]) =>
    summarizeAll(assets, txs, v).reduce((acc, h) => acc + h.marketValue, 0);
  const byPortfolio: Record<string, number> = {};
  for (const p of portfolios) {
    byPortfolio[p.id] = sum(transactions.filter((t) => t.portfolioId === p.id));
  }
  return { total: sum(transactions), byPortfolio };
}

/** Spot FX + base currency for converting a linked account's native balance. */
export interface GoalValuation {
  base: string;
  /** native currency -> base rate; the base itself is implicitly 1. */
  fx?: Record<string, number>;
}

function rateFor(account: Account, v?: GoalValuation): number {
  if (!v) return 1;
  const cur = account.currency ?? v.base;
  if (!cur || cur === v.base) return 1;
  return v.fx?.[cur] ?? 1;
}

/**
 * Current progress toward `goal.targetAmount`, in the base currency. When
 * the goal tracks investments, this is the depot's current market value (of
 * one broker, or all of them). Otherwise, when
 * linked to an account, this is that account's latest balance, FX-converted
 * at spot (same convention as `accountsTotals`); falls back to 0 if the
 * linked account no longer exists (deleted -- `linkedAccountId` set null
 * elsewhere, but this stays defensive). Otherwise it's the manually-entered
 * amount (0 if unset).
 */
export function goalProgress(
  goal: Goal,
  accounts: Account[],
  accountBalances: AccountBalance[],
  valuation?: GoalValuation,
  investments?: GoalInvestments,
): number {
  // The depot wins over a linked account: a goal is one or the other, and
  // this order keeps a stale `linkedAccountId` from a re-pointed goal from
  // silently taking over.
  if (goal.tracksInvestments) {
    if (!investments) return 0;
    return goal.linkedPortfolioId
      ? (investments.byPortfolio[goal.linkedPortfolioId] ?? 0)
      : investments.total;
  }
  if (goal.linkedAccountId) {
    const account = accounts.find((a) => a.id === goal.linkedAccountId);
    if (!account) return 0;
    const balance = currentAccountBalance(account, accountBalances) * rateFor(account, valuation);

    // Paying a debt off is progress running the other way: the account's
    // balance is what is still OWED, so it falls as the goal is met. Progress
    // is therefore what has already been repaid, against a target holding the
    // original debt. Returning the raw balance here (as this did before) made
    // a payoff goal read as more complete the deeper into debt you went.
    if (account.isLiability) return Math.max(0, goal.targetAmount - balance);

    return balance;
  }
  return goal.manualCurrentAmount ?? 0;
}

/**
 * The sub-goals of `parentId`, in list order. A goal is composite ("trip to
 * the USA") when it has any and atomic ("emergency fund") when it has none --
 * there is no separate flag to keep in sync.
 */
export function subGoals(goals: readonly Goal[], parentId: string): Goal[] {
  return goals.filter((g) => g.parentGoalId === parentId);
}

/** Every goal that is not a sub-goal of another one. */
export function topLevelGoals(goals: readonly Goal[]): Goal[] {
  return goals.filter((g) => !g.parentGoalId);
}

/** A goal's target and current progress, both in the base currency. */
export interface GoalTotals {
  target: number;
  current: number;
}

/**
 * Target and progress of a goal that may be composite. With sub-goals both
 * are the SUM over them -- the whole point of splitting a trip into flight +
 * hotel + taxi is that the trip costs what its parts cost, so a parent's own
 * `targetAmount` and tracking fields are ignored while it has children (they
 * would otherwise double-count the same money). With no sub-goals this is
 * exactly `goal.targetAmount` and {@link goalProgress}, so atomic goals are
 * unaffected.
 *
 * Nesting is one level deep (see `Goal.parentGoalId`), so a child's own
 * target is always its stored one -- no recursion needed.
 */
export function goalTotals(
  goal: Goal,
  children: readonly Goal[],
  accounts: Account[],
  accountBalances: AccountBalance[],
  valuation?: GoalValuation,
  investments?: GoalInvestments,
): GoalTotals {
  if (children.length === 0) {
    return {
      target: goal.targetAmount,
      current: goalProgress(goal, accounts, accountBalances, valuation, investments),
    };
  }
  let target = 0;
  let current = 0;
  for (const child of children) {
    target += child.targetAmount;
    current += goalProgress(child, accounts, accountBalances, valuation, investments);
  }
  return { target, current };
}

/** Progress percentage toward the target, clamped to [0, 100]. */
export function goalProgressPct(targetAmount: number, current: number): number {
  return Math.min(100, Math.max(0, targetAmount > 0 ? (current / targetAmount) * 100 : 0));
}

/**
 * Id prefix of a payoff goal derived from a liability account (sentinel id,
 * same trick as the `wl:`/`cat:` ids in lib/finance/instrument-asset.ts).
 * Such a goal is never stored -- it exists only for as long as the liability
 * does.
 */
export const PAYOFF_GOAL_PREFIX = "debt:";

/** True for a goal derived from a liability account rather than entered by
 *  the user (no delete, no edit -- the account owns it). */
export function isPayoffGoal(goal: Goal): boolean {
  return goal.id.startsWith(PAYOFF_GOAL_PREFIX);
}

/**
 * One payoff goal per liability account, derived rather than typed: owing
 * money IS a goal to pay it off, so the user shouldn't have to restate a
 * liability as a goal by hand.
 *
 * - target = the highest balance ever recorded for that account (the opening
 *   balance plus every reading), so repayments read as progress and taking on
 *   more debt later moves the target, not the progress, to 0.
 * - target date = the amortisation payoff date when the account carries an
 *   interest rate and a minimum payment (ROADMAP #9), otherwise open-ended.
 *   No guessed date: the schedule is the only honest one.
 * - a liability the user already tracks with a TOP-LEVEL goal of their own is
 *   skipped, so a manual goal always wins over the derived one. A sub-goal
 *   linked to the same account does not count: its progress is summed into its
 *   parent's target and it renders indented under that parent, so suppressing
 *   the derived goal would leave the debt with no row of its own at all.
 *
 * Amounts come out in the base currency, like every other goal figure.
 */
export function liabilityPayoffGoals(
  accounts: Account[],
  accountBalances: AccountBalance[],
  goals: Goal[],
  todayIso: string,
  valuation?: GoalValuation,
): Goal[] {
  const tracked = new Set(
    goals
      .filter((g) => !g.parentGoalId)
      .map((g) => g.linkedAccountId)
      .filter(Boolean),
  );
  const out: Goal[] = [];
  for (const account of accounts) {
    if (!account.isLiability || tracked.has(account.id)) continue;
    const rate = rateFor(account, valuation);
    const peak =
      Math.max(
        account.openingBalance,
        ...balanceSeries(account, accountBalances).map((p) => p.balance),
      ) * rate;
    // A liability that never owed anything is noise, not a goal.
    if (!(peak > 0)) continue;
    const balance = currentAccountBalance(account, accountBalances) * rate;
    const schedule =
      account.interestRate != null && account.minPayment != null
        ? amortizationSchedule(balance, account.interestRate, account.minPayment * rate, todayIso)
        : null;
    out.push({
      id: `${PAYOFF_GOAL_PREFIX}${account.id}`,
      name: account.name,
      targetAmount: peak,
      targetDate: schedule?.payoffDate ?? null,
      linkedAccountId: account.id,
      manualCurrentAmount: null,
      tracksInvestments: false,
      linkedPortfolioId: null,
      parentGoalId: null,
    });
  }
  return out;
}

/** Average days per calendar month, used to convert a day span into months. */
const AVG_DAYS_PER_MONTH = 30.44;

/**
 * Monthly contribution required to reach the goal's target by
 * `goal.targetDate`, in the base currency. Null when there's no target date,
 * or the target is already met. Months remaining is floored at a minimum of
 * 1 so a same-day or past-due target date never divides by zero or produces
 * a negative/infinite result.
 *
 * `target` defaults to the goal's own amount; a composite goal passes the
 * summed target from {@link goalTotals} instead, since that is the figure
 * actually being saved toward.
 */
export function requiredMonthlyContribution(
  goal: Goal,
  current: number,
  todayIso: string,
  target: number = goal.targetAmount,
): number | null {
  if (!goal.targetDate) return null;
  if (current >= target) return null;
  const days = daysBetween(todayIso, goal.targetDate);
  const monthsRemaining = Math.max(1, days / AVG_DAYS_PER_MONTH);
  return (target - current) / monthsRemaining;
}
