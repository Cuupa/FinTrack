// Stripe webhook — the source of truth for subscription state (MONETIZATION.md
// section 3, Phase 1). Node runtime (default), never edge: signature
// verification needs the RAW body, so `await req.text()` FIRST, verify, only
// then JSON.parse.
//
// Auth is Stripe's signature, not a bearer token; middleware.ts exempts
// /api/billing/webhook from the API_TOKEN gate for exactly that reason (Stripe
// cannot send our token). Idempotency: claim `event.id` in `stripe_events`
// before processing; a duplicate delivery (23505) returns 200 without
// reprocessing. If processing then fails we RELEASE the claim (delete the row)
// and return 500 so Stripe's retry can actually reprocess — otherwise the
// claim would swallow the retry.

import {
  planForEvent,
  stripeFetch,
  subscriptionRowFrom,
  verifyStripeSignature,
  type StripeEvent,
  type StripeSubscription,
  type SubscriptionRow,
} from "@/lib/server/stripe";
import { supabaseSecret } from "@/lib/server/supabase-keys";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

// --- small DB write helpers (kept out of the pure/tested surface) ----------

async function upsertSubscriptionRow(
  supabase: SupabaseClient,
  userId: string,
  row: SubscriptionRow,
): Promise<boolean> {
  const { error } = await supabase
    .from("subscriptions")
    .upsert({ user_id: userId, ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  return !error;
}

async function upsertCustomerMapping(
  supabase: SupabaseClient,
  userId: string,
  customerId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("billing_customers")
    .upsert({ user_id: userId, stripe_customer_id: customerId }, { onConflict: "user_id" });
  return !error;
}

async function userForCustomer(
  supabase: SupabaseClient,
  customerId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("billing_customers")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}

/** Fetch the full subscription from Stripe by id (Checkout sessions don't embed it). */
async function fetchSubscription(id: string, secretKey: string): Promise<StripeSubscription | null> {
  const res = await stripeFetch<StripeSubscription>(`/subscriptions/${encodeURIComponent(id)}`, {
    secretKey,
  });
  return res.ok ? res.data : null;
}

// --- handler ---------------------------------------------------------------

export async function POST(req: Request): Promise<Response> {
  // 1. RAW body first (must precede any parse for the signature to hold).
  const raw = await req.text();

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return Response.json({ error: "billing not configured" }, { status: 503 });
  }

  // 2. Verify before trusting anything in the body.
  if (!verifyStripeSignature(req.headers.get("stripe-signature"), raw, webhookSecret)) {
    return Response.json({ error: "invalid signature" }, { status: 400 });
  }

  // 3. Now it is safe to parse.
  let event: StripeEvent;
  try {
    event = JSON.parse(raw) as StripeEvent;
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  if (!event?.id || !event?.type) {
    return Response.json({ error: "invalid event" }, { status: 400 });
  }

  const supabase = supabaseSecret();
  if (!supabase) {
    // No service key -> can't record idempotency or write state; let Stripe retry.
    return Response.json({ error: "billing not configured" }, { status: 500 });
  }

  // 4. Idempotency claim. A duplicate delivery short-circuits to 200.
  const claim = await supabase.from("stripe_events").insert({ event_id: event.id });
  if (claim.error) {
    if (claim.error.code === "23505") {
      return Response.json({ received: true, duplicate: true }, { status: 200 });
    }
    return Response.json({ error: "db error" }, { status: 500 });
  }

  // 5. Process. On any failure, release the claim so the retry reprocesses.
  try {
    const ok = await applyEvent(supabase, event);
    if (!ok) {
      await releaseClaim(supabase, event.id);
      return Response.json({ error: "processing failed" }, { status: 500 });
    }
    return Response.json({ received: true }, { status: 200 });
  } catch {
    await releaseClaim(supabase, event.id);
    return Response.json({ error: "processing failed" }, { status: 500 });
  }
}

async function releaseClaim(supabase: SupabaseClient, eventId: string): Promise<void> {
  try {
    await supabase.from("stripe_events").delete().eq("event_id", eventId);
  } catch {
    // Best effort; if this fails Stripe's retry will 23505 and we accept the
    // (rare) missed reprocess rather than crash the handler.
  }
}

/** Returns true on success, false on a recoverable failure (-> release + 500). */
async function applyEvent(supabase: SupabaseClient, event: StripeEvent): Promise<boolean> {
  const plan = planForEvent(event);
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (plan.kind === "ignore") return true;

  if (plan.kind === "checkout-completed") {
    // A completed checkout for a subscription always carries these; if any is
    // missing there is nothing to map, so treat it as a no-op success.
    if (!plan.userId || !plan.subscriptionId || !plan.customerId) return true;
    if (!secretKey) return false; // can't fetch the subscription -> retry later

    const sub = await fetchSubscription(plan.subscriptionId, secretKey);
    if (!sub) return false;

    if (!(await upsertCustomerMapping(supabase, plan.userId, plan.customerId))) return false;
    return upsertSubscriptionRow(supabase, plan.userId, subscriptionRowFrom(sub));
  }

  // subscription created / updated / deleted: resolve the user via the
  // customer mapping (never via email). The mapping is created by
  // checkout.session.completed; if a subscription event races ahead of it,
  // returning false lets Stripe retry once the mapping exists.
  const customerId = stripeCustomerId(plan.subscription);
  if (!customerId) return false;
  const userId = await userForCustomer(supabase, customerId);
  if (!userId) return false;

  const row = subscriptionRowFrom(plan.subscription);
  if (plan.forceCanceled) row.status = "canceled";
  return upsertSubscriptionRow(supabase, userId, row);
}

function stripeCustomerId(sub: StripeSubscription): string | null {
  const c = sub.customer;
  if (typeof c === "string") return c;
  if (c && typeof c === "object" && typeof c.id === "string") return c.id;
  return null;
}
