// Pure quantity-limit resolution (MONETIZATION.md Phase 4, section 4:
// "Limits: usePlanLimit(key) reads plan_limits by plan; add-surfaces ...
// disable + teaser at cap"). No React, no Supabase — the loading side
// (lib/flags/flags-context.tsx, which already loads the sibling
// world-readable `feature_flags` table and already consumes usePlan()) is
// the only caller, so the resolution + grandfathering rules are
// unit-testable in isolation, same split as lib/flags/resolve.ts.

import type { Plan } from "./plan";

/** `plan_limits.limit_key` values (migration 0065_plan_gating.sql). */
export type LimitKey = "watchlistItems" | "savingsPlans" | "portfolios";

export const LIMIT_KEYS: readonly LimitKey[] = ["watchlistItems", "savingsPlans", "portfolios"];

/** A `plan_limits` row as read off the wire — `freeValue`/`proValue` are
 *  `unknown` on purpose: a DB value is trusted Postgres `integer | null`, but
 *  a lagging migration or a hand-edited row could hand back anything, and
 *  `resolveLimit` must fail open (null = unlimited) rather than throw. */
export interface PlanLimitRow {
  limitKey: string;
  freeValue: unknown;
  proValue: unknown;
}

function normalizeLimitValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  return value < 0 ? null : value;
}

/**
 * Resolves the quantity cap for `key` under `plan`. Missing row, missing
 * key, or a malformed stored value (non-integer, negative, wrong type) all
 * resolve to `null` (unlimited) — the same fail-open default as a lagging
 * migration or no Supabase at all, so a bad row can only ever be too
 * permissive, never accidentally lock a user out.
 */
export function resolveLimit(rows: PlanLimitRow[], key: LimitKey, plan: Plan): number | null {
  const row = rows.find((r) => r.limitKey === key);
  if (!row) return null;
  return normalizeLimitValue(plan === "pro" ? row.proValue : row.freeValue);
}

/**
 * Whether adding one more would exceed `limit`. `null` (unlimited) is never
 * at-limit. This is the grandfathering rule (MONETIZATION.md section 2):
 * a user already over the cap (`currentCount > limit`, e.g. after a
 * downgrade) still reads `true` here — blocking further ADDS — but existing
 * rows are never hidden or disabled by this function; callers only gate the
 * add action, never the read/write of what's already there.
 */
export function atLimit(limit: number | null, currentCount: number): boolean {
  return limit != null && currentCount >= limit;
}
