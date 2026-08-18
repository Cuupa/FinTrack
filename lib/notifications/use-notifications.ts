"use client";

// The one adapter between the pure notification counters and the app's
// contexts. Both navigation renderers read it, so the sidebar and the mobile
// tab bar can never disagree about what is waiting.

import { useMemo } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useHousehold } from "@/lib/household/household-context";
import { useAccountMovements } from "@/lib/accounts/use-account-movements";
import { useFeatureFlags, type FeatureFlag } from "@/lib/flags/flags-context";
import { today } from "@/lib/finance/dates";
import {
  collectNotifications,
  notificationsByRoute,
  totalNotifications,
  kindAvailability,
  type NotificationItem,
  type NotificationKind,
} from "./notifications";

/** The flags each kind's surface lives behind — all of them must be on, since
 *  a review list nested in another feature's page needs both to be reachable. */
const KIND_FLAGS: Record<NotificationKind, FeatureFlag[]> = {
  householdInvite: ["household"],
  savingsPlanDue: ["savingsPlans"],
  cashInterestDue: ["cashInterest"],
  // Reviewed in the recurring card, which /accounts renders through the
  // spending view.
  accountInterestDue: ["accounts", "spending"],
  contractDue: ["contracts"],
  plannedDue: ["plannedCashflow"],
  pensionPremiumDue: ["pension"],
};

export interface Notifications {
  items: NotificationItem[];
  /** Nav href -> how many things wait on that page. */
  byRoute: Record<string, number>;
  total: number;
}

export function useNotifications(): Notifications {
  const { data } = usePortfolio();
  const { receivedInvites } = useHousehold();
  const { getFeature } = useFeatureFlags();
  const movements = useAccountMovements();
  const todayIso = today();

  const available = useMemo(
    () => kindAvailability(KIND_FLAGS, getFeature),
    [getFeature],
  );

  return useMemo(() => {
    const items = collectNotifications({
      today: todayIso,
      assets: data.assets,
      transactions: data.transactions,
      savingsPlans: data.savingsPlans,
      contracts: data.contracts,
      plannedCashflows: data.plannedCashflows,
      pensionContracts: data.pensionContracts,
      accounts: data.accounts,
      accountBalances: data.accountBalances,
      spendingTransactions: data.spendingTransactions,
      accountMovements: movements,
      householdInvites: receivedInvites.length,
      available,
    });
    return { items, byRoute: notificationsByRoute(items), total: totalNotifications(items) };
  }, [
    todayIso,
    data.assets,
    data.transactions,
    data.savingsPlans,
    data.contracts,
    data.plannedCashflows,
    data.pensionContracts,
    data.accounts,
    data.accountBalances,
    data.spendingTransactions,
    movements,
    receivedInvites.length,
    available,
  ]);
}
