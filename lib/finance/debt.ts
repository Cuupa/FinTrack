// Debt payoff (ROADMAP item #9, flag `debtPayoff`) — pure, no React, no
// lib/server imports. Liability accounts (ROADMAP #1) gain amortisation: a
// single-debt schedule (`amortizationSchedule`) and a multi-debt avalanche/
// snowball extra-payment simulator (`planPayoff`), sibling to
// `lib/finance/monte-carlo.ts` in spirit (a deterministic what-if engine) but
// itself fully deterministic -- no randomness, no worker needed.
//
// All monetary inputs/outputs share one currency (the caller converts to
// base first, the same convention `lib/finance/accounts.ts` uses for FX).

import { addMonthsToDate } from "./dates";

/** Safety cap so an unpayable debt (payment doesn't cover interest) or a
 *  pathological input terminates instead of looping forever -- 50 years of
 *  monthly payments is far beyond any realistic amortisation. */
const MAX_MONTHS = 600;
/** Balances below this (in currency units) are treated as fully paid off --
 *  guards against floating-point residue never quite reaching zero. */
const EPSILON = 0.005;

export interface AmortizationPoint {
  /** 1-based month index. */
  month: number;
  interest: number;
  principal: number;
  /** Remaining balance after this month's payment. */
  balance: number;
}

export interface AmortizationResult {
  points: AmortizationPoint[];
  totalInterest: number;
  /** Months to pay off, or null if the payment never clears the debt within
   *  `MAX_MONTHS` (e.g. it doesn't even cover the monthly interest). */
  months: number | null;
  /** YYYY-MM-DD payoff date, or null alongside a null `months`. */
  payoffDate: string | null;
}

/**
 * Fixed-payment amortisation schedule for one debt. `annualRatePct` is a
 * percent (4.5 = 4.5%/year); the monthly rate is `annualRatePct / 100 / 12`.
 */
export function amortizationSchedule(
  balance: number,
  annualRatePct: number,
  payment: number,
  startDate: string,
): AmortizationResult {
  if (balance <= EPSILON) {
    return { points: [], totalInterest: 0, months: 0, payoffDate: startDate };
  }
  const monthlyRate = annualRatePct / 100 / 12;
  const points: AmortizationPoint[] = [];
  let remaining = balance;
  let totalInterest = 0;
  let month = 0;

  while (remaining > EPSILON && month < MAX_MONTHS) {
    month++;
    const interest = remaining * monthlyRate;
    let principal = payment - interest;
    totalInterest += interest;
    if (principal <= 0) {
      // The payment doesn't even cover interest -- the balance never shrinks.
      points.push({ month, interest, principal: 0, balance: remaining });
      return { points, totalInterest, months: null, payoffDate: null };
    }
    if (principal > remaining) principal = remaining;
    remaining -= principal;
    points.push({ month, interest, principal, balance: remaining });
  }

  if (remaining > EPSILON) {
    return { points, totalInterest, months: null, payoffDate: null };
  }
  return { points, totalInterest, months: month, payoffDate: addMonthsToDate(startDate, month) };
}

export type DebtStrategy = "avalanche" | "snowball";

export interface DebtInput {
  id: string;
  name: string;
  /** Positive magnitude, one shared currency across every debt in the plan. */
  balance: number;
  annualRatePct: number;
  minPayment: number;
}

export interface DebtPlanEntry {
  id: string;
  name: string;
  /** Month the debt is fully paid off under this plan, or null if it never
   *  clears within `MAX_MONTHS`. */
  payoffMonth: number | null;
  totalInterest: number;
}

export interface DebtPlanResult {
  /** Debt ids in the order they were paid off. */
  order: string[];
  perDebt: DebtPlanEntry[];
  /** Months until every debt is paid off, or null if at least one never
   *  clears within `MAX_MONTHS`. */
  totalMonths: number | null;
  totalInterest: number;
}

/**
 * Simulates paying off several debts in parallel: every debt gets its own
 * minimum payment each month, and a shared extra amount (`extraMonthly`,
 * plus the minimum payments freed up by debts already paid off) is thrown at
 * one priority debt at a time, picked by `strategy` --
 * "avalanche" (highest interest rate first, saves the most interest) or
 * "snowball" (smallest balance first, clears debts sooner for momentum).
 */
export function planPayoff(
  debts: DebtInput[],
  strategy: DebtStrategy,
  extraMonthly: number,
): DebtPlanResult {
  if (debts.length === 0) {
    return { order: [], perDebt: [], totalMonths: 0, totalInterest: 0 };
  }

  const monthlyRate = new Map(debts.map((d) => [d.id, d.annualRatePct / 100 / 12]));
  const minPayment = new Map(debts.map((d) => [d.id, Math.max(0, d.minPayment)]));
  const remaining = new Map(debts.map((d) => [d.id, Math.max(0, d.balance)]));
  const interestPaid = new Map<string, number>(debts.map((d) => [d.id, 0]));
  const payoffMonth = new Map<string, number | null>(debts.map((d) => [d.id, null]));
  const order: string[] = [];

  function priorityOrder(): string[] {
    const active = debts.filter((d) => (remaining.get(d.id) ?? 0) > EPSILON);
    if (strategy === "avalanche") {
      active.sort(
        (a, b) => b.annualRatePct - a.annualRatePct || (remaining.get(a.id)! - remaining.get(b.id)!),
      );
    } else {
      active.sort(
        (a, b) => remaining.get(a.id)! - remaining.get(b.id)! || b.annualRatePct - a.annualRatePct,
      );
    }
    return active.map((d) => d.id);
  }

  let month = 0;
  let freedMinPayments = 0;

  while ([...remaining.values()].some((b) => b > EPSILON) && month < MAX_MONTHS) {
    month++;

    // Accrue interest and apply each debt's own minimum payment.
    for (const d of debts) {
      const bal = remaining.get(d.id)!;
      if (bal <= EPSILON) continue;
      const interest = bal * monthlyRate.get(d.id)!;
      interestPaid.set(d.id, interestPaid.get(d.id)! + interest);
      const grown = bal + interest;
      const pay = Math.min(minPayment.get(d.id)!, grown);
      remaining.set(d.id, Math.max(0, grown - pay));
    }

    // Throw the extra budget (plus freed-up minimums from paid-off debts) at
    // the priority debt(s) for this strategy.
    let pool = extraMonthly + freedMinPayments;
    freedMinPayments = 0;
    for (const id of priorityOrder()) {
      if (pool <= EPSILON) break;
      const bal = remaining.get(id)!;
      if (bal <= EPSILON) continue;
      const pay = Math.min(pool, bal);
      remaining.set(id, bal - pay);
      pool -= pay;
    }

    // Record any debt that finished this month.
    for (const d of debts) {
      if (payoffMonth.get(d.id) == null && (remaining.get(d.id) ?? 0) <= EPSILON) {
        payoffMonth.set(d.id, month);
        order.push(d.id);
        freedMinPayments += minPayment.get(d.id)!;
      }
    }
  }

  const allPaid = [...remaining.values()].every((b) => b <= EPSILON);
  const perDebt: DebtPlanEntry[] = debts.map((d) => ({
    id: d.id,
    name: d.name,
    payoffMonth: payoffMonth.get(d.id) ?? null,
    totalInterest: interestPaid.get(d.id) ?? 0,
  }));

  return {
    order,
    perDebt,
    totalMonths: allPaid ? month : null,
    totalInterest: perDebt.reduce((s, p) => s + p.totalInterest, 0),
  };
}
