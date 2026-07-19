// Daily billing reconcile (MONETIZATION.md section 3, Phase 1). Webhooks are
// the source of truth, but deliveries can be missed; this re-fetches every
// local subscription row from Stripe and repairs drift. A Stripe 404
// (resource_missing) means the subscription no longer exists -> mark the row
// canceled (row kept for history; entitlement falls to free via resolvePlan).
//
// POST only with `Authorization: Bearer $CRON_SECRET`, same shape as the other
// app/api/cron/sync/* sub-syncs. middleware.ts enforces the secret at the edge
// for the whole /api/cron/* tree; this repeats the check so the route is safe
// if ever called directly. Skips cleanly (200) when STRIPE_SECRET_KEY is unset
// so deploys without Stripe stay green.

import {
  stripeFetch,
  subscriptionRowFrom,
  type StripeSubscription,
} from "@/lib/server/stripe";
import { supabaseSecret } from "@/lib/server/supabase-keys";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return Response.json({ ok: true, skipped: "stripe not configured" });
  }

  const supabase = supabaseSecret();
  if (!supabase) {
    return Response.json({ error: "secret key not configured" }, { status: 500 });
  }

  const { data: rows, error } = await supabase
    .from("subscriptions")
    .select("user_id, stripe_subscription_id");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let reconciled = 0;
  let canceled = 0;
  let errors = 0;

  for (const row of rows ?? []) {
    const subId = row.stripe_subscription_id as string;
    const userId = row.user_id as string;
    const res = await stripeFetch<StripeSubscription>(
      `/subscriptions/${encodeURIComponent(subId)}`,
      { secretKey },
    );

    if (res.ok && res.data?.id) {
      const mapped = subscriptionRowFrom(res.data);
      const { error: upErr } = await supabase
        .from("subscriptions")
        .upsert({ user_id: userId, ...mapped, updated_at: new Date().toISOString() }, {
          onConflict: "user_id",
        });
      if (upErr) errors++;
      else reconciled++;
    } else if (res.status === 404) {
      // resource_missing: the subscription is gone. Keep the row, mark canceled.
      const { error: upErr } = await supabase
        .from("subscriptions")
        .update({ status: "canceled", updated_at: new Date().toISOString() })
        .eq("user_id", userId);
      if (upErr) errors++;
      else canceled++;
    } else {
      errors++;
    }
  }

  return Response.json({ ok: true, reconciled, canceled, errors });
}

export const POST = handle;
