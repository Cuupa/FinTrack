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
 * 3. Visibility: a per-user override, when present, replaces the global
 *    `enabled` value for that user — both ways, so it can switch a feature on
 *    for a tester and off for a single user. With no override, a missing
 *    global row or a disabled one means off (kill switch / closed default).
 * 4. Not visible -> off, unlocked.
 * 5. Visible, the global requires Pro and the user's plan is free -> on but
 *    locked (visible teaser, not functional). The plan gate applies
 *    INDEPENDENTLY of the override (owner rule, 2026-07-26): a feature flag
 *    is an on/off + testing switch, never a Pro grant. Granting Pro to a
 *    single user is `plan_grants` (/admin/billing "Premium grants"), which
 *    lifts `plan` to 'pro' upstream of this function.
 * 6. Otherwise -> on, unlocked. An unknown/missing `requiredPlan` counts as
 *    'free' so a prod DB that predates the migration behaves exactly as
 *    today; so does an override on a flag with no global row at all (nothing
 *    declares it a Pro feature).
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
  const enabled = override ?? global?.enabled ?? false;
  if (!enabled) return { enabled: false, locked: false };
  if (global?.requiredPlan === "pro" && plan === "free") {
    return { enabled: true, locked: true };
  }
  return { enabled: true, locked: false };
}
