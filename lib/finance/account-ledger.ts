// Turning the spending ledger into account movements — pure, no React, no
// lib/server imports.
//
// Until now an account's balance was `openingBalance` plus the dated readings
// the user typed in, and nothing else: a contract could post a 450 EUR loan
// instalment every month and the loan's balance never moved. The account was a
// note with a number on it rather than an account.
//
// This module is the missing half. It derives, from the spending ledger, the
// movements that act on each account, and `lib/finance/accounts.ts` carries
// them forward from the most recent reading. The reading stays the truth (it
// is what the bank says) and re-anchors the chain, so a movement can never be
// counted twice: everything before a reading is discarded by definition.
//
// A transfer moves money on BOTH sides. `transferAccountId` already told the
// spending aggregations to ignore the row (money moved, not spent); here it
// also moves the receiving account, which is what makes a loan instalment
// actually retire debt and a policy premium actually build a balance.

import type { Account, SpendingTransaction } from "../types";

/**
 * One dated change to an account's native-currency balance MAGNITUDE (the
 * unsigned number the user sees; the net-worth sign comes from `isLiability`).
 *
 * Signing against the magnitude rather than the net-worth value keeps the
 * `isLiability` inversion in this one place: paying 50 EUR from a current
 * account and paying it on a credit card are the same transaction shape but
 * move the magnitude in opposite directions.
 */
export interface AccountMovement {
  accountId: string;
  /** YYYY-MM-DD. */
  date: string;
  /** Signed delta applied to the balance magnitude. */
  delta: number;
}

/** Movements grouped by account id, each list in ascending date order. */
export type AccountMovements = Map<string, AccountMovement[]>;

/**
 * Applies a signed cash effect (positive = money arriving) to an account's
 * magnitude. On an asset account the two coincide; on a liability, money
 * arriving retires debt and therefore SHRINKS the magnitude.
 */
function magnitudeDelta(account: Account | undefined, cashDelta: number): number {
  return account?.isLiability ? -cashDelta : cashDelta;
}

/**
 * Every movement the spending ledger implies, grouped by account.
 *
 * Each transaction moves its own account by its signed amount. When it also
 * carries a `transferAccountId`, the counter-booking lands on that account
 * with the opposite sign: the money left one place and arrived in another.
 *
 * Amounts are taken at face value in the target account's currency. A transfer
 * between accounts of DIFFERENT currencies is therefore approximate — the FX
 * context lives in the view layer (`accounts.ts` converts to base only at the
 * very end), and inventing a rate here would put a second, conflicting
 * conversion into the finance core. The user's next balance reading re-anchors
 * and corrects any drift.
 */
export function accountMovements(
  transactions: readonly SpendingTransaction[],
  accounts: readonly Account[],
): AccountMovements {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out: AccountMovements = new Map();

  const push = (accountId: string, date: string, delta: number) => {
    if (!delta) return;
    const list = out.get(accountId);
    if (list) list.push({ accountId, date, delta });
    else out.set(accountId, [{ accountId, date, delta }]);
  };

  for (const tx of transactions) {
    if (!Number.isFinite(tx.amount)) continue;
    push(tx.accountId, tx.date, magnitudeDelta(byId.get(tx.accountId), tx.amount));
    if (tx.transferAccountId && tx.transferAccountId !== tx.accountId) {
      push(
        tx.transferAccountId,
        tx.date,
        magnitudeDelta(byId.get(tx.transferAccountId), -tx.amount),
      );
    }
  }

  for (const list of out.values()) {
    list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }
  return out;
}

/**
 * Whether this account is carried forward from its readings at all.
 *
 * Only accounts the ledger actually touches are: an account with no movements
 * is one the user maintains purely by typing balances, and for it the old
 * step-series behaviour is exactly right. This also keeps interest accrual
 * (see `accounts.ts`) off accounts that merely carry a rate for the payoff
 * planner, so nobody's net worth shifts without them having booked anything.
 */
export function isLedgerDriven(accountId: string, movements?: AccountMovements): boolean {
  const list = movements?.get(accountId);
  return Boolean(list && list.length > 0);
}
