"use client";

// The one adapter between the pure notification counters and the app's
// contexts. Both navigation renderers read it, so the sidebar and the mobile
// tab bar can never disagree about what is waiting.

import { useMemo } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useHousehold } from "@/lib/household/household-context";
import { useFeatureFlags, type FeatureFlag } from "@/lib/flags/flags-context";
import { today } from "@/lib/finance/dates";
import {
  collectNotifications,
  notificationsByRoute,
  totalNotifications,
  NOTIFICATION_KINDS,
  type NotificationItem,
  type NotificationKind,
} from "./notifications";

/** The flag each kind's surface lives behind. */
const KIND_FLAG: Record<NotificationKind, FeatureFlag> = {
  householdInvite: "household",
  savingsPlanDue: "savingsPlans",
  cashInterestDue: "cashInterest",
  contractDue: "contracts",
  plannedDue: "plannedCashflow",
  pensionPremiumDue: "pension",
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
  const todayIso = today();

  const available = useMemo(() => {
    const out = {} as Record<NotificationKind, boolean>;
    for (const kind of NOTIFICATION_KINDS) {
      const { enabled, locked } = getFeature(KIND_FLAG[kind]);
      out[kind] = enabled && !locked;
    }
    return out;
  }, [getFeature]);

  return useMemo(() => {
    const items = collectNotifications({
      today: todayIso,
      assets: data.assets,
      transactions: data.transactions,
      savingsPlans: data.savingsPlans,
      contracts: data.contracts,
      plannedCashflows: data.plannedCashflows,
      pensionContracts: data.pensionContracts,
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
    receivedInvites.length,
    available,
  ]);
}
