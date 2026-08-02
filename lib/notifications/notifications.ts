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

import type { Asset, Contract, PlannedCashflow, SavingsPlan, Transaction } from "../types";
import { dueOccurrences } from "../finance/savings-plans";
import { dueBookings } from "../finance/contract-bookings";
import { duePlannedDates } from "../finance/planned";
import { dueInterest } from "../finance/cash-interest";

export type NotificationKind =
  | "householdInvite"
  | "savingsPlanDue"
  | "cashInterestDue"
  | "contractDue"
  | "plannedDue";

export const NOTIFICATION_KINDS: NotificationKind[] = [
  "householdInvite",
  "savingsPlanDue",
  "cashInterestDue",
  "contractDue",
  "plannedDue",
];

/**
 * Where each kind is acted on. Cash interest is reviewed on an asset's detail
 * page, which is not a nav entry of its own — `/portfolio` is the table that
 * page is reached from, so that is where its count belongs.
 */
export const NOTIFICATION_ROUTES: Record<NotificationKind, string> = {
  householdInvite: "/household",
  savingsPlanDue: "/portfolio",
  cashInterestDue: "/portfolio",
  contractDue: "/accounts",
  plannedDue: "/accounts",
};

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
    contractDue: countContractDue(input),
    plannedDue: countPlannedDue(input),
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

function countContractDue(input: NotificationInput): number {
  if (!input.available.contractDue) return 0;
  let total = 0;
  for (const contract of input.contracts) total += dueBookings(contract, input.today).length;
  return total;
}

function countPlannedDue(input: NotificationInput): number {
  if (!input.available.plannedDue) return 0;
  let total = 0;
  for (const plan of input.plannedCashflows) total += duePlannedDates(plan, input.today).length;
  return total;
}
