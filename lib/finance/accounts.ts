// Balance accounts & liabilities (ROADMAP item #1, flag `accounts`) — pure,
// no React, no lib/server imports. This is the one place net worth learns to
// go negative: an account contributes a *signed* value (assets add, liabilities
// subtract) that is folded into `netWorthSeries` (lib/finance/portfolio.ts).
//
// Each account has an `openingBalance` at `openedOn` plus any number of dated
// `AccountBalance` readings. Together they form a carry-forward step series:
// the balance on a date is the last reading at or before it, and before
// `openedOn` the account does not exist yet (contributes 0). Balances are
// stored as native-currency magnitudes; the net-worth sign comes from
// `isLiability`, and FX conversion to the base currency uses the spot rate
// (like `summarizeHolding` — the base is per-user and dated FX drift is not
// modelled for a balance the user simply typed in).

import type { Account, AccountBalance } from "../types";

/** Spot FX + base currency for converting native account balances. */
export interface AccountValuation {
  base: string;
  /** native currency -> base rate; the base itself is implicitly 1. */
  fx?: Record<string, number>;
}

interface Point {
  date: string;
  balance: number;
}

/**
 * The account's full balance series in ascending date order: the opening
 * balance at `openedOn` plus every reading, with a reading on `openedOn`
 * overriding the opening value. Native-currency magnitudes (unsigned).
 */
export function balanceSeries(account: Account, balances: AccountBalance[]): Point[] {
  const byDate = new Map<string, number>();
  byDate.set(account.openedOn, account.openingBalance);
  for (const b of balances) {
    if (b.accountId !== account.id) continue;
    if (!Number.isFinite(b.balance)) continue;
    byDate.set(b.date, b.balance);
  }
  return [...byDate.entries()]
    .map(([date, balance]) => ({ date, balance }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Native-currency balance magnitude on `isoDate` (carry-forward). Returns 0
 * before the account was opened — it does not exist yet.
 */
export function accountBalanceOn(
  account: Account,
  balances: AccountBalance[],
  isoDate: string,
): number {
  if (isoDate < account.openedOn) return 0;
  const series = balanceSeries(account, balances);
  let ans = 0;
  for (const p of series) {
    if (p.date <= isoDate) ans = p.balance;
    else break;
  }
  return ans;
}

/** Latest entered balance magnitude (native currency), or the opening balance
 *  when there are no readings. */
export function currentAccountBalance(account: Account, balances: AccountBalance[]): number {
  const series = balanceSeries(account, balances);
  return series.length ? series[series.length - 1].balance : account.openingBalance;
}

function rateFor(account: Account, v?: AccountValuation): number {
  if (!v) return 1;
  const cur = account.currency ?? v.base;
  if (!cur || cur === v.base) return 1;
  return v.fx?.[cur] ?? 1;
}

/**
 * Signed base-currency value of one account on `isoDate`: assets positive,
 * liabilities negative. 0 before the account was opened.
 */
export function accountValueOn(
  account: Account,
  balances: AccountBalance[],
  isoDate: string,
  v?: AccountValuation,
): number {
  const magnitude = accountBalanceOn(account, balances, isoDate) * rateFor(account, v);
  return account.isLiability ? -magnitude : magnitude;
}

/**
 * Net signed base-currency value of every account on `isoDate` — the amount
 * folded into net worth (assets minus liabilities).
 */
export function accountsValueOn(
  accounts: Account[],
  balances: AccountBalance[],
  isoDate: string,
  v?: AccountValuation,
): number {
  let sum = 0;
  for (const a of accounts) sum += accountValueOn(a, balances, isoDate, v);
  return sum;
}

export interface AccountsTotals {
  /** Sum of asset accounts' current balances (base currency, positive). */
  assets: number;
  /** Sum of liability accounts' current balances (base currency, positive). */
  liabilities: number;
  /** assets - liabilities (base currency, may be negative). */
  net: number;
}

/**
 * Current (latest-reading) totals across all accounts, in the base currency:
 * asset side, liability side, and their net. Used by the Accounts surface and
 * the dashboard fold.
 */
export function accountsTotals(
  accounts: Account[],
  balances: AccountBalance[],
  v?: AccountValuation,
): AccountsTotals {
  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    const value = currentAccountBalance(a, balances) * rateFor(a, v);
    if (a.isLiability) liabilities += value;
    else assets += value;
  }
  return { assets, liabilities, net: assets - liabilities };
}
