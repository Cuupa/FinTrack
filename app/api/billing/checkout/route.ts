// Create a Stripe Checkout Session (MONETIZATION.md section 3, Phase 1).
// Redirect-based: this returns the hosted Checkout URL, the browser navigates
// there, no Stripe.js on the page (CSP untouched).
//
// Auth: the caller's own Supabase session bearer token, verified server-side
// exactly like app/api/account/delete (never trust a client-supplied user id).
// DB-backed per-IP rate limit like app/api/share. Prices come from the
// world-readable `billing_config` row (config-in-DB): selling is refused (403)
// when disabled, 503 when the wanted price id or the Stripe secret key
// (`getStripeKeys()` — an `app_settings` DB value or the STRIPE_SECRET_KEY
// env fallback) is missing.

import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { stripeFetch } from "@/lib/server/stripe";
import { getStripeKeys } from "@/lib/server/billing-keys";
import { supabasePublishable, supabaseSecret } from "@/lib/server/supabase-keys";

export const dynamic = "force-dynamic";

const RATE_LIMIT_PER_MIN = 20;

interface BillingConfigRow {
  price_monthly: string | null;
  price_yearly: string | null;
  enabled: boolean;
}

export async function POST(req: Request): Promise<Response> {
  // 1. Bearer session auth.
  const authz = req.headers.get("authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice("Bearer ".length).trim() : "";
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const verifier = supabasePublishable();
  if (!verifier) return Response.json({ error: "not configured" }, { status: 503 });

  const { data: userData, error: userErr } = await verifier.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) return Response.json({ error: "unauthorized" }, { status: 401 });

  // 2. Rate limit (best effort, DB-backed; fails open without Supabase/IP).
  if (!(await rateLimit("billing/checkout", req, RATE_LIMIT_PER_MIN))) {
    return tooManyRequests();
  }

  // 3. Interval -> price id from billing_config.
  let interval: "monthly" | "yearly" = "monthly";
  try {
    const body = (await req.json()) as { interval?: unknown };
    if (body?.interval === "yearly") interval = "yearly";
    else if (body?.interval === "monthly") interval = "monthly";
    else if (body?.interval !== undefined) {
      return Response.json({ error: "invalid interval" }, { status: 400 });
    }
  } catch {
    // No body -> default to monthly.
  }

  const { data: config } = await verifier
    .from("billing_config")
    .select("price_monthly, price_yearly, enabled")
    .eq("id", 1)
    .maybeSingle<BillingConfigRow>();

  if (!config?.enabled) return Response.json({ error: "billing disabled" }, { status: 403 });

  const priceId = interval === "yearly" ? config.price_yearly : config.price_monthly;
  const { secretKey } = await getStripeKeys();
  if (!priceId || !secretKey) {
    return Response.json({ error: "billing not configured" }, { status: 503 });
  }

  // 4. Reuse the Stripe customer, or create + persist one (service role: the
  //    billing_customers table has no client write policy).
  const admin = supabaseSecret();
  if (!admin) return Response.json({ error: "not configured" }, { status: 503 });

  let customerId: string | null = null;
  const { data: existing } = await admin
    .from("billing_customers")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle<{ stripe_customer_id: string }>();
  if (existing?.stripe_customer_id) {
    customerId = existing.stripe_customer_id;
  } else {
    const created = await stripeFetch<{ id?: string }>("/customers", {
      method: "POST",
      secretKey,
      params: {
        ...(user.email ? { email: user.email } : {}),
        "metadata[user_id]": user.id,
      },
    });
    if (!created.ok || !created.data?.id) {
      return Response.json({ error: "stripe error" }, { status: 502 });
    }
    customerId = created.data.id;
    const { error: mapErr } = await admin
      .from("billing_customers")
      .upsert(
        { user_id: user.id, stripe_customer_id: customerId },
        { onConflict: "user_id" },
      );
    if (mapErr) return Response.json({ error: "db error" }, { status: 500 });
  }

  // 5. Create the Checkout Session.
  const origin = new URL(req.url).origin;
  const session = await stripeFetch<{ url?: string }>("/checkout_sessions", {
    method: "POST",
    secretKey,
    params: {
      mode: "subscription",
      customer: customerId,
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": 1,
      client_reference_id: user.id,
      success_url: `${origin}/settings?billing=success`,
      cancel_url: `${origin}/settings?billing=cancelled`,
      "automatic_tax[enabled]": true,
      allow_promotion_codes: true,
    },
  });
  if (!session.ok || !session.data?.url) {
    return Response.json({ error: "stripe error" }, { status: 502 });
  }

  return Response.json({ url: session.data.url });
}
