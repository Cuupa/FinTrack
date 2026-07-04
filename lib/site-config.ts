"use client";

// Public, world-readable operator identity for the legal pages (/impressum,
// /datenschutz), read from `site_config` (see
// supabase/migrations/0033_site_config.sql) instead of being hardcoded. Same
// spirit as feature_flags: the owner fills it in via SQL/dashboard only.
//
// A key that's missing, still empty, or hasn't loaded yet resolves to
// `undefined` here — callers render their existing placeholder in that case,
// same as a flag row missing from the DB counts as disabled. Without
// Supabase configured (Guest/dev mode) there's no database to read, so this
// always resolves empty and the placeholders stay.

import { useEffect, useState } from "react";
import { getSupabaseClient } from "./supabase/client";

export type SiteConfigKey = "legal_name" | "legal_street" | "legal_city" | "legal_email";

type SiteConfigMap = Partial<Record<SiteConfigKey, string>>;

/** Loads the operator-identity keys from `site_config` once, client-side. */
export function useSiteConfig(): SiteConfigMap {
  const [config, setConfig] = useState<SiteConfigMap>({});

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let active = true;
    supabase
      .from("site_config")
      .select("key, value")
      .then(({ data }) => {
        if (!active) return;
        const map: SiteConfigMap = {};
        for (const row of (data ?? []) as { key: string; value: string }[]) {
          if (row.value) map[row.key as SiteConfigKey] = row.value;
        }
        setConfig(map);
      });
    return () => {
      active = false;
    };
  }, []);

  return config;
}
