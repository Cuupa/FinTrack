// Raw Stripe REST access + the pure, unit-testable pieces of the billing
// layer (MONETIZATION.md section 3, Phase 1). No `stripe` npm package: every
// call is a server-side `fetch` to https://api.stripe.com/v1/... with a
// `Authorization: Bearer ${STRIPE_SECRET_KEY}` header and a form-encoded body
// (Stripe expects application/x-www-form-urlencoded with bracket notation,
// e.g. `line_items[0][price]=...`). This matches the repo's Yahoo/Frankfurter
// convention (vendor calls are server-side fetches) and keeps the CSP
// connect-src untouched — the browser never contacts api.stripe.com; it only
// follows the redirect URLs Checkout / the Billing portal return.
//
// The signature verify, the subscription->row mapping and the event router
// are pure and covered by tests/billing-stripe.test.ts. DB writes live in the
// route handlers behind small functions, so no supabase-js chain mock is
// needed here (repo convention).

import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const STRIPE_API_BASE = "https://api.stripe.com/v1";

/** Stripe's signature timestamp tolerance: reject events older/newer than 5 min. */
const SIGNATURE_TOLERANCE_SEC = 300;

// ---------------------------------------------------------------------------
// Loose Stripe object shapes (only the fields we read). Stripe sends far more.
// ---------------------------------------------------------------------------

export interface StripeSubscriptionItem {
  price?: { id?: string } | null;
  /** Newer API versions carry the period end on the item, older ones on the sub. */
  current_period_end?: number | null;
}

export interface StripeSubscription {
  id: string;
  status: string;
  customer?: string | { id?: string } | null;
  cancel_at_period_end?: boolean | null;
  /** Older API versions carry the period end here; newer ones on items.data[0]. */
  current_period_end?: number | null;
  items?: { data?: StripeSubscriptionItem[] } | null;
}

export interface StripeCheckoutSession {
  id: string;
  subscription?: string | { id?: string } | null;
  customer?: string | { id?: string } | null;
  client_reference_id?: string | null;
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: unknown };
}

/** The subscriptions-table row shape, minus the caller-resolved `user_id`. */
export interface SubscriptionRow {
  stripe_subscription_id: string;
  status: string;
  plan: "pro";
  price_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

// ---------------------------------------------------------------------------
// stripeFetch — the one place that talks to api.stripe.com
// ---------------------------------------------------------------------------

/** Form-encode a flat params map using Stripe's bracket-notation keys. */
export function formEncode(params: Record<string, string | number | boolean>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
}

export interface StripeResult<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

/**
 * Perform a Stripe REST call. GET has no body; other methods form-encode
 * `params`. Never throws on a non-2xx status — returns `{ ok, status, data }`
 * so callers can branch (e.g. treat a 404 `resource_missing` as "gone").
 */
export async function stripeFetch<T = unknown>(
  path: string,
  opts: {
    method?: string;
    params?: Record<string, string | number | boolean>;
    secretKey: string;
    signal?: AbortSignal;
  },
): Promise<StripeResult<T>> {
  const method = opts.method ?? "GET";
  const init: RequestInit = {
    method,
    headers: {
      Authorization: `Bearer ${opts.secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    signal: opts.signal,
  };
  if (opts.params && method !== "GET") init.body = formEncode(opts.params);

  const res = await fetch(`${STRIPE_API_BASE}${path}`, init);
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

// ---------------------------------------------------------------------------
// verifyStripeSignature — pure HMAC check over the RAW request body
// ---------------------------------------------------------------------------

/**
 * Verify a `Stripe-Signature` header against the raw body using Stripe's v1
 * scheme: parse `t=<ts>,v1=<hex>[,v1=<hex>...]`, HMAC-SHA256 the string
 * `${t}.${rawBody}` with the endpoint secret, and timing-safe compare against
 * each `v1` candidate. Rejects when the timestamp is outside a 5-minute
 * tolerance (replay protection).
 */
export function verifyStripeSignature(
  header: string | null,
  rawBody: string,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!header || !secret) return false;

  let timestamp: string | null = null;
  const candidates: string[] = [];
  for (const part of header.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") timestamp = value;
    else if (key === "v1") candidates.push(value);
  }
  if (!timestamp || candidates.length === 0) return false;

  const t = Number(timestamp);
  if (!Number.isFinite(t)) return false;
  if (Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SEC) return false;

  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  return candidates.some((sig) => {
    const sigBuf = Buffer.from(sig, "utf8");
    // timingSafeEqual throws on length mismatch — guard it, and a length
    // mismatch is a non-match anyway.
    return sigBuf.length === expectedBuf.length && timingSafeEqual(sigBuf, expectedBuf);
  });
}

// ---------------------------------------------------------------------------
// subscriptionRowFrom — Stripe subscription -> DB row (pure)
// ---------------------------------------------------------------------------

function epochToISO(epoch: unknown): string | null {
  if (typeof epoch !== "number" || !Number.isFinite(epoch)) return null;
  return new Date(epoch * 1000).toISOString();
}

/** Read a Stripe id whether it arrived as a bare string or an expanded object. */
export function stripeId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

/**
 * Map a Stripe subscription object to the `subscriptions` row shape (status
 * verbatim, plan always 'pro', price from the first item). Period end lives on
 * the subscription in older API versions and on the first item in current
 * ones — read the subscription level first, fall back to the item. Missing
 * fields map to null (the caller decides whether that is writable).
 */
export function subscriptionRowFrom(sub: StripeSubscription): SubscriptionRow {
  const item = sub.items?.data?.[0];
  const periodEnd =
    typeof sub.current_period_end === "number" ? sub.current_period_end : item?.current_period_end;
  return {
    stripe_subscription_id: sub.id,
    status: sub.status,
    plan: "pro",
    price_id: item?.price?.id ?? null,
    current_period_end: epochToISO(periodEnd),
    cancel_at_period_end: sub.cancel_at_period_end ?? false,
  };
}

// ---------------------------------------------------------------------------
// planForEvent — pure event router (webhook + tests use it)
// ---------------------------------------------------------------------------

export type BillingEventPlan =
  | {
      kind: "checkout-completed";
      subscriptionId: string | null;
      customerId: string | null;
      userId: string | null;
    }
  | { kind: "subscription-upsert"; subscription: StripeSubscription; forceCanceled: boolean }
  | { kind: "ignore" };

/**
 * Decide what a webhook event means, without any side effects. The route
 * executes the resulting plan (fetch/upsert). Every handled event funnels into
 * one subscription upsert; `checkout.session.completed` additionally ensures
 * the customer<->user mapping. Unknown / `invoice.payment_failed` -> ignore
 * (the `past_due` status plus the grace rule already covers dunning).
 */
export function planForEvent(event: StripeEvent): BillingEventPlan {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as StripeCheckoutSession;
      return {
        kind: "checkout-completed",
        subscriptionId: stripeId(session.subscription),
        customerId: stripeId(session.customer),
        userId: session.client_reference_id ?? null,
      };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
      return {
        kind: "subscription-upsert",
        subscription: event.data.object as StripeSubscription,
        forceCanceled: false,
      };
    case "customer.subscription.deleted":
      return {
        kind: "subscription-upsert",
        subscription: event.data.object as StripeSubscription,
        forceCanceled: true,
      };
    default:
      // invoice.payment_failed and any unhandled type: nothing to do.
      return { kind: "ignore" };
  }
}
