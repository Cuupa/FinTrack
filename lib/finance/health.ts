// Financial-health gauges (ROADMAP item #7, flag `finHealth`) -- pure, no
// React, no lib/server imports. Nearly free once accounts (#1), spending
// (#2) and budgets (#4) are already in the tree: four ratios derived from
// data that already exists, no new stored entity and no migration beyond a
// seeded feature flag.
//
// There is no tracked "income" entity anywhere in FinTrack -- a spending
// transaction's signed `amount` (positive = income) is the only income
// signal that exists (see `lib/finance/spending.ts`), so every income/
// expense figure here is a trailing-12-month average pulled from spending
// transactions via `byCategoryAndMonth`/`incomeExpenseSplit`.

import type { Account, AccountBalance, AccountKind, SpendingTransaction } from "../types";
import { accountsTotals, currentAccountBalance } from "./accounts";
import { byCategoryAndMonth, incomeExpenseSplit } from "./spending";
import { shiftMonth } from "./dates";

/** Spot FX + base currency for converting native account balances (mirrors
 *  `AccountValuation` in `lib/finance/accounts.ts` -- duplicated rather than
 *  imported, same precedent as `GoalValuation` in `lib/finance/goals.ts`). */
export interface HealthValuation {
  base: string;
  /** native currency -> base rate; the base itself is implicitly 1. */
  fx?: Record<string, number>;
}

function rateFor(account: Account, v?: HealthValuation): number {
  if (!v) return 1;
  const cur = account.currency ?? v.base;
  if (!cur || cur === v.base) return 1;
  return v.fx?.[cur] ?? 1;
}

/** Account kinds treated as spendable on short notice for the "months of
 *  expenses covered" gauge. Deliberately narrower than "every non-liability
 *  account": `other_asset` (e.g. a manually-tracked house or car value) is
 *  real net worth but not liquid emergency-fund money. */
const LIQUID_ACCOUNT_KINDS: AccountKind[] = ["checking", "savings"];

/**
 * Sum of liquid (checking/savings) account balances, base currency, spot FX
 * -- same conversion convention as `accountsTotals`. Excludes liabilities by
 * construction and excludes `other_asset`/liability kinds (see
 * `LIQUID_ACCOUNT_KINDS`). This is the numerator for
 * `monthsOfExpensesCovered`.
 */
export function liquidBalance(
  accounts: Account[],
  balances: AccountBalance[],
  v?: HealthValuation,
): number {
  let sum = 0;
  for (const a of accounts) {
    if (a.isLiability || !LIQUID_ACCOUNT_KINDS.includes(a.kind)) continue;
    sum += currentAccountBalance(a, balances) * rateFor(a, v);
  }
  return sum;
}

/**
 * Months of average expenses a liquid balance would cover. Null when there's
 * no expense data to divide by (can't measure a runway against zero spend).
 */
export function monthsOfExpensesCovered(
  liquidBalance: number,
  avgMonthlyExpense: number,
): number | null {
  if (avgMonthlyExpense === 0) return null;
  return liquidBalance / avgMonthlyExpense;
}

/**
 * (income - expense) / income, as a 0-1 fraction (the UI multiplies by 100).
 * Null when there's no income to measure a rate against.
 */
export function savingsRate(monthlyIncome: number, monthlyExpense: number): number | null {
  if (monthlyIncome === 0) return null;
  return (monthlyIncome - monthlyExpense) / monthlyIncome;
}

/**
 * Simplified debt-to-income for this MVP: total liability *account balances*
 * (not monthly loan payments -- FinTrack tracks no amortization/payment
 * schedule yet, that's the future ROADMAP #9 "Debt payoff") against
 * ANNUALIZED income. A reasonable stand-in ratio ("total debt / a year of
 * income") rather than a textbook monthly-payment DTI. Null when there's no
 * income to measure against.
 */
export function debtToIncomeRatio(
  totalLiabilities: number,
  annualIncome: number,
): number | null {
  if (annualIncome === 0) return null;
  return totalLiabilities / annualIncome;
}

/**
 * Net worth divided by annual income. Can be negative -- net worth itself can
 * be negative since accounts (#1) let liabilities outweigh assets. Null when
 * there's no income to measure against.
 */
export function netWorthToIncome(netWorth: number, annualIncome: number): number | null {
  if (annualIncome === 0) return null;
  return netWorth / annualIncome;
}

export interface FinancialHealthSnapshot {
  monthsOfExpensesCovered: number | null;
  savingsRate: number | null;
  debtToIncomeRatio: number | null;
  netWorthToIncome: number | null;
}

/** Trailing window size for the income/expense average, in calendar months. */
const TRAILING_MONTHS = 12;

/**
 * Single entry point the UI calls once: derives the four gauges above from
 * accounts, spending transactions and the caller's already-computed net
 * worth (same figure as the dashboard hero:
 * `portfolioTotals(...).marketValue + accountsValueOn(...)`, see
 * `components/dashboard/net-worth-hero.tsx` -- this module doesn't reach
 * into `lib/finance/portfolio.ts` itself to keep its inputs to primitives +
 * the entities it actually needs).
 *
 * Income/expense average over the trailing 12 calendar months up to and
 * including `todayIso`'s month, via `byCategoryAndMonth`/
 * `incomeExpenseSplit`. The denominator is the number of DISTINCT months
 * that actually have a transaction in the window (capped at 12, floored at
 * 1) rather than a flat 12 -- so a brand-new user with one month of spending
 * history gets that month's real average instead of it being diluted
 * toward zero by eleven empty months it hasn't lived through yet.
 */
export function computeFinancialHealth(
  accounts: Account[],
  accountBalances: AccountBalance[],
  spendingTransactions: SpendingTransaction[],
  netWorth: number,
  todayIso: string,
  v?: HealthValuation,
): FinancialHealthSnapshot {
  const currentMonth = todayIso.slice(0, 7);
  const startMonth = shiftMonth(currentMonth, -(TRAILING_MONTHS - 1));
  const windowed = spendingTransactions.filter((t) => {
    const m = t.date.slice(0, 7);
    return m >= startMonth && m <= currentMonth;
  });

  const monthTotals = byCategoryAndMonth(windowed);
  const distinctMonths = new Set(monthTotals.map((m) => m.month)).size;
  const denominator = Math.max(1, Math.min(TRAILING_MONTHS, distinctMonths));

  const { income, expense } = incomeExpenseSplit(windowed);
  const avgMonthlyIncome = income / denominator;
  const avgMonthlyExpense = expense / denominator;
  const annualIncome = avgMonthlyIncome * 12;

  const liquid = liquidBalance(accounts, accountBalances, v);
  const { liabilities } = accountsTotals(accounts, accountBalances, v);

  return {
    monthsOfExpensesCovered: monthsOfExpensesCovered(liquid, avgMonthlyExpense),
    savingsRate: savingsRate(avgMonthlyIncome, avgMonthlyExpense),
    debtToIncomeRatio: debtToIncomeRatio(liabilities, annualIncome),
    netWorthToIncome: netWorthToIncome(netWorth, annualIncome),
  };
}
