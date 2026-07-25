// Materialising a contract's recurring charge into spending transactions
// (ROADMAP #5 cont.) — pure, no React, no lib/server imports.
//
// Deliberately a sibling of `savings-plans.ts` rather than a generalisation of
// it: that module is typed to `SavingsPlan` and its WEEKLY|MONTHLY|QUARTERLY
// cadence, while a contract runs MONTHLY|QUARTERLY|ANNUAL. Widening both types
// to share one scheduler would couple the investment and spending sides for
// the sake of about ten lines.
//
// The schedule is derived from (bookingStartDate, interval, lastBookedDate) and
// never stored per occurrence, so editing a contract re-derives everything
// instead of leaving orphaned rows behind.

import type { Contract, ContractInterval } from "../types";
import { addMonthsToDate } from "./dates";

/** Guard against a contract whose start date sits years in the past dumping
    hundreds of bookings into the review dialog at once. */
export const MAX_DUE_BOOKINGS = 24;

const MONTHS_PER_INTERVAL: Record<ContractInterval, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  ANNUAL: 12,
};

/**
 * The k-th booking date (k = 0 is `bookingStartDate` itself). `addMonthsToDate`
 * already clamps the day-of-month to shorter months (Jan 31 -> Feb 28/29),
 * which is the same rule brokers and `savings-plans.ts` apply.
 */
export function bookingOccurrenceAt(
  startDate: string,
  interval: ContractInterval,
  k: number,
): string {
  return addMonthsToDate(startDate, MONTHS_PER_INTERVAL[interval] * k);
}

/** Whether this contract posts bookings at all. */
export function booksSpending(contract: Pick<Contract, "accountId" | "bookingStartDate">): boolean {
  return Boolean(contract.accountId && contract.bookingStartDate);
}

/**
 * Every booking date due for this contract: strictly after `lastBookedDate`
 * (or from `bookingStartDate` when it has never booked), up to and including
 * `today`. A contract without an account or start date is never due.
 */
export function dueBookings(contract: Contract, today: string): string[] {
  if (!booksSpending(contract)) return [];
  const start = contract.bookingStartDate!;
  const out: string[] = [];
  for (let k = 0; out.length < MAX_DUE_BOOKINGS; k++) {
    const date = bookingOccurrenceAt(start, contract.interval, k);
    if (date > today) break;
    if (contract.lastBookedDate && date <= contract.lastBookedDate) continue;
    out.push(date);
  }
  return out;
}

/**
 * The next booking date at or after `today` that has not been booked yet, or
 * null when the contract does not book. Used to tell the user when the next
 * charge lands, not to post anything.
 */
export function nextBooking(contract: Contract, today: string): string | null {
  if (!booksSpending(contract)) return null;
  const start = contract.bookingStartDate!;
  const floor =
    contract.lastBookedDate && contract.lastBookedDate > today ? contract.lastBookedDate : today;
  for (let k = 0; k < 1000; k++) {
    const date = bookingOccurrenceAt(start, contract.interval, k);
    if (date >= floor && !(contract.lastBookedDate && date <= contract.lastBookedDate)) return date;
  }
  return null;
}

export interface PendingBooking {
  contractId: string;
  contractName: string;
  accountId: string;
  categoryId: string | null;
  date: string;
  /** Signed for the spending ledger: a contract charge is always an expense. */
  amount: number;
}

/**
 * Flattens every contract's due dates into the rows the review dialog shows
 * and, on confirmation, writes as spending transactions.
 */
export function pendingBookings(contracts: Contract[], today: string): PendingBooking[] {
  const out: PendingBooking[] = [];
  for (const contract of contracts) {
    for (const date of dueBookings(contract, today)) {
      out.push({
        contractId: contract.id,
        contractName: contract.name,
        accountId: contract.accountId!,
        categoryId: contract.categoryId,
        date,
        amount: -Math.abs(contract.amount),
      });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
