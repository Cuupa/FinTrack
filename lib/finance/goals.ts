// Named savings goals (ROADMAP item #6, flag `goals`) -- pure, no React, no
// lib/server imports. A goal's progress either mirrors a linked Account's
// current balance (converted to the base currency at spot FX -- same
// convention as `accountsTotals` in lib/finance/accounts.ts) or is entered
// manually.

import type { Account, AccountBalance, Goal } from "../types";
import { currentAccountBalance } from "./accounts";
import { daysBetween } from "./dates";

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
): number {
  if (goal.linkedAccountId) {
    const account = accounts.find((a) => a.id === goal.linkedAccountId);
    if (!account) return 0;
    return currentAccountBalance(account, accountBalances) * rateFor(account, valuation);
  }
  return goal.manualCurrentAmount ?? 0;
}

/** Progress percentage toward the target, clamped to [0, 100]. */
export function goalProgressPct(targetAmount: number, current: number): number {
  return Math.min(100, Math.max(0, targetAmount > 0 ? (current / targetAmount) * 100 : 0));
}

/** Average days per calendar month, used to convert a day span into months. */
const AVG_DAYS_PER_MONTH = 30.44;

/**
 * Monthly contribution required to reach `goal.targetAmount` by
 * `goal.targetDate`, in the base currency. Null when there's no target date,
 * or the target is already met. Months remaining is floored at a minimum of
 * 1 so a same-day or past-due target date never divides by zero or produces
 * a negative/infinite result.
 */
export function requiredMonthlyContribution(
  goal: Goal,
  current: number,
  todayIso: string,
): number | null {
  if (!goal.targetDate) return null;
  if (current >= goal.targetAmount) return null;
  const days = daysBetween(todayIso, goal.targetDate);
  const monthsRemaining = Math.max(1, days / AVG_DAYS_PER_MONTH);
  return (goal.targetAmount - current) / monthsRemaining;
}
