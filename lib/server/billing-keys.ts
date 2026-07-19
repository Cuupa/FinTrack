// Stripe credential resolution (MONETIZATION.md Phase 2, round 2026-07-19b).
// The owner can now set the Stripe secret key + webhook secret at runtime
// from /admin/billing; they live in `app_settings` (id=1, RLS enabled, zero
// policies — only the service role reaches them, see migration 0067). Every
// caller that used to read `process.env.STRIPE_SECRET_KEY` /
// `STRIPE_WEBHOOK_SECRET` directly now goes through `getStripeKeys()` so the
// DB value wins when set and the env var stays as the fallback (existing
// env-only deploys keep working unchanged).
//
// `resolveStripeKey` is the pure precedence rule, exported separately so
// tests exercise it without a Supabase mock (repo convention).

import "server-only";
import { supabaseSecret } from "./supabase-keys";

export interface StripeKeys {
  secretKey: string | null;
  webhookSecret: string | null;
}

interface AppSettingsBillingRow {
  stripe_secret_key: string | null;
  stripe_webhook_secret: string | null;
}

/**
 * A DB value wins when it is a non-empty (post-trim) string; otherwise fall
 * back to the env var, or null if that is unset too. A non-string DB value
 * (e.g. the column doesn't exist yet on a lagging deploy, or a stray type)
 * is treated the same as "unset" -> env fallback.
 */
export function resolveStripeKey(dbValue: unknown, envValue: string | undefined): string | null {
  if (typeof dbValue === "string" && dbValue.trim() !== "") return dbValue;
  return envValue && envValue.trim() !== "" ? envValue : null;
}

/**
 * Resolve both Stripe credentials for this request. Reads `app_settings`
 * once via the service-role client; a missing Supabase config or a DB error
 * falls back to env for both keys (never throws).
 */
export async function getStripeKeys(): Promise<StripeKeys> {
  const envSecretKey = process.env.STRIPE_SECRET_KEY;
  const envWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  const admin = supabaseSecret();
  if (!admin) {
    return {
      secretKey: resolveStripeKey(undefined, envSecretKey),
      webhookSecret: resolveStripeKey(undefined, envWebhookSecret),
    };
  }

  const { data, error } = await admin
    .from("app_settings")
    .select("stripe_secret_key, stripe_webhook_secret")
    .eq("id", 1)
    .maybeSingle<AppSettingsBillingRow>();

  if (error || !data) {
    return {
      secretKey: resolveStripeKey(undefined, envSecretKey),
      webhookSecret: resolveStripeKey(undefined, envWebhookSecret),
    };
  }

  return {
    secretKey: resolveStripeKey(data.stripe_secret_key, envSecretKey),
    webhookSecret: resolveStripeKey(data.stripe_webhook_secret, envWebhookSecret),
  };
}
