// Debt payoff (ROADMAP item #9, flag `debtPayoff`) — pure, no React, no
// lib/server imports. Liability accounts (ROADMAP #1) gain amortisation: a
// single-debt schedule (`amortizationSchedule`) and a multi-debt avalanche/
// snowball extra-payment simulator (`planPayoff`), sibling to
// `lib/finance/monte-carlo.ts` in spirit (a deterministic what-if engine) but
// itself fully deterministic -- no randomness, no worker needed.
//
// All monetary inputs/outputs share one currency (the caller converts to
// base first, the same convention `lib/finance/accounts.ts` uses for FX).
//
// The rate is a SCHEDULE, not a scalar (owner rule, round 26): a German
// mortgage has a fixed-rate period (Zinsbindung) and an assumed follow-up
// rate afterwards, and setting that follow-up rate must never mean rewriting
// the rate that applies today. `RateStep[]` carries the changes; the scalar
// `annualRatePct` is simply the rate in force at the start.

import type { Account } from "../types";
import { addDays, addMonthsToDate } from "./dates";

/** Safety cap so an unpayable debt (payment doesn't cover interest) or a
 *  pathological input terminates instead of looping forever -- 50 years of
 *  monthly payments is far beyond any realistic amortisation. */
const MAX_MONTHS = 600;
/** Balances below this (in currency units) are treated as fully paid off --
 *  guards against floating-point residue never quite reaching zero. */
const EPSILON = 0.005;

/** A dated change of the annual rate: from `from` onwards, `annualRatePct`
 *  applies until the next step (or forever). */
export interface RateStep {
  /** YYYY-MM-DD from which this rate applies (inclusive). */
  from: string;
  /** Annual nominal rate as a percent (4.5 = 4.5%/year). */
  annualRatePct: number;
}

/**
 * The annual rate in force on `isoDate`: the last step starting at or before
 * it, or `initial` when none has started yet. Steps need not be sorted.
 */
export function rateOnDate(
  initial: number,
  steps: readonly RateStep[] | undefined,
  isoDate: string,
): number {
  if (!steps || steps.length === 0) return initial;
  let rate = initial;
  let best = "";
  for (const s of steps) {
    if (s.from <= isoDate && s.from >= best) {
      best = s.from;
      rate = s.annualRatePct;
    }
  }
  return rate;
}

/**
 * The rate schedule implied by one liability account: empty while the rate
 * holds for the whole term, and a single step starting the day after
 * `rateFixedUntil` once the user has entered an assumed follow-up rate. The
 * account's own `interestRate` stays the rate in force today, untouched.
 */
export function accountRateSteps(account: Account): RateStep[] {
  if (!account.rateFixedUntil || account.followUpRate == null) return [];
  if (!Number.isFinite(account.followUpRate)) return [];
  return [{ from: addDays(account.rateFixedUntil, 1), annualRatePct: account.followUpRate }];
}

export interface AmortizationPoint {
  /** 1-based month index. */
  month: number;
  /** YYYY-MM-DD this month's payment falls on (`startDate` + `month`). */
  date: string;
  /** Annual rate in percent charged for this month. */
  annualRatePct: number;
  interest: number;
  /** Balance retired this month -- negative if the payment fell short of the
   *  interest and the debt grew instead. */
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
 * percent (4.5 = 4.5%/year) and the monthly rate is `annualRatePct / 100 / 12`;
 * `rateSteps` overrides it from their own dates onwards.
 *
 * A payment that doesn't cover the month's interest does NOT abort the
 * schedule: the balance simply grows (negative amortisation) and the run keeps
 * going, because a later rate step may well make the same payment sufficient.
 * Only still owing at `MAX_MONTHS` reports `months: null`.
 */
export function amortizationSchedule(
  balance: number,
  annualRatePct: number,
  payment: number,
  startDate: string,
  rateSteps?: readonly RateStep[],
): AmortizationResult {
  if (balance <= EPSILON) {
    return { points: [], totalInterest: 0, months: 0, payoffDate: startDate };
  }
  const points: AmortizationPoint[] = [];
  let remaining = balance;
  let totalInterest = 0;
  let month = 0;

  while (remaining > EPSILON && month < MAX_MONTHS) {
    month++;
    const date = addMonthsToDate(startDate, month);
    const rate = rateOnDate(annualRatePct, rateSteps, date);
    const interest = remaining * (rate / 100 / 12);
    totalInterest += interest;
    const grown = remaining + interest;
    const paid = Math.min(payment, grown);
    remaining = Math.max(0, grown - paid);
    points.push({
      month,
      date,
      annualRatePct: rate,
      interest,
      principal: paid - interest,
      balance: remaining,
    });
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
  /** Dated rate changes (end of a fixed-rate period, ...). */
  rateSteps?: readonly RateStep[];
}

export interface DebtPlanEntry {
  id: string;
  name: string;
  /** Month the debt is fully paid off under this plan, or null if it never
   *  clears within `MAX_MONTHS`. */
  payoffMonth: number | null;
  totalInterest: number;
}

/** One month of the plan: what every debt still owes, and how the month's
 *  money split between interest and principal. Month 0 is the starting state
 *  (no payment made yet) so a chart opens at the full balance. */
export interface DebtPlanPoint {
  month: number;
  /** YYYY-MM-DD. */
  date: string;
  /** Total still owed across all debts after this month. */
  balance: number;
  /** Interest accrued across all debts in this month. */
  interest: number;
  /** Balance actually retired across all debts in this month. */
  principal: number;
  /** Remaining balance per debt id (every debt is present, 0 once cleared). */
  byDebt: Record<string, number>;
  /** Interest accrued this month per debt id. Carried per debt so a chart can
   *  show one debt's interest/principal split without re-running a schedule
   *  that would not know about the plan's extra payments. */
  interestByDebt: Record<string, number>;
}

export interface DebtPlanResult {
  /** Debt ids in the order they were paid off. */
  order: string[];
  perDebt: DebtPlanEntry[];
  /** Months until every debt is paid off, or null if at least one never
   *  clears within `MAX_MONTHS`. */
  totalMonths: number | null;
  totalInterest: number;
  /** Month-by-month balance/interest/principal series for the whole plan. */
  series: DebtPlanPoint[];
}

/** One calendar year of a plan, for the interest-vs-principal chart. */
export interface DebtYear {
  year: number;
  interest: number;
  principal: number;
  /** Still owed at the end of the year (or at payoff, whichever came first). */
  endBalance: number;
}

/**
 * Aggregates a plan series into calendar years -- the resolution a payoff
 * chart is actually readable at, since 490 monthly bars are noise. Pass a
 * `debtId` to narrow it to one debt (its own interest, and the drop in its own
 * balance as principal); omit it for the whole plan.
 */
export function yearlySplit(series: readonly DebtPlanPoint[], debtId?: string): DebtYear[] {
  const years = new Map<number, DebtYear>();
  for (let i = 1; i < series.length; i++) {
    const p = series[i];
    const prev = series[i - 1];
    const year = Number(p.date.slice(0, 4));
    const interest = debtId ? (p.interestByDebt[debtId] ?? 0) : p.interest;
    const opening = debtId ? (prev.byDebt[debtId] ?? 0) : prev.balance;
    const closing = debtId ? (p.byDebt[debtId] ?? 0) : p.balance;
    const entry = years.get(year) ?? { year, interest: 0, principal: 0, endBalance: closing };
    entry.interest += interest;
    entry.principal += opening - closing;
    entry.endBalance = closing;
    years.set(year, entry);
  }
  return [...years.values()].sort((a, b) => a.year - b.year);
}

/**
 * Simulates paying off several debts in parallel: every debt gets its own
 * minimum payment each month, and a shared extra amount (`extraMonthly`,
 * plus the minimum payments freed up by debts already paid off) is thrown at
 * one priority debt at a time, picked by `strategy` --
 * "avalanche" (highest interest rate first, saves the most interest) or
 * "snowball" (smallest balance first, clears debts sooner for momentum).
 *
 * `startDate` anchors the series' dates and every debt's `rateSteps`.
 */
export function planPayoff(
  debts: DebtInput[],
  strategy: DebtStrategy,
  extraMonthly: number,
  startDate = "1970-01-01",
): DebtPlanResult {
  if (debts.length === 0) {
    return { order: [], perDebt: [], totalMonths: 0, totalInterest: 0, series: [] };
  }

  const minPayment = new Map(debts.map((d) => [d.id, Math.max(0, d.minPayment)]));
  const remaining = new Map(debts.map((d) => [d.id, Math.max(0, d.balance)]));
  const interestPaid = new Map<string, number>(debts.map((d) => [d.id, 0]));
  const payoffMonth = new Map<string, number | null>(debts.map((d) => [d.id, null]));
  const order: string[] = [];
  const snapshot = () => Object.fromEntries(debts.map((d) => [d.id, remaining.get(d.id)!]));
  const totalOwed = () => debts.reduce((s, d) => s + remaining.get(d.id)!, 0);

  const zeroPerDebt = () => Object.fromEntries(debts.map((d) => [d.id, 0]));
  const series: DebtPlanPoint[] = [
    {
      month: 0,
      date: startDate,
      balance: totalOwed(),
      interest: 0,
      principal: 0,
      byDebt: snapshot(),
      interestByDebt: zeroPerDebt(),
    },
  ];

  /** Priority is re-evaluated every month: a rate step can reorder an
   *  avalanche mid-plan, which is the whole point of modelling the steps. */
  function priorityOrder(isoDate: string): string[] {
    const active = debts.filter((d) => (remaining.get(d.id) ?? 0) > EPSILON);
    const rate = (d: DebtInput) => rateOnDate(d.annualRatePct, d.rateSteps, isoDate);
    if (strategy === "avalanche") {
      active.sort((a, b) => rate(b) - rate(a) || remaining.get(a.id)! - remaining.get(b.id)!);
    } else {
      active.sort((a, b) => remaining.get(a.id)! - remaining.get(b.id)! || rate(b) - rate(a));
    }
    return active.map((d) => d.id);
  }

  let month = 0;
  // The snowball/avalanche rollover: once a debt is cleared, the money that
  // used to service it keeps flowing into the remaining debts for good. This
  // accumulates and is NEVER reset -- zeroing it after one month (the bug this
  // replaces) silently reduced the plan to "every debt on its own minimum",
  // which reported the same total interest as no plan at all.
  let freedMinPayments = 0;

  while ([...remaining.values()].some((b) => b > EPSILON) && month < MAX_MONTHS) {
    month++;
    const date = addMonthsToDate(startDate, month);
    const openingOwed = totalOwed();
    let monthInterest = 0;
    const monthInterestByDebt: Record<string, number> = zeroPerDebt();
    // Part of a minimum payment its own debt no longer needed (its final,
    // partial instalment) is budget too -- it rolls into this month's pool
    // instead of vanishing.
    let unusedMinimums = 0;

    // Accrue interest and apply each debt's own minimum payment.
    for (const d of debts) {
      const bal = remaining.get(d.id)!;
      if (bal <= EPSILON) continue;
      const interest = bal * (rateOnDate(d.annualRatePct, d.rateSteps, date) / 100 / 12);
      monthInterest += interest;
      monthInterestByDebt[d.id] = interest;
      interestPaid.set(d.id, interestPaid.get(d.id)! + interest);
      const grown = bal + interest;
      const pay = Math.min(minPayment.get(d.id)!, grown);
      unusedMinimums += minPayment.get(d.id)! - pay;
      remaining.set(d.id, Math.max(0, grown - pay));
    }

    // Throw the extra budget (plus the minimums freed up by debts already paid
    // off) at the priority debt(s) for this strategy.
    let pool = extraMonthly + freedMinPayments + unusedMinimums;
    for (const id of priorityOrder(date)) {
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

    series.push({
      month,
      date,
      balance: totalOwed(),
      interest: monthInterest,
      // What the month's money actually retired: the drop in what is owed,
      // net of the interest that was added on top of it first.
      principal: openingOwed - totalOwed(),
      byDebt: snapshot(),
      interestByDebt: monthInterestByDebt,
    });
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
    series,
  };
}
