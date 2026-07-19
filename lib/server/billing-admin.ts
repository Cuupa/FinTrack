// Pure validation + normalization for POST /api/admin/billing bodies (round
// 2026-07-19b, Task B). Extracted the same way `resolveStripeKey` was pulled
// out of the credential-resolution flow in lib/server/billing-keys.ts: no
// other app/api/admin/** route in this codebase unit-tests its Supabase-
// dependent branches (see tests/require-admin.test.ts), so the testable
// surface is the validation/redaction logic, kept here and imported by
// app/api/admin/billing/route.ts.

import "server-only";

export interface BillingConfigInput {
  priceMonthly: string | null;
  priceYearly: string | null;
  enabled: boolean;
}

export interface BillingKeysInput {
  secretKey?: string | null;
  webhookSecret?: string | null;
}

/** Trims a string value; an empty (post-trim) string normalizes to null,
 *  same "empty means clear" rule as the site-config editor. `null` passes
 *  through unchanged. */
function normalizeOrNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Validates + normalizes a `{ kind: "config" }` body: `priceMonthly` /
 * `priceYearly` must each be a string or null (trimmed, empty -> null),
 * `enabled` must be a boolean. Returns null when the body doesn't match.
 */
export function parseBillingConfigBody(body: Record<string, unknown>): BillingConfigInput | null {
  const { priceMonthly, priceYearly, enabled } = body;
  if (
    (priceMonthly !== null && typeof priceMonthly !== "string") ||
    (priceYearly !== null && typeof priceYearly !== "string") ||
    typeof enabled !== "boolean"
  ) {
    return null;
  }
  return {
    priceMonthly: normalizeOrNull(priceMonthly),
    priceYearly: normalizeOrNull(priceYearly),
    enabled,
  };
}

/**
 * Validates + normalizes a `{ kind: "keys" }` body. Only fields actually
 * present on the body are validated and carried into the result (an omitted
 * field means "leave untouched" and must never appear in the returned
 * object, since the caller writes only the keys present here); a present
 * field must be a string or null, trimmed empty string treated the same as
 * null (both clear the stored value). Returns null when a present field has
 * the wrong type.
 */
export function parseBillingKeysBody(body: Record<string, unknown>): BillingKeysInput | null {
  const result: BillingKeysInput = {};
  if ("secretKey" in body) {
    const value = body.secretKey;
    if (value !== null && typeof value !== "string") return null;
    result.secretKey = normalizeOrNull(value);
  }
  if ("webhookSecret" in body) {
    const value = body.webhookSecret;
    if (value !== null && typeof value !== "string") return null;
    result.webhookSecret = normalizeOrNull(value);
  }
  return result;
}

/**
 * Redacts a validated keys input for the audit trail: "set"/"cleared" per
 * touched field only, never the value itself (ledger architecture decision:
 * "audit records set/cleared only, never the value"). Fields absent from
 * `input` (untouched) are absent from the result too.
 */
export function redactKeysForAudit(input: BillingKeysInput): Record<string, "set" | "cleared"> {
  const out: Record<string, "set" | "cleared"> = {};
  if ("secretKey" in input) out.secretKey = input.secretKey ? "set" : "cleared";
  if ("webhookSecret" in input) out.webhookSecret = input.webhookSecret ? "set" : "cleared";
  return out;
}
