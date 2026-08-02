// Planned income & expenses (flag `plannedCashflow`) -- pure, no React, no
// lib/server imports.
//
// A deliberate sibling of `contract-bookings.ts` rather than a generalisation
// of it, for the same reason that module is a sibling of `savings-plans.ts`:
// each entity has its own cadence set (a contract runs MONTHLY|QUARTERLY|
// ANNUAL, a planned cashflow adds ONCE and WEEKLY and can end on a date), and
// widening both types to share one scheduler would couple planning and
// commitments for the sake of a dozen lines.
//
// Like a contract, the schedule is derived from
// (startDate, interval, endDate, lastBookedDate) and never stored per
// occurrence, so editing a plan re-derives everything instead of leaving
// orphaned rows behind.

import type {
  Account,
  Contract,
  PlannedCashflow,
  PlannedInterval,
  SpendingTransaction,
} from "../types";
import { addDays, addMonthsToDate, lastDayOfMonth, shiftMonth } from "./dates";
import { booksSpending, bookingOccurrenceAt } from "./contract-bookings";
import { isLiquidAccount, liquidCashEffect, toBaseCurrency } from "./spending";

/** Guard against a plan whose start date sits years in the past dumping
    hundreds of bookings into the review dialog at once (same rule and number
    as `contract-bookings.ts`). */
export const MAX_DUE_PLANNED = 24;

const MONTHS_PER_INTERVAL: Record<Exclude<PlannedInterval, "ONCE" | "WEEKLY">, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  ANNUAL: 12,
};

/**
 * The k-th occurrence date (k = 0 is `startDate` itself), or null when the
 * interval has no k-th occurrence (`ONCE` past k = 0). `addMonthsToDate`
 * already clamps the day-of-month to shorter months (Jan 31 -> Feb 28/29),
 * which is the rule contracts and savings plans apply too.
 */
export function plannedOccurrenceAt(
  plan: Pick<PlannedCashflow, "startDate" | "interval" | "monthEnd">,
  k: number,
): string | null {
  // `monthEnd` overrides the clamp rather than refining it: the anchor day
  // stops mattering entirely, so a plan started on the 1st still lands on the
  // 31st. WEEKLY is left alone -- "the last day of the month, weekly" is not a
  // schedule -- and ONCE is a single date the user picked outright.
  if (plan.interval === "ONCE") return k === 0 ? plan.startDate : null;
  if (plan.interval === "WEEKLY") return addDays(plan.startDate, 7 * k);
  const date = addMonthsToDate(plan.startDate, MONTHS_PER_INTERVAL[plan.interval] * k);
  return plan.monthEnd ? lastDayOfMonth(date) : date;
}

/**
 * Every occurrence date within `[from, to]` (inclusive), honouring `endDate`.
 * `cap` bounds the loop so a weekly plan over a decade-long window cannot spin
 * forever; the default covers a few years of weekly payments.
 */
export function plannedOccurrences(
  plan: PlannedCashflow,
  from: string,
  to: string,
  cap = 600,
): string[] {
  const out: string[] = [];
  for (let k = 0; k < cap; k++) {
    const date = plannedOccurrenceAt(plan, k);
    if (date === null) break;
    if (plan.endDate && date > plan.endDate) break;
    if (date > to) break;
    if (date >= from) out.push(date);
  }
  return out;
}

/**
 * The next occurrence at or after `today` that has not been booked yet, or null
 * when the plan has run out (a `ONCE` entry already booked, or an `endDate` in
 * the past). Used to tell the user when the next payment lands, not to post
 * anything.
 */
export function nextPlannedOccurrence(plan: PlannedCashflow, today: string): string | null {
  if (plan.active === false) return null;
  const floor = plan.lastBookedDate && plan.lastBookedDate > today ? plan.lastBookedDate : today;
  for (let k = 0; k < 1000; k++) {
    const date = plannedOccurrenceAt(plan, k);
    if (date === null) return null;
    if (plan.endDate && date > plan.endDate) return null;
    if (date >= floor && !(plan.lastBookedDate && date <= plan.lastBookedDate)) return date;
  }
  return null;
}

/**
 * What this plan works out to per month, for the list's "per month" column:
 * null for `ONCE`, since a single payment has no monthly rate. Signed like
 * `amount`, in the account's native currency.
 */
export function monthlyEquivalent(plan: Pick<PlannedCashflow, "amount" | "interval">): number | null {
  if (plan.interval === "ONCE") return null;
  if (plan.interval === "WEEKLY") return (plan.amount * 52) / 12;
  return plan.amount / MONTHS_PER_INTERVAL[plan.interval];
}

export interface PendingPlannedBooking {
  plannedId: string;
  name: string;
  accountId: string;
  categoryId: string | null;
  date: string;
  /** Signed for the spending ledger, account's native currency. */
  amount: number;
  /** Set when the plan pays into another account of the user's own -- the
   *  booking is then a transfer and every aggregation in `spending.ts` skips
   *  it, exactly like a contract's transfer bookings. */
  transferAccountId: string | null;
}

/**
 * Every occurrence due for one plan: strictly after `lastBookedDate` (or from
 * `startDate` when it has never booked), up to and including `today`.
 */
export function duePlannedDates(plan: PlannedCashflow, today: string): string[] {
  if (plan.active === false) return [];
  const out: string[] = [];
  for (let k = 0; out.length < MAX_DUE_PLANNED; k++) {
    const date = plannedOccurrenceAt(plan, k);
    if (date === null) break;
    if (plan.endDate && date > plan.endDate) break;
    if (date > today) break;
    if (plan.lastBookedDate && date <= plan.lastBookedDate) continue;
    out.push(date);
  }
  return out;
}

/**
 * Flattens every plan's due dates into the rows the review dialog shows and,
 * on confirmation, writes as spending transactions (mirrors `pendingBookings`
 * in `contract-bookings.ts`).
 */
export function duePlannedBookings(
  plans: PlannedCashflow[],
  today: string,
): PendingPlannedBooking[] {
  const out: PendingPlannedBooking[] = [];
  for (const plan of plans) {
    for (const date of duePlannedDates(plan, today)) {
      out.push({
        plannedId: plan.id,
        name: plan.name,
        accountId: plan.accountId,
        categoryId: plan.categoryId,
        date,
        amount: plan.amount,
        transferAccountId: plan.transferAccountId,
      });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface ForecastMonth {
  /** YYYY-MM. */
  month: string;
  /** Booked income already in the ledger this month, base currency. */
  actualIncome: number;
  /** Booked expense magnitude already in the ledger this month, base currency. */
  actualExpense: number;
  /** Still-expected income from plans dated after today, base currency. */
  plannedIncome: number;
  /** Still-expected expense magnitude (plans + contract charges), base currency. */
  plannedExpense: number;
  /** (actual + planned) income minus (actual + planned) expense. */
  projectedNet: number;
  /** Running sum of `projectedNet` across the window. */
  projectedCumulative: number;
}

export interface PlannedForecastInput {
  plans: PlannedCashflow[];
  /** Contracts contribute their still-due charges as planned expense, so the
   *  forecast does not understate the fixed costs the user already registered. */
  contracts: Contract[];
  transactions: SpendingTransaction[];
  accounts: Account[];
  base: string;
  /** Native -> base spot rates, same shape `toBaseCurrency` expects. */
  fx?: Record<string, number>;
  today: string;
  /** Number of months in the window, including the current one. */
  months: number;
}

function monthOf(date: string): string {
  return date.slice(0, 7);
}

/**
 * Month-by-month cash-flow forecast in the base currency, starting with the
 * current month.
 *
 * Nothing is counted twice, and nothing goes missing: a month's actual figures
 * come from the ledger, and every occurrence that has NOT been booked yet is
 * added on top -- including one that is already due but still waiting in the
 * review dialog, which is money the ledger does not know about yet. The
 * `lastBookedDate` cutoff is exactly the line between the two, since booking an
 * occurrence both creates the transaction and advances that date.
 *
 * Transfers between the user's own accounts are neither income nor expense and
 * drop out on both sides, matching `withoutTransfers`.
 */
export function plannedForecast(input: PlannedForecastInput): ForecastMonth[] {
  const { plans, contracts, transactions, accounts, base, fx, today, months } = input;
  if (months <= 0) return [];

  const firstMonth = monthOf(today);
  const lastMonth = shiftMonth(firstMonth, months - 1);
  // Inclusive window end: the last day of `lastMonth` is the day before the
  // first of the following month, which avoids month-length arithmetic here.
  const windowEnd = addDays(`${shiftMonth(lastMonth, 1)}-01`, -1);

  const byMonth = new Map<string, ForecastMonth>();
  for (let i = 0; i < months; i++) {
    const month = shiftMonth(firstMonth, i);
    byMonth.set(month, {
      month,
      actualIncome: 0,
      actualExpense: 0,
      plannedIncome: 0,
      plannedExpense: 0,
      projectedNet: 0,
      projectedCumulative: 0,
    });
  }

  const accountsById = new Map(accounts.map((a) => [a.id, a]));

  // Cash flow, not income vs expense: what counts is money entering or leaving
  // the LIQUID pool. A loan instalment is not an expense (net worth is
  // unchanged) but the cash does leave the current account, and dropping every
  // transfer here left a ledger made mostly of instalments forecasting nothing
  // at all.
  for (const t of toBaseCurrency(transactions, accounts, base, fx)) {
    const row = byMonth.get(monthOf(t.date));
    if (!row) continue;
    const effect = liquidCashEffect(t, accountsById);
    if (effect === 0) continue;
    if (effect > 0) row.actualIncome += effect;
    else row.actualExpense += -effect;
  }
  const rateFor = (accountId: string) => {
    const currency = accountsById.get(accountId)?.currency || base;
    return currency === base ? 1 : (fx?.[currency] ?? 1);
  };

  // The window starts at the first of the current month, not at tomorrow: a
  // due-but-unbooked occurrence earlier this month is still expected money.
  const from = `${firstMonth}-01`;
  for (const plan of plans) {
    // Same liquid rule as the booked rows above, applied to what is still to
    // come: a planned transfer out of a current account is expected cash out.
    const fromLiquid = isLiquidAccount(accountsById.get(plan.accountId));
    if (!fromLiquid) continue;
    if (plan.transferAccountId && isLiquidAccount(accountsById.get(plan.transferAccountId))) {
      continue; // liquid -> liquid nets to zero
    }
    const amount = plan.amount * rateFor(plan.accountId);
    for (const date of plannedOccurrences(plan, from, windowEnd)) {
      if (plan.lastBookedDate && date <= plan.lastBookedDate) continue;
      const row = byMonth.get(monthOf(date));
      if (!row) continue;
      if (amount >= 0) row.plannedIncome += amount;
      else row.plannedExpense += -amount;
    }
  }

  for (const contract of contracts) {
    // Only a contract that actually books charges belongs here: a register-only
    // entry never posts anything, so forecasting it would invent an expense.
    // A contract paying into another own account still costs cash from the
    // charging account, so it is forecast like any other charge -- only a
    // liquid-to-liquid move nets out.
    if (!booksSpending(contract)) continue;
    if (!isLiquidAccount(accountsById.get(contract.accountId!))) continue;
    if (
      contract.targetAccountId &&
      isLiquidAccount(accountsById.get(contract.targetAccountId))
    ) {
      continue;
    }
    for (let k = 0; k < 600; k++) {
      const date = bookingOccurrenceAt(contract.bookingStartDate!, contract.interval, k, contract.monthEnd);
      if (date > windowEnd) break;
      if (date < from) continue;
      if (contract.lastBookedDate && date <= contract.lastBookedDate) continue;
      const row = byMonth.get(monthOf(date));
      if (!row) continue;
      // Contract amounts are already in the base currency (see `Contract`).
      row.plannedExpense += Math.abs(contract.amount);
    }
  }

  let cumulative = 0;
  const out: ForecastMonth[] = [];
  for (let i = 0; i < months; i++) {
    const row = byMonth.get(shiftMonth(firstMonth, i))!;
    row.projectedNet =
      row.actualIncome + row.plannedIncome - row.actualExpense - row.plannedExpense;
    cumulative += row.projectedNet;
    row.projectedCumulative = cumulative;
    out.push(row);
  }
  return out;
}

export interface PlannedMonthlyTotals {
  /** Recurring planned income per month, base currency. */
  income: number;
  /** Recurring planned expense magnitude per month, base currency. */
  expense: number;
  /** income - expense. */
  net: number;
}

/**
 * The recurring plans normalised to one month and converted to base currency --
 * the "this is what a typical month looks like on paper" figure. `ONCE` entries
 * are excluded (they have no monthly rate), as are transfers.
 */
export function plannedMonthlyTotals(
  plans: PlannedCashflow[],
  accounts: Account[],
  base: string,
  fx?: Record<string, number>,
): PlannedMonthlyTotals {
  const accountsById = new Map(accounts.map((a) => [a.id, a]));
  let income = 0;
  let expense = 0;
  for (const plan of plans) {
    if (plan.transferAccountId) continue;
    const monthly = monthlyEquivalent(plan);
    if (monthly === null) continue;
    const currency = accountsById.get(plan.accountId)?.currency || base;
    const amount = monthly * (currency === base ? 1 : (fx?.[currency] ?? 1));
    if (amount >= 0) income += amount;
    else expense += -amount;
  }
  return { income, expense, net: income - expense };
}
