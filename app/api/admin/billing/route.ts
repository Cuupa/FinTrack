// Admin billing config + Stripe keys editor backend (round 2026-07-19b, Task
// B), same shape as app/api/admin/site/route.ts: `billing_config` has a
// read-only-by-everyone RLS policy (owner writes only via the secret key,
// like site_config) while `app_settings.stripe_secret_key` /
// `stripe_webhook_secret` have RLS enabled with no policy at all (not even
// readable by the publishable key) — so an admin browsing/editing either
// needs the secret-key bypass.
//
// GET returns the current `billing_config` row plus presence-only booleans
// for the two Stripe secrets (never the values themselves — ledger
// architecture decision: "GET never echoes a stored secret").
//
// POST body is one of:
//   { kind: "config", priceMonthly, priceYearly, enabled }
//     upsert billing_config id=1. Price ids are not secrets, so the audit
//     row carries the full old/new values.
//   { kind: "keys", secretKey?, webhookSecret? }
//     set or clear app_settings.stripe_secret_key /
//     stripe_webhook_secret. A field omitted from the body is left
//     untouched; a present field that is an empty string or null clears the
//     column (null in DB). The audit row records only "set"/"cleared" per
//     touched field, never the value (same architecture decision as above).
// Each requires admin auth first, mutates via the secret client, and records
// an admin_audit row.

import { audit, requireAdmin } from "@/lib/server/require-admin";
import { supabaseSecret } from "@/lib/server/supabase-keys";
import {
  parseBillingConfigBody,
  parseBillingKeysBody,
  redactKeysForAudit,
} from "@/lib/server/billing-admin";

export const dynamic = "force-dynamic";

interface BillingConfigRow {
  price_monthly: string | null;
  price_yearly: string | null;
  enabled: boolean;
}

interface AppSettingsKeysRow {
  stripe_secret_key: string | null;
  stripe_webhook_secret: string | null;
}

function isSet(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

export async function GET(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const admin = supabaseSecret();
  if (!admin) return Response.json({ error: "admin not configured" }, { status: 503 });

  const [configRes, keysRes] = await Promise.all([
    admin
      .from("billing_config")
      .select("price_monthly, price_yearly, enabled")
      .eq("id", 1)
      .maybeSingle<BillingConfigRow>(),
    admin
      .from("app_settings")
      .select("stripe_secret_key, stripe_webhook_secret")
      .eq("id", 1)
      .maybeSingle<AppSettingsKeysRow>(),
  ]);
  if (configRes.error) return Response.json({ error: configRes.error.message }, { status: 500 });
  if (keysRes.error) return Response.json({ error: keysRes.error.message }, { status: 500 });

  return Response.json({
    priceMonthly: configRes.data?.price_monthly ?? null,
    priceYearly: configRes.data?.price_yearly ?? null,
    enabled: configRes.data?.enabled === true,
    secretKeySet: isSet(keysRes.data?.stripe_secret_key),
    webhookSecretSet: isSet(keysRes.data?.stripe_webhook_secret),
  });
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  // Same reasoning as app/api/admin/site/route.ts: read as an unknown-valued
  // record and validate per branch, rather than a discriminated union.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const body = (raw ?? {}) as Record<string, unknown>;

  const admin = supabaseSecret();
  if (!admin) return Response.json({ error: "admin not configured" }, { status: 503 });

  const actor = { userId: auth.userId, email: auth.email };

  if (body.kind === "config") {
    const parsed = parseBillingConfigBody(body);
    if (!parsed) return Response.json({ error: "invalid body" }, { status: 400 });

    const { data: before } = await admin
      .from("billing_config")
      .select("price_monthly, price_yearly, enabled")
      .eq("id", 1)
      .maybeSingle<BillingConfigRow>();

    const { error } = await admin.from("billing_config").upsert(
      {
        id: 1,
        price_monthly: parsed.priceMonthly,
        price_yearly: parsed.priceYearly,
        enabled: parsed.enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
    if (error) return Response.json({ error: error.message }, { status: 500 });

    await audit(
      actor,
      "billing.set_config",
      "billing_config",
      before
        ? {
            priceMonthly: before.price_monthly,
            priceYearly: before.price_yearly,
            enabled: before.enabled,
          }
        : null,
      parsed,
    );
    return Response.json({ ok: true });
  }

  if (body.kind === "keys") {
    const parsed = parseBillingKeysBody(body);
    if (!parsed || Object.keys(parsed).length === 0) {
      return Response.json({ error: "invalid body" }, { status: 400 });
    }

    const update: Record<string, string | null> = { updated_at: new Date().toISOString() };
    if ("secretKey" in parsed) update.stripe_secret_key = parsed.secretKey ?? null;
    if ("webhookSecret" in parsed) update.stripe_webhook_secret = parsed.webhookSecret ?? null;

    const { error } = await admin.from("app_settings").update(update).eq("id", 1);
    if (error) return Response.json({ error: error.message }, { status: 500 });

    await audit(actor, "billing.set_keys", "app_settings", null, redactKeysForAudit(parsed));
    return Response.json({ ok: true });
  }

  return Response.json({ error: "invalid kind" }, { status: 400 });
}
