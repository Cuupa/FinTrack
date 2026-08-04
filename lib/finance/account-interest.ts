import type { Account, AccountBalance, InterestFrequency, SpendingTransaction } from "../types";
import { addMonthsToDate, today as todayDate } from "./dates";
import { accountBalanceOn } from "./accounts";
import type { AccountMovements } from "./account-ledger";

export const MAX_ACCOUNT_INTEREST_DUE = 60;

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
  const rate = account.interestRate ?? 0;
  const periods = PERIOD_MONTHS[account.interestFrequency ?? "MONTHLY"];
  const balance = accountBalanceOn(account, balances, date, movements);
  if (!Number.isFinite(rate) || rate <= 0 || balance <= 0) return 0;
  const amount = Math.round(balance * (rate / 100) * (periods / 12) * 100) / 100;
  return account.isLiability ? -amount : amount;
}

export function dueAccountInterest(
  account: Account,
  transactions: readonly SpendingTransaction[],
  balances: AccountBalance[],
  movements: AccountMovements | undefined,
  asOf = todayDate(),
): DueAccountInterest[] {
  if (!account.interestRate || account.interestRate <= 0) return [];
  const lastBooked = transactions
    .filter((tx) => tx.interestAccountId === account.id)
    .reduce<string | null>((last, tx) => (!last || tx.date > last ? tx.date : last), null);
  const out: DueAccountInterest[] = [];
  for (let occurrence = 1; out.length < MAX_ACCOUNT_INTEREST_DUE; occurrence++) {
    const date = accountInterestDate(account, occurrence);
    if (date > asOf) break;
    if (lastBooked && date <= lastBooked) continue;
    const amount = accountInterestAmount(account, date, balances, movements);
    if (amount !== 0) out.push({ accountId: account.id, date, amount });
  }
  return out;
}

export function nextAccountInterestDate(
  account: Account,
  transactions: readonly SpendingTransaction[],
  asOf = todayDate(),
): string | null {
  if (!account.interestRate || account.interestRate <= 0) return null;
  const lastBooked = transactions
    .filter((tx) => tx.interestAccountId === account.id)
    .reduce<string | null>((last, tx) => (!last || tx.date > last ? tx.date : last), null);
  for (let occurrence = 1; occurrence < 1000; occurrence++) {
    const date = accountInterestDate(account, occurrence);
    if (date >= asOf && (!lastBooked || date > lastBooked)) return date;
  }
  return null;
}
