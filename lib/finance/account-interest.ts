import type { Account, AccountBalance, InterestFrequency, SpendingTransaction } from "../types";
import { addMonthsToDate, today as todayDate } from "./dates";
import { accountBalanceOn } from "./accounts";
import { accountRateSteps, rateOnDate } from "./debt";
import type { AccountMovements } from "./account-ledger";

/** Spin guard only (100 years of monthly periods). The real bound is `asOf`:
 *  a fixed occurrence cap would stop the search short of today on an old
 *  account and date the booking years into the past. */
const MAX_PERIODS = 1200;

const PERIOD_MONTHS: Record<InterestFrequency, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  ANNUAL: 12,
};

export interface DueAccountInterest {
  accountId: string;
  date: string;
  amount: number;
}

export function accountInterestDate(account: Account, occurrence: number): string {
  return addMonthsToDate(account.openedOn, PERIOD_MONTHS[account.interestFrequency ?? "MONTHLY"] * occurrence);
}

export function accountInterestAmount(
  account: Account,
  date: string,
  balances: AccountBalance[],
  movements?: AccountMovements,
): number {
  // The rate in force on the booking date, not today's: a fixed-rate period
  // that has run out charges the agreed follow-up rate (owner rule).
  const rate = rateOnDate(account.interestRate ?? 0, accountRateSteps(account), date);
  const periods = PERIOD_MONTHS[account.interestFrequency ?? "MONTHLY"];
  const balance = accountBalanceOn(account, balances, date, movements);
  if (!Number.isFinite(rate) || rate <= 0 || balance <= 0) return 0;
  const amount = Math.round(balance * (rate / 100) * (periods / 12) * 100) / 100;
  return account.isLiability ? -amount : amount;
}

/** Newest occurrence already settled: booked or explicitly skipped. Both close
 *  an occurrence, so the search resumes after whichever is later. */
function interestCursor(
  account: Account,
  transactions: readonly SpendingTransaction[],
): string | null {
  const lastBooked = transactions
    .filter((tx) => tx.interestAccountId === account.id)
    .reduce<string | null>((last, tx) => (!last || tx.date > last ? tx.date : last), null);
  const skipped = account.interestSkippedUntil ?? null;
  if (!lastBooked) return skipped;
  if (!skipped) return lastBooked;
  return lastBooked > skipped ? lastBooked : skipped;
}

export function dueAccountInterest(
  account: Account,
  transactions: readonly SpendingTransaction[],
  balances: AccountBalance[],
  movements: AccountMovements | undefined,
  asOf = todayDate(),
): DueAccountInterest[] {
  if (!account.interestRate || account.interestRate <= 0) return [];
  const lastBooked = interestCursor(account, transactions);
  let candidate: string | null = null;
  for (let occurrence = 1; occurrence <= MAX_PERIODS; occurrence++) {
    const date = accountInterestDate(account, occurrence);
    // Interest is a newly introduced automatic recurring entry. Do not
    // backfill every anniversary since the account was opened; that would
    // turn one recurring row into dozens of unexpected bookings on first use.
    if (date > asOf) break;
    if (!lastBooked || date > lastBooked) candidate = date;
  }
  if (!candidate) return [];
  const amount = accountInterestAmount(account, candidate, balances, movements);
  return amount === 0 ? [] : [{ accountId: account.id, date: candidate, amount }];
}

export function nextAccountInterestDate(
  account: Account,
  transactions: readonly SpendingTransaction[],
  asOf = todayDate(),
): string | null {
  if (!account.interestRate || account.interestRate <= 0) return null;
  const lastBooked = interestCursor(account, transactions);
  for (let occurrence = 1; occurrence <= MAX_PERIODS; occurrence++) {
    const date = accountInterestDate(account, occurrence);
    if (date >= asOf && (!lastBooked || date > lastBooked)) return date;
  }
  return null;
}
