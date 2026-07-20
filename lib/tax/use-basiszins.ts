"use client";

// Public read of the `basiszins` reference table (year -> rate) for the
// Vorabpauschale estimate (COMPETITION.md F6). The rows are world-readable
// (RLS "basiszins readable", `select using (true)`), so this queries them
// directly via the browser Supabase client -- same "getSupabaseClient + one
// query" shape as `useBillingConfig` -- rather than adding an API route.
// No Supabase configured (local dev without keys) resolves to an empty map
// without touching the network, so the estimate simply doesn't appear.

import { useEffect, useState } from "react";
import { getSupabaseClient, isSupabaseConfigured } from "../supabase/client";

interface BasiszinsRow {
  year: number;
  rate: number;
}

/** Basiszins per year as a decimal fraction (0.0255 for 2.55%), keyed by the
 *  year as a string to line up with the tax report's year buckets. */
export function useBasiszins(): Record<string, number> {
  const [rates, setRates] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let active = true;
    supabase
      .from("basiszins")
      .select("year, rate")
      .then(({ data }) => {
        if (!active || !data) return;
        const out: Record<string, number> = {};
        for (const row of data as BasiszinsRow[]) {
          if (typeof row.year === "number" && typeof row.rate === "number") {
            out[String(row.year)] = row.rate;
          }
        }
        setRates(out);
      });
    return () => {
      active = false;
    };
  }, []);

  return rates;
}
