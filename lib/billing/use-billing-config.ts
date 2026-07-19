"use client";

// Public read of `billing_config` for the /pricing marketing page
// (MONETIZATION.md Phase 3). The row is world-readable (RLS "billing config
// readable" policy, `select using (true)`), so this queries it directly via
// the browser Supabase client -- same "getSupabaseClient + one query" shape
// as `fetchSubscription` in lib/billing/billing-context.tsx -- rather than
// adding a new API route. No Supabase configured (local dev without
// Supabase keys) resolves to "nothing loaded" without ever touching the
// network, same default the rest of the billing seam uses.

import { useEffect, useState } from "react";
import { getSupabaseClient, isSupabaseConfigured } from "../supabase/client";

export interface BillingConfigPublic {
  priceMonthlyDisplay: string | null;
  priceYearlyDisplay: string | null;
  /** The owner's selling toggle -- independent of the `billing` flag itself
   *  (a flag-on, selling-off state shows the comparison without a buy
   *  button). */
  enabled: boolean;
}

interface BillingConfigRow {
  price_monthly_display: string | null;
  price_yearly_display: string | null;
  enabled: boolean;
}

async function fetchBillingConfig(): Promise<BillingConfigPublic> {
  const supabase = getSupabaseClient();
  if (!supabase) return { priceMonthlyDisplay: null, priceYearlyDisplay: null, enabled: false };
  const { data } = await supabase
    .from("billing_config")
    .select("price_monthly_display, price_yearly_display, enabled")
    .eq("id", 1)
    .maybeSingle<BillingConfigRow>();
  return {
    priceMonthlyDisplay: data?.price_monthly_display ?? null,
    priceYearlyDisplay: data?.price_yearly_display ?? null,
    enabled: data?.enabled === true,
  };
}

export function useBillingConfig(): { config: BillingConfigPublic | null; loading: boolean } {
  const [config, setConfig] = useState<BillingConfigPublic | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    fetchBillingConfig().then((result) => {
      if (!active) return;
      setConfig(result);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return { config, loading };
}
