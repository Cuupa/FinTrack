"use client";

// Database-backed feature flags. Every feature has a global default in
// `feature_flags` (world-readable) and an optional per-user override in
// `user_feature_flags` (RLS: own rows), both maintained by the owner via
// SQL/dashboard — see supabase/migrations/0027_feature_flags.sql. Flags are
// closed by default: a feature is enabled only if the DB explicitly says so
// (override wins over global); a flag row missing from the DB counts as
// disabled, and so does a flag that hasn't loaded yet — no enabled-flash.
//
// Deliberate exception: without Supabase (Guest/dev mode) there is no
// database to return `true`, so every feature stays enabled — otherwise
// Guest Mode would lose every gated feature outright.

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

export type FeatureFlag =
  | "csvImport"
  | "risk"
  | "xray"
  | "rebalance"
  | "simulation"
  | "simulationPortfolio"
  | "simulationCustom"
  | "simulationWithdrawal"
  | "offline"
  | "estimated-badge"
  | "taxReport"
  | "watchlist"
  | "savingsPlans"
  | "dividends"
  | "historyCache"
  | "exportCsv"
  | "exportJson";

const SIMULATION_SUBFLAGS: readonly FeatureFlag[] = [
  "simulationPortfolio",
  "simulationCustom",
  "simulationWithdrawal",
];

type FlagMap = Partial<Record<string, boolean>>;

interface FeatureFlagsValue {
  /** True once global flags (and the signed-in user's overrides) loaded. */
  ready: boolean;
  isEnabled(flag: FeatureFlag): boolean;
}

const FeatureFlagsContext = createContext<FeatureFlagsValue>({
  ready: !isSupabaseConfigured,
  isEnabled: () => !isSupabaseConfigured,
});

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [globals, setGlobals] = useState<FlagMap | null>(null);
  // Overrides are tagged with the user they belong to so a sign-out needs no
  // state reset in an effect — the derivation below just stops matching.
  const [overrides, setOverrides] = useState<{ userId: string; flags: FlagMap } | null>(null);

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let active = true;
    supabase
      .from("feature_flags")
      .select("flag, enabled")
      .then(({ data }) => {
        if (!active) return;
        const map: FlagMap = {};
        for (const row of (data ?? []) as { flag: string; enabled: boolean }[]) {
          map[row.flag] = row.enabled;
        }
        setGlobals(map);
      });
    return () => {
      active = false;
    };
  }, []);

  const userId = user?.id ?? null;
  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase || !userId) return;
    let active = true;
    supabase
      .from("user_feature_flags")
      .select("flag, enabled")
      .eq("user_id", userId)
      .then(({ data }) => {
        if (!active) return;
        const map: FlagMap = {};
        for (const row of (data ?? []) as { flag: string; enabled: boolean }[]) {
          map[row.flag] = row.enabled;
        }
        setOverrides({ userId, flags: map });
      });
    return () => {
      active = false;
    };
  }, [userId]);

  const userFlags = userId && overrides?.userId === userId ? overrides.flags : null;

  const isEnabled = useCallback(
    (flag: FeatureFlag): boolean => {
      // No database to consult in Guest/dev mode — everything stays on.
      if (!isSupabaseConfigured) return true;
      // Globals haven't loaded yet: resolve closed (no enabled-flash), not
      // open-by-default.
      const resolve = (f: FeatureFlag) =>
        globals == null ? false : (userFlags?.[f] ?? globals[f] ?? false);
      // A sub-feature of the simulation is only available if the simulation is.
      if (SIMULATION_SUBFLAGS.includes(flag) && !resolve("simulation")) return false;
      return resolve(flag);
    },
    [globals, userFlags],
  );

  const ready = !isSupabaseConfigured || (globals != null && (!userId || userFlags != null));
  const value = useMemo(() => ({ ready, isEnabled }), [ready, isEnabled]);

  return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>;
}

export function useFeatureFlags(): FeatureFlagsValue {
  return useContext(FeatureFlagsContext);
}

/** Whether a feature is enabled for the current user (override > global > off; no Supabase > on). */
export function useFeatureFlag(flag: FeatureFlag): boolean {
  return useFeatureFlags().isEnabled(flag);
}
