// Balance accounts & liabilities (ROADMAP item #1, flag `accounts`) — pure,
// no React, no lib/server imports. This is the one place net worth learns to
// go negative: an account contributes a *signed* value (assets add, liabilities
// subtract) that is folded into `netWorthSeries` (lib/finance/portfolio.ts).
//
// An account has an `openingBalance` at `openedOn` plus any number of dated
// `AccountBalance` readings, and since the ledger rework it is also moved by
// the spending transactions booked against it (`lib/finance/account-ledger.ts`).
// The two combine as **anchor + carry-forward**:
//
//   a reading is the truth (it is what the bank says) and RE-ANCHORS the
//   chain, discarding everything before it; from there the ledger's movements
//   carry the balance forward until the next reading.
//
// That ordering is what makes double counting impossible: a movement can only
// ever apply after the most recent anchor, so re-entering a balance silently
// corrects any drift. It is also why a reading dated the same day as a booking
// wins outright -- a statement balance for a day already contains that day's
// bookings.
//
// Balances are stored as native-currency magnitudes; the net-worth sign comes
// from `isLiability`, and FX conversion to the base currency uses the spot rate
// (like `summarizeHolding` — the base is per-user and dated FX drift is not
// modelled for a balance the user simply typed in).

import type { Account, AccountBalance } from "../types";
import { addDays } from "./dates";
import type { AccountMovements } from "./account-ledger";

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
 * The account's full balance series in ascending date order, native-currency
 * magnitudes (unsigned).
 *
 * Without `movements` this is exactly the old step series: the opening balance
 * at `openedOn` plus every reading, a reading on `openedOn` overriding the
 * opening value.
 *
 * With movements it additionally carries the balance forward between readings.
 * Interest is deliberately absent here: it must enter through a separate
 * spending booking, otherwise the displayed balance changes without a journal
 * entry and liability interest can be counted twice when a payment is split.
 */
export function balanceSeries(
  account: Account,
  balances: AccountBalance[],
  movements?: AccountMovements,
): Point[] {
  const moves = movements?.get(account.id) ?? [];
  // An account whose opening balance is 0 and whose first movement predates
  // `openedOn` was opened before the user says it was: the transfer that
  // funded it is dated earlier than the date they typed. Nothing is being
  // discarded there, so the chain starts at the ledger instead. The anchor
  // sits the day BEFORE that movement, not on it: an anchor wins outright on
  // its own date, so a 0 sharing the movement's date would swallow the very
  // money that established the account.
  const firstMoveDate = moves[0]?.date;
  const effectiveOpenedOn =
    account.openingBalance === 0 && firstMoveDate && firstMoveDate < account.openedOn
      ? addDays(firstMoveDate, -1)
      : account.openedOn;

  const anchors = new Map<string, number>();
  anchors.set(effectiveOpenedOn, account.openingBalance);
  for (const b of balances) {
    if (b.accountId !== account.id) continue;
    if (!Number.isFinite(b.balance)) continue;
    anchors.set(b.date, b.balance);
  }

  // Movements dated before the account existed have nothing to attach to.
  const deltas = new Map<string, number>();
  for (const m of moves) {
    if (m.date < effectiveOpenedOn) continue;
    deltas.set(m.date, (deltas.get(m.date) ?? 0) + m.delta);
  }

  if (deltas.size === 0) {
    // Nothing to carry forward and nothing to accrue: the historical step
    // series, unchanged.
    return [...anchors.entries()]
      .map(([date, balance]) => ({ date, balance }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  const dates = [...new Set([...anchors.keys(), ...deltas.keys()])].sort();

  const out: Point[] = [];
  let balance = 0;
  for (const date of dates) {
    const anchor = anchors.get(date);
    if (anchor !== undefined) {
      // A reading wins outright and re-anchors: a statement balance for a day
      // already includes that day's bookings and interest.
      balance = anchor;
    } else {
      balance += deltas.get(date) ?? 0;
    }
    out.push({ date, balance });
  }
  return out;
}

/** Carry-forward lookup inside an already-built series. */
function balanceAt(series: readonly Point[], isoDate: string): number {
  let ans = 0;
  for (const p of series) {
    if (p.date <= isoDate) ans = p.balance;
    else break;
  }
  return ans;
}

/**
 * Native-currency balance magnitude on `isoDate` (carry-forward). Returns 0
 * before the account was opened — it does not exist yet.
 */
export function accountBalanceOn(
  account: Account,
  balances: AccountBalance[],
  isoDate: string,
  movements?: AccountMovements,
): number {
  if (isoDate < account.openedOn) return 0;
  return balanceAt(balanceSeries(account, balances, movements), isoDate);
}

/**
 * The balance as it stands now: the latest reading carried forward by every
 * journal movement since. Interest is only reflected after it is booked.
 */
export function currentAccountBalance(
  account: Account,
  balances: AccountBalance[],
  movements?: AccountMovements,
  asOf?: string,
): number {
  const series = balanceSeries(account, balances, movements);
  if (!series.length) return account.openingBalance;
  if (asOf) return balanceAt(series, asOf);
  return series[series.length - 1].balance;
}

/** Spot native-currency -> base FX rate for one account (1 if unset/base).
 *  Exported for callers that need to convert a native-currency amount other
 *  than the balance itself (e.g. ROADMAP #9's debt minimum payment). */
export function accountFxRate(account: Account, v?: AccountValuation): number {
  if (!v) return 1;
  const cur = account.currency ?? v.base;
  if (!cur || cur === v.base) return 1;
  return v.fx?.[cur] ?? 1;
}

function rateFor(account: Account, v?: AccountValuation): number {
  return accountFxRate(account, v);
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
  movements?: AccountMovements,
): number {
  const magnitude = accountBalanceOn(account, balances, isoDate, movements) * rateFor(account, v);
  return account.isLiability ? -magnitude : magnitude;
}

/**
 * Net signed base-currency value of every account on `isoDate` — the amount
 * folded into net worth (assets minus liabilities).
 *
 * For many dates at once use {@link accountsValueSeries}: this rebuilds every
 * account's series per call, which is fine for a single date and quadratic
 * over a chart's worth of them.
 */
export function accountsValueOn(
  accounts: Account[],
  balances: AccountBalance[],
  isoDate: string,
  v?: AccountValuation,
  movements?: AccountMovements,
): number {
  let sum = 0;
  for (const a of accounts) sum += accountValueOn(a, balances, isoDate, v, movements);
  return sum;
}

/**
 * The net signed base-currency account value on each of `dates` (ascending),
 * building every account's series exactly once.
 *
 * This is the form `netWorthSeries` uses. Calling `accountsValueOn` per point
 * re-derived each account's whole series for every date on the chart, which
 * only stayed cheap while a series was a handful of typed readings; once the
 * ledger feeds it, a series is every booking the account ever saw.
 */
export function accountsValueSeries(
  accounts: Account[],
  balances: AccountBalance[],
  dates: readonly string[],
  v?: AccountValuation,
  movements?: AccountMovements,
): number[] {
  const out = new Array<number>(dates.length).fill(0);
  if (!dates.length) return out;

  for (const account of accounts) {
    const series = balanceSeries(account, balances, movements);
    const sign = account.isLiability ? -1 : 1;
    const fx = rateFor(account, v);
    // Both lists ascend, so one shared cursor walks them together.
    let cursor = 0;
    let balance = 0;
    for (let i = 0; i < dates.length; i++) {
      const date = dates[i];
      while (cursor < series.length && series[cursor].date <= date) {
        balance = series[cursor].balance;
        cursor++;
      }
      if (date < account.openedOn) continue;
      out[i] += sign * balance * fx;
    }
  }
  return out;
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
 * Current totals across all accounts, in the base currency: asset side,
 * liability side, and their net. Used by the Accounts surface and the
 * dashboard fold.
 */
export function accountsTotals(
  accounts: Account[],
  balances: AccountBalance[],
  v?: AccountValuation,
  movements?: AccountMovements,
  asOf?: string,
): AccountsTotals {
  let assets = 0;
  let liabilities = 0;
  for (const a of accounts) {
    const value = currentAccountBalance(a, balances, movements, asOf) * rateFor(a, v);
    if (a.isLiability) liabilities += value;
    else assets += value;
  }
  return { assets, liabilities, net: assets - liabilities };
}
