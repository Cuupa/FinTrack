// Pure per-flag resolution (MONETIZATION.md section 4). No React, no
// Supabase — lib/flags/flags-context.tsx is the only caller, so the
// resolution order is unit-testable in isolation from the provider's
// fetch/effect plumbing.

import type { Plan } from "../billing/plan";

export interface FeatureState {
  enabled: boolean;
  locked: boolean;
}

/**
 * Resolution order (must match exactly, MONETIZATION.md section 4):
 * 1. No Supabase (Guest/dev deploys) -> on, unlocked. There is no database
 *    to gate against, so every feature stays on and free.
 * 2. Globals haven't loaded yet -> off, unlocked (no enabled-flash; existing
 *    behavior predates the plan layer).
 * 3. A per-user override exists -> wins outright, unlocked. This doubles as
 *    the Pro-grant mechanism: an override of `true` unlocks a Pro feature
 *    for that user regardless of plan.
 * 4. No global row, or the global is disabled -> off, unlocked (kill switch
 *    / closed default).
 * 5. The global requires Pro and the user's plan is free -> on but locked
 *    (visible teaser, not functional).
 * 6. Otherwise -> on, unlocked. An unknown/missing `requiredPlan` counts as
 *    'free' so a prod DB that predates the migration behaves exactly as
 *    today.
 */
export function resolveFeature(
  global: { enabled: boolean; requiredPlan: string } | undefined,
  override: boolean | undefined,
  plan: Plan,
  supabaseConfigured: boolean,
  globalsLoaded: boolean,
): FeatureState {
  if (!supabaseConfigured) return { enabled: true, locked: false };
  if (!globalsLoaded) return { enabled: false, locked: false };
  if (override !== undefined) return { enabled: override, locked: false };
  if (!global || !global.enabled) return { enabled: false, locked: false };
  if (global.requiredPlan === "pro" && plan === "free") {
    return { enabled: true, locked: true };
  }
  return { enabled: true, locked: false };
}
