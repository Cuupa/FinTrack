"use client";

// Client billing state (MONETIZATION.md section 3, Phase 1). Loads the
// signed-in user's own `subscriptions` row AND `plan_grants` rows
// ("gratitude premium", migration 0068, select-own RLS) once per user and
// derives the `Plan` via `resolvePlan` (lib/billing/plan.ts). Guests and
// no-Supabase deploys never have a row, so they resolve `{ subscription:
// null, grants: [], loading: false, plan: "free" }` without ever touching
// the network.
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
import { resolvePlan, type Plan, type PlanGrant } from "./plan";
import type { SubscriptionRow } from "./subscription-view";

// Stable reference so the no-grants case doesn't create a new array (and
// thus a new useMemo dependency) on every render.
const NO_GRANTS: PlanGrant[] = [];

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

interface PlanGrantQueryRow {
  plan: string;
  expires_at: string | null;
}

async function fetchGrants(userId: string): Promise<PlanGrant[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from("plan_grants")
    .select("plan, expires_at")
    .eq("user_id", userId)
    .returns<PlanGrantQueryRow[]>();
  return (data ?? []).map((row) => ({ plan: row.plan, expiresAt: row.expires_at }));
}

interface BillingContextValue {
  plan: Plan;
  subscription: SubscriptionRow | null;
  grants: PlanGrant[];
  loading: boolean;
  refresh(): Promise<void>;
}

const BillingContext = createContext<BillingContextValue>({
  plan: "free",
  subscription: null,
  grants: [],
  loading: false,
  refresh: async () => {},
});

/** The last successfully loaded row(s), tagged with the user they belong to. */
interface LoadedState {
  userId: string;
  subscription: SubscriptionRow | null;
  grants: PlanGrant[];
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
    Promise.all([fetchSubscription(userId), fetchGrants(userId)]).then(([subscription, grants]) => {
      if (!active) return;
      setLoaded({ userId, subscription, grants });
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      if (params.get("billing") !== "success") return;
      // Stripe's webhook can lag the Checkout redirect by a moment; give it
      // a beat, then re-fetch once more so the settings card doesn't need a
      // manual reload to show the new plan.
      window.setTimeout(() => {
        if (!active) return;
        Promise.all([fetchSubscription(userId), fetchGrants(userId)]).then(
          ([retriedSubscription, retriedGrants]) => {
            if (active) setLoaded({ userId, subscription: retriedSubscription, grants: retriedGrants });
          },
        );
      }, 1500);
    });
    return () => {
      active = false;
    };
  }, [userId]);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const [subscription, grants] = await Promise.all([fetchSubscription(userId), fetchGrants(userId)]);
    setLoaded({ userId, subscription, grants });
  }, [userId]);

  const subscription = loaded?.userId === userId ? loaded.subscription : null;
  const grants = loaded?.userId === userId ? loaded.grants : NO_GRANTS;
  const loading = userId != null && isSupabaseConfigured && loaded?.userId !== userId;
  const plan = resolvePlan(
    subscription ? { status: subscription.status, currentPeriodEnd: subscription.currentPeriodEnd } : null,
    new Date().toISOString(),
    grants,
  );

  const value = useMemo<BillingContextValue>(
    () => ({ plan, subscription, grants, loading, refresh }),
    [plan, subscription, grants, loading, refresh],
  );

  return <BillingContext.Provider value={value}>{children}</BillingContext.Provider>;
}

export function useBilling(): BillingContextValue {
  return useContext(BillingContext);
}
