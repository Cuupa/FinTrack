"use client";

// Client billing state (MONETIZATION.md section 3, Phase 1). Loads the
// signed-in user's own `subscriptions` row (select-own RLS) once per user
// and derives the `Plan` via `resolvePlan` (lib/billing/plan.ts). Guests and
// no-Supabase deploys never have a row, so they resolve `{ subscription:
// null, loading: false, plan: "free" }` without ever touching the network.
//
// Mounted under AuthProvider and above FeatureFlagsProvider in
// components/providers.tsx, since flag resolution (lib/flags/resolve.ts)
// consumes `usePlan()` (lib/billing/use-plan.ts), a thin read of this
// context. `useFeatureFlag`/`useFeature` therefore only see the real plan
// once this provider has loaded — same "off/free until loaded" default the
// rest of the flag system already assumes.
//
// `loading` is derived from whether the loaded row's tagged user still
// matches the current one (same pattern as FeatureFlagsProvider's
// `overrides`), rather than a separate effect-driven flag — no synchronous
// setState in an effect body, only inside async continuations.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getSupabaseClient, isSupabaseConfigured } from "../supabase/client";
import { useAuth } from "../auth/auth-context";
import { resolvePlan, type Plan } from "./plan";
import type { SubscriptionRow } from "./subscription-view";

interface SubscriptionQueryRow {
  status: string;
  plan: string;
  price_id: string | null;
  current_period_end: string;
  cancel_at_period_end: boolean;
}

function fromRow(row: SubscriptionQueryRow): SubscriptionRow {
  return {
    status: row.status,
    plan: row.plan,
    priceId: row.price_id,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: row.cancel_at_period_end,
  };
}

async function fetchSubscription(userId: string): Promise<SubscriptionRow | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("subscriptions")
    .select("status, plan, price_id, current_period_end, cancel_at_period_end")
    .eq("user_id", userId)
    .maybeSingle<SubscriptionQueryRow>();
  return data ? fromRow(data) : null;
}

interface BillingContextValue {
  plan: Plan;
  subscription: SubscriptionRow | null;
  loading: boolean;
  refresh(): Promise<void>;
}

const BillingContext = createContext<BillingContextValue>({
  plan: "free",
  subscription: null,
  loading: false,
  refresh: async () => {},
});

/** The last successfully loaded row, tagged with the user it belongs to. */
interface LoadedState {
  userId: string;
  subscription: SubscriptionRow | null;
}

export function BillingProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [loaded, setLoaded] = useState<LoadedState | null>(null);

  // Fetch + setState both live inside the promise continuation (never
  // synchronously in the effect body) — same shape as AuthProvider's
  // `getSession().then(...)` and FeatureFlagsProvider's flag fetch. `load`
  // itself is a plain async function (not a useCallback closing over
  // setState) so calling it from `refresh` below is a separate, unrelated
  // call path, not a second effect-body invocation.
  useEffect(() => {
    if (!userId || !isSupabaseConfigured) return;
    let active = true;
    fetchSubscription(userId).then((subscription) => {
      if (!active) return;
      setLoaded({ userId, subscription });
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      if (params.get("billing") !== "success") return;
      // Stripe's webhook can lag the Checkout redirect by a moment; give it
      // a beat, then re-fetch once more so the settings card doesn't need a
      // manual reload to show the new plan.
      window.setTimeout(() => {
        if (!active) return;
        fetchSubscription(userId).then((retried) => {
          if (active) setLoaded({ userId, subscription: retried });
        });
      }, 1500);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const subscription = await fetchSubscription(userId);
    setLoaded({ userId, subscription });
  }, [userId]);

  const subscription = loaded?.userId === userId ? loaded.subscription : null;
  const loading = userId != null && isSupabaseConfigured && loaded?.userId !== userId;
  const plan = resolvePlan(
    subscription ? { status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd } : null,
    new Date().toISOString(),
  );

  const value = useMemo<BillingContextValue>(
    () => ({ plan, subscription, loading, refresh }),
    [plan, subscription, loading, refresh],
  );

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBilling(): BillingContextValue {
  return useContext(BillingContext);
}
