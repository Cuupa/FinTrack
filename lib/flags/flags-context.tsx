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
//
// Plan layer (MONETIZATION.md section 4, supabase/migrations/0065_plan_gating.sql):
// each global row additionally carries `required_plan` ('free' | 'pro'). The
// pure resolution order (no Supabase -> globals not loaded -> override ->
// kill switch -> pro-required-and-free -> on) lives in `lib/flags/resolve.ts`
// (`resolveFeature`) so it is unit-testable without the fetch/effect
// plumbing here; this provider just wires the DB rows and `usePlan()`
// (lib/billing/use-plan.ts) into it. `useFeatureFlag(flag)` keeps its
// existing boolean contract (`enabled && !locked`) so none of the ~40
// existing call sites need to change; surfaces that want to show a Pro
// upsell teaser instead of hiding adopt the new `useFeature(flag)` hook,
// which also exposes `locked`. As of Phase 2 every flag is still seeded
// 'free' (dark launch) so `locked` is never actually true yet.

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
import { usePlan } from "../billing/use-plan";
import { resolveFeature, type FeatureState } from "./resolve";

export type { FeatureState };

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
  | "exportJson"
  | "errorLogging"
  | "llmChat";

const SIMULATION_SUBFLAGS: readonly FeatureFlag[] = [
  "simulationPortfolio",
  "simulationCustom",
  "simulationWithdrawal",
];

interface GlobalFlagState {
  enabled: boolean;
  requiredPlan: string;
}

type GlobalMap = Partial<Record<string, GlobalFlagState>>;
type OverrideMap = Partial<Record<string, boolean>>;

interface FeatureFlagsValue {
  /** True once global flags (and the signed-in user's overrides) loaded. */
  ready: boolean;
  isEnabled(flag: FeatureFlag): boolean;
  getFeature(flag: FeatureFlag): FeatureState;
}

const OPEN_FEATURE: FeatureState = { enabled: true, locked: false };
const CLOSED_FEATURE: FeatureState = { enabled: false, locked: false };

const FeatureFlagsContext = createContext<FeatureFlagsValue>({
  ready: !isSupabaseConfigured,
  isEnabled: () => !isSupabaseConfigured,
  getFeature: () => (isSupabaseConfigured ? CLOSED_FEATURE : OPEN_FEATURE),
});

export function FeatureFlagsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const plan = usePlan();
  const [globals, setGlobals] = useState<GlobalMap | null>(null);
  // Overrides are tagged with the user they belong to so a sign-out needs no
  // state reset in an effect — the derivation below just stops matching.
  const [overrides, setOverrides] = useState<{ userId: string; flags: OverrideMap } | null>(
    null,
  );

  useEffect(() => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let active = true;
    supabase
      .from("feature_flags")
      .select("*")
      .then(({ data }) => {
        if (!active) return;
        const map: GlobalMap = {};
        for (const row of (data ?? []) as Record<string, unknown>[]) {
          const flag = row.flag;
          if (typeof flag !== "string") continue;
          // Defensive reads: a DB that lags the 0065_plan_gating migration
          // has no `required_plan` column, so it comes back `undefined` —
          // resolveFeature treats a missing/unknown value as 'free'.
          map[flag] = {
            enabled: row.enabled === true,
            requiredPlan: typeof row.required_plan === "string" ? row.required_plan : "free",
          };
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
        const map: OverrideMap = {};
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
  const globalsLoaded = globals != null;

  const resolveFlag = useCallback(
    (flag: FeatureFlag): FeatureState =>
      resolveFeature(
        globals?.[flag],
        userFlags?.[flag],
        plan,
        isSupabaseConfigured,
        globalsLoaded,
      ),
    [globals, userFlags, plan, globalsLoaded],
  );

  const getFeature = useCallback(
    (flag: FeatureFlag): FeatureState => {
      // A sub-feature of the simulation is only available if the simulation
      // itself resolves to enabled-and-unlocked.
      if (SIMULATION_SUBFLAGS.includes(flag)) {
        const parent = resolveFlag("simulation");
        if (!parent.enabled || parent.locked) return CLOSED_FEATURE;
      }
      return resolveFlag(flag);
    },
    [resolveFlag],
  );

  const isEnabled = useCallback(
    (flag: FeatureFlag): boolean => {
      const feature = getFeature(flag);
      return feature.enabled && !feature.locked;
    },
    [getFeature],
  );

  const ready = !isSupabaseConfigured || (globals != null && (!userId || userFlags != null));
  const value = useMemo(
    () => ({ ready, isEnabled, getFeature }),
    [ready, isEnabled, getFeature],
  );

  return <FeatureFlagsContext.Provider value={value}>{children}</FeatureFlagsContext.Provider>;
}

export function useFeatureFlags(): FeatureFlagsValue {
  return useContext(FeatureFlagsContext);
}

/** Whether a feature is enabled for the current user (override > global > off; no Supabase > on). */
export function useFeatureFlag(flag: FeatureFlag): boolean {
  return useFeatureFlags().isEnabled(flag);
}

/** Full resolution for a feature, including the Pro-locked teaser state. */
export function useFeature(flag: FeatureFlag): FeatureState {
  return useFeatureFlags().getFeature(flag);
}
