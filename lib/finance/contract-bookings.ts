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

import type { Account, AccountBalance, Contract, ContractInterval } from "../types";
import { addMonthsToDate } from "./dates";
import { accountBalanceOn } from "./accounts";
import { accountRateSteps, rateOnDate } from "./debt";
import type { AccountMovements } from "./account-ledger";

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
  /** Signed for the spending ledger: money leaves the account either way. */
  amount: number;
  /**
   * The interest share of this charge, as a POSITIVE magnitude, or 0 when the
   * charge does not split.
   *
   * A loan instalment is two different things wearing one number: the interest
   * is consumed (gone, like rent), the principal is a transfer that shrinks the
   * debt. Booking the whole instalment as a transfer made the interest
   * invisible in every expense figure; booking it all as an expense would have
   * double-counted the repayment. Only a charge paying into an interest-bearing
   * liability splits -- everything else keeps `0` and books as a single row
   * exactly as before.
   */
  interestAmount: number;
  /**
   * Set when the contract pays into another account of the user's own — a loan
   * being repaid, or a wealth-building policy. Such a booking is a transfer,
   * not consumption, and `lib/finance/spending.ts` keeps it out of every
   * income/expense aggregation.
   */
  transferAccountId: string | null;
}

/**
 * Flattens every contract's due dates into the rows the review dialog shows
 * and, on confirmation, writes as spending transactions.
 */
export function pendingBookings(
  contracts: Contract[],
  today: string,
  accounts?: readonly Account[],
  balances?: AccountBalance[],
  movements?: AccountMovements,
): PendingBooking[] {
  const byId = accounts ? new Map(accounts.map((a) => [a.id, a])) : null;
  const out: PendingBooking[] = [];
  for (const contract of contracts) {
    for (const date of dueBookings(contract, today)) {
      const charge = Math.abs(contract.amount);
      out.push({
        contractId: contract.id,
        contractName: contract.name,
        accountId: contract.accountId!,
        categoryId: contract.categoryId,
        date,
        amount: -charge,
        interestAmount: interestShare(contract, date, charge, byId, balances, movements),
        transferAccountId: contract.targetAccountId ?? null,
      });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * The interest part of one instalment: the debt outstanding on that date times
 * a month's worth of the rate in force then (`rateOnDate`, so a fixed-rate
 * period and its follow-up rate are both honoured).
 *
 * Returns 0 -- meaning "do not split" -- whenever the answer would be a guess:
 * no target account, a target that is not an interest-bearing liability, no
 * account data passed in, or a charge too small to even cover the interest. In
 * that last case the whole payment IS interest economically, but splitting it
 * into a zero repayment plus a full-size expense would make the debt look
 * serviced when it is not; leaving it whole keeps the books honest and the
 * schedule (which amortises negatively) shows the truth.
 */
function interestShare(
  contract: Contract,
  date: string,
  charge: number,
  byId: Map<string, Account> | null,
  balances?: AccountBalance[],
  movements?: AccountMovements,
): number {
  if (!contract.targetAccountId || !byId) return 0;
  const target = byId.get(contract.targetAccountId);
  if (!target?.isLiability) return 0;
  const steps = accountRateSteps(target);
  const annual = rateOnDate(target.interestRate ?? 0, steps, date);
  if (!Number.isFinite(annual) || annual <= 0) return 0;

  const outstanding = accountBalanceOn(target, balances ?? [], date, movements);
  if (!(outstanding > 0)) return 0;

  const interest = (outstanding * annual) / 100 / 12;
  if (!(interest > 0) || interest >= charge) return 0;
  return interest;
}
