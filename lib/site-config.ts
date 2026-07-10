"use client";

// Public, world-readable operator identity for the legal pages (/impressum,
// /datenschutz), read from `site_config` (see
// supabase/migrations/0033_site_config.sql) instead of being hardcoded. Same
// spirit as feature_flags: the owner fills it in via SQL/dashboard only.
//
// A localStorage mirror (lib/site-config-cache.ts) removes the loading flash
// on repeat visits: useSyncExternalStore reads the cached map synchronously
// on the very first client render, then the Supabase fetch below still runs
// once in the background and updates the store + localStorage only when the
// payload actually differs.
//
// `loaded` tells callers whether the *current* fetch has settled: true right
// away when Supabase isn't configured (nothing will ever arrive - Guest/dev
// mode, the placeholders are correct operator to-dos), true once the fetch
// resolves (success or error). Callers use it to tell "still loading" (render
// nothing) apart from "loaded and genuinely empty" (render the placeholder);
// a cached value renders immediately either way, regardless of `loaded`.

import { useEffect, useState, useSyncExternalStore } from "react";
import { getSupabaseClient, isSupabaseConfigured } from "./supabase/client";
import { siteConfigStore, type SiteConfigKey, type SiteConfigMap } from "./site-config-cache";

export type { SiteConfigKey, SiteConfigMap };

/** Loads the operator-identity keys from `site_config`, painting a cached
 *  value immediately and revalidating once from Supabase in the background. */
export function useSiteConfig(): { config: SiteConfigMap; loaded: boolean } {
  const config = useSyncExternalStore(
    siteConfigStore.subscribe,
    siteConfigStore.getSnapshot,
    siteConfigStore.getServerSnapshot,
  );
  const [loaded, setLoaded] = useState(!isSupabaseConfigured);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let active = true;
    supabase
      .from("site_config")
      .select("key, value")
      .then(({ data, error }) => {
        if (!active) return;
        if (!error) {
          const map: SiteConfigMap = {};
          for (const row of (data ?? []) as { key: string; value: string }[]) {
            if (row.value) map[row.key as SiteConfigKey] = row.value;
          }
          siteConfigStore.update(map);
        }
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return { config, loaded };
}
