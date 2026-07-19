// Pure validation for POST /api/admin/site's `{ kind: "limits" }` branch
// (MONETIZATION.md Phase 4, /admin/site "Plan limits" card). Same shape as
// lib/server/billing-admin.ts: the Supabase-dependent branches of an
// app/api/admin/** route aren't unit-tested anywhere in this codebase (see
// tests/require-admin.test.ts), so the testable surface pulled out here is
// just body validation + normalization.

import "server-only";
import { LIMIT_KEYS, type LimitKey } from "../billing/limits";

export function isLimitKey(key: unknown): key is LimitKey {
  return typeof key === "string" && (LIMIT_KEYS as readonly string[]).includes(key);
}

export interface PlanLimitInput {
  limitKey: LimitKey;
  /** null = unlimited (empty input field on the admin page). */
  freeValue: number | null;
  proValue: number | null;
}

/** A present value must be `null` (unlimited) or a non-negative integer;
 *  anything else is invalid. Returns `undefined` as a distinct "invalid"
 *  sentinel so the caller can tell it apart from a legitimately parsed
 *  `null`. */
function normalizeLimitValue(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return undefined;
  return value;
}

/**
 * Validates + normalizes a `{ kind: "limits", limitKey, freeValue, proValue
 * }` body: `limitKey` must be one of the seeded `plan_limits` keys,
 * `freeValue`/`proValue` must each be `null` (unlimited) or a non-negative
 * integer. Returns null when the body doesn't match.
 */
export function parsePlanLimitBody(body: Record<string, unknown>): PlanLimitInput | null {
  const { limitKey, freeValue, proValue } = body;
  if (!isLimitKey(limitKey)) return null;
  const free = normalizeLimitValue(freeValue);
  const pro = normalizeLimitValue(proValue);
  if (free === undefined || pro === undefined) return null;
  return { limitKey, freeValue: free, proValue: pro };
}
