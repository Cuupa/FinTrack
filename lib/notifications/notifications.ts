// What is waiting for the user to act — pure, no React, no store access.
//
// Every counter here is derived from data the app already replays elsewhere:
// due savings-plan occurrences, due contract and planned-cashflow bookings,
// due cash interest, and household invitations addressed to this user. Nothing
// is stored; a notification disappears the moment the thing behind it is done,
// which is why there is no read/unread state to keep in sync.
//
// The rule that binds this module: only ACTIONABLE things count. A budget that
// is over, a stale price, a locked feature — none of those are a task the user
// can close, and a number that never goes down is noise within a week.

import type {
  Account,
  AccountBalance,
  Asset,
  Contract,
  PensionContract,
  PlannedCashflow,
  SavingsPlan,
  SpendingTransaction,
  Transaction,
} from "../types";
import { dueOccurrences } from "../finance/savings-plans";
import { dueBookings } from "../finance/contract-bookings";
import { duePlannedDates } from "../finance/planned";
import { duePremiums } from "../finance/pension-bookings";
import { dueInterest } from "../finance/cash-interest";
import { dueAccountInterest, interestIsAutomatic } from "../finance/account-interest";
import type { AccountMovements } from "../finance/account-ledger";

export type NotificationKind =
  | "householdInvite"
  | "savingsPlanDue"
  | "cashInterestDue"
  | "accountInterestDue"
  | "contractDue"
  | "plannedDue"
  | "pensionPremiumDue";

export const NOTIFICATION_KINDS: NotificationKind[] = [
  "householdInvite",
  "savingsPlanDue",
  "cashInterestDue",
  "accountInterestDue",
  "contractDue",
  "plannedDue",
  "pensionPremiumDue",
];

/**
 * Where each kind is acted on. Cash interest is reviewed on an asset's detail
 * page, which is not a nav entry of its own — `/portfolio` is the table that
 * page is reached from, so that is where its count belongs. Household invites
 * are accepted in Settings (household administration moved there, spec §13),
 * which the account/avatar menu opens — so `/settings` owns that count.
 */
export const NOTIFICATION_ROUTES: Record<NotificationKind, string> = {
  householdInvite: "/settings",
  savingsPlanDue: "/portfolio",
  cashInterestDue: "/portfolio",
  accountInterestDue: "/accounts",
  contractDue: "/accounts",
  plannedDue: "/accounts",
  pensionPremiumDue: "/retirement",
};

// Normally a Pro-locked kind is dropped: its review dialog sits behind the
// ProGate, so a count would point at a teaser the page can't honour. A received
// household invite is the exception -- accepting it is how you JOIN a household
// someone else pays for, so that card renders OUTSIDE the ProGate (see
// household-view.tsx) and stays actionable while the feature is locked. For
// these kinds only the flag's visibility gates the count, never the plan lock.
export const ACTIONABLE_WHILE_LOCKED: ReadonlySet<NotificationKind> = new Set<NotificationKind>([
  "householdInvite",
]);

/**
 * Which kinds may contribute, from each flag's `{enabled, locked}` state. A
 * kind needs every one of its flags visible; a plan lock additionally hides it
 * unless the kind's action survives the lock (`ACTIONABLE_WHILE_LOCKED`).
 * Generic over the flag string so the pure core never imports the flag registry.
 */
export function kindAvailability<F extends string>(
  kindFlags: Record<NotificationKind, readonly F[]>,
  resolve: (flag: F) => { enabled: boolean; locked: boolean },
): Record<NotificationKind, boolean> {
  const out = {} as Record<NotificationKind, boolean>;
  for (const kind of NOTIFICATION_KINDS) {
    const lockHides = !ACTIONABLE_WHILE_LOCKED.has(kind);
    out[kind] = kindFlags[kind].every((flag) => {
      const { enabled, locked } = resolve(flag);
      return enabled && (!lockHides || !locked);
    });
  }
  return out;
}

export interface NotificationItem {
  kind: NotificationKind;
  /** Always > 0 — a zero-count kind is dropped, never emitted. */
  count: number;
}

export interface NotificationInput {
  /** YYYY-MM-DD. */
  today: string;
  assets: readonly Asset[];
  transactions: readonly Transaction[];
  savingsPlans: readonly SavingsPlan[];
  contracts: readonly Contract[];
  plannedCashflows: readonly PlannedCashflow[];
  /** Balance accounts, for the interest they accrue or pay (flag `accounts`). */
  accounts: readonly Account[];
  accountBalances: readonly AccountBalance[];
  spendingTransactions: readonly SpendingTransaction[];
  /** Ledger movements, so the interest is computed off the same carried-forward
   *  balance the review list shows. */
  accountMovements?: AccountMovements;
  /** Retirement policies with a Verrechnungskonto (flag `pension`). */
  pensionContracts: readonly PensionContract[];
  /** Pending invitations addressed to this user's own email. */
  householdInvites: number;
  /**
   * Which kinds may contribute at all. A feature whose flag is off has no
   * surface to act on, and a Pro-locked one shows a teaser instead of the
   * review dialog — counting either would send the user to a page where the
   * task they were promised is not there.
   */
  available: Record<NotificationKind, boolean>;
}

/** Every kind with something waiting, in the fixed order above. */
export function collectNotifications(input: NotificationInput): NotificationItem[] {
  const counts: Record<NotificationKind, number> = {
    householdInvite: input.householdInvites,
    savingsPlanDue: countSavingsPlanDue(input),
    cashInterestDue: countCashInterestDue(input),
    accountInterestDue: countAccountInterestDue(input),
    contractDue: countContractDue(input),
    plannedDue: countPlannedDue(input),
    pensionPremiumDue: countPensionPremiumDue(input),
  };
  return NOTIFICATION_KINDS.filter((kind) => input.available[kind] && counts[kind] > 0).map(
    (kind) => ({ kind, count: counts[kind] }),
  );
}

/** Sums the items onto the nav route each one is acted on. */
export function notificationsByRoute(items: readonly NotificationItem[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const href = NOTIFICATION_ROUTES[item.kind];
    out[href] = (out[href] ?? 0) + item.count;
  }
  return out;
}

export function totalNotifications(items: readonly NotificationItem[]): number {
  return items.reduce((sum, item) => sum + item.count, 0);
}

function countSavingsPlanDue(input: NotificationInput): number {
  if (!input.available.savingsPlanDue) return 0;
  const assetIds = new Set(input.assets.map((a) => a.id));
  let total = 0;
  for (const plan of input.savingsPlans) {
    // Mirrors the review dialog: a plan whose asset is gone lists no rows.
    if (!assetIds.has(plan.assetId)) continue;
    total += dueOccurrences(plan, input.today).length;
  }
  return total;
}

function countCashInterestDue(input: NotificationInput): number {
  if (!input.available.cashInterestDue) return 0;
  const txs = input.transactions as Transaction[];
  let total = 0;
  for (const asset of input.assets) {
    if (asset.type !== "CASH") continue;
    total += dueInterest(asset, txs, input.today).length;
  }
  return total;
}

function countAccountInterestDue(input: NotificationInput): number {
  if (!input.available.accountInterestDue) return 0;
  const balances = input.accountBalances as AccountBalance[];
  let total = 0;
  for (const account of input.accounts) {
    // Automatic interest never waits for the user, so counting it would point
    // at a review list that does not hold it.
    if (interestIsAutomatic(account)) continue;
    total += dueAccountInterest(
      account,
      input.spendingTransactions,
      balances,
      input.accountMovements,
      input.today,
    ).length;
  }
  return total;
}

function countContractDue(input: NotificationInput): number {
  if (!input.available.contractDue) return 0;
  let total = 0;
  for (const contract of input.contracts) total += dueBookings(contract, input.today).length;
  return total;
}

function countPensionPremiumDue(input: NotificationInput): number {
  if (!input.available.pensionPremiumDue) return 0;
  let total = 0;
  for (const c of input.pensionContracts) total += duePremiums(c, input.today).length;
  return total;
}

function countPlannedDue(input: NotificationInput): number {
  if (!input.available.plannedDue) return 0;
  let total = 0;
  for (const plan of input.plannedCashflows) total += duePlannedDates(plan, input.today).length;
  return total;
}
