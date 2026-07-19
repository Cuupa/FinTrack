// Pure Stripe billing layer (lib/server/stripe.ts) + the webhook route's
// pre-Supabase guards (MONETIZATION.md section 3, Phase 1). Everything here is
// exercised without a supabase-js chain mock: the pure functions have no DB
// dependency, and the webhook test only reaches the signature/parse guards
// that run before any Supabase call (repo convention, see retention.test.ts).

import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

// "server-only" has no runtime module under plain Vitest; stub it so importing
// lib/server/stripe.ts and the route (both -> supabase-keys -> "server-only")
// resolves. Same stub as llm-route.test.ts / retention.test.ts.
vi.mock("server-only", () => ({}));

const {
  verifyStripeSignature,
  subscriptionRowFrom,
  planForEvent,
  formEncode,
  stripeId,
} = await import("../lib/server/stripe");

const { resolveStripeKey } = await import("../lib/server/billing-keys");

function sign(ts: number, body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
}

// ---------------------------------------------------------------------------
// verifyStripeSignature
// ---------------------------------------------------------------------------

describe("verifyStripeSignature", () => {
  const secret = "whsec_test_secret";
  const body = '{"id":"evt_1","type":"customer.subscription.updated"}';
  const now = 1_800_000_000;

  it("accepts a valid signature within tolerance", () => {
    const header = `t=${now},v1=${sign(now, body, secret)}`;
    expect(verifyStripeSignature(header, body, secret, now)).toBe(true);
  });

  it("accepts when one of several v1 candidates matches", () => {
    const header = `t=${now},v1=${"0".repeat(64)},v1=${sign(now, body, secret)}`;
    expect(verifyStripeSignature(header, body, secret, now)).toBe(true);
  });

  it("rejects a signature made with the wrong secret", () => {
    const header = `t=${now},v1=${sign(now, body, "wrong_secret")}`;
    expect(verifyStripeSignature(header, body, secret, now)).toBe(false);
  });

  it("rejects when the body was tampered after signing", () => {
    const header = `t=${now},v1=${sign(now, body, secret)}`;
    expect(verifyStripeSignature(header, body + "x", secret, now)).toBe(false);
  });

  it("rejects a timestamp outside the 5-minute tolerance (replay)", () => {
    const oldTs = now - 400; // > 300s in the past
    const header = `t=${oldTs},v1=${sign(oldTs, body, secret)}`;
    expect(verifyStripeSignature(header, body, secret, now)).toBe(false);
  });

  it("rejects a future timestamp outside tolerance", () => {
    const futureTs = now + 400;
    const header = `t=${futureTs},v1=${sign(futureTs, body, secret)}`;
    expect(verifyStripeSignature(header, body, secret, now)).toBe(false);
  });

  it("rejects a null header, a missing secret, and a malformed header", () => {
    expect(verifyStripeSignature(null, body, secret, now)).toBe(false);
    expect(verifyStripeSignature(`t=${now},v1=${sign(now, body, secret)}`, body, "", now)).toBe(
      false,
    );
    expect(verifyStripeSignature("garbage", body, secret, now)).toBe(false);
    expect(verifyStripeSignature(`v1=${sign(now, body, secret)}`, body, secret, now)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// subscriptionRowFrom
// ---------------------------------------------------------------------------

describe("subscriptionRowFrom", () => {
  const epoch = 1_893_456_000; // 2030-01-01T00:00:00Z
  const iso = new Date(epoch * 1000).toISOString();

  it("reads current_period_end from the subscription item (current API)", () => {
    const row = subscriptionRowFrom({
      id: "sub_item",
      status: "active",
      cancel_at_period_end: false,
      items: { data: [{ price: { id: "price_monthly" }, current_period_end: epoch }] },
    });
    expect(row).toEqual({
      stripe_subscription_id: "sub_item",
      status: "active",
      plan: "pro",
      price_id: "price_monthly",
      current_period_end: iso,
      cancel_at_period_end: false,
    });
  });

  it("falls back to the subscription-level current_period_end (older API)", () => {
    const row = subscriptionRowFrom({
      id: "sub_top",
      status: "trialing",
      cancel_at_period_end: true,
      current_period_end: epoch,
      items: { data: [{ price: { id: "price_yearly" } }] },
    });
    expect(row.current_period_end).toBe(iso);
    expect(row.price_id).toBe("price_yearly");
    expect(row.status).toBe("trialing");
    expect(row.cancel_at_period_end).toBe(true);
  });

  it("prefers the subscription level over the item when both are present", () => {
    const row = subscriptionRowFrom({
      id: "sub_both",
      status: "active",
      current_period_end: epoch,
      items: { data: [{ price: { id: "p" }, current_period_end: epoch + 999 }] },
    });
    expect(row.current_period_end).toBe(iso);
  });

  it("maps missing fields to null / false, plan always 'pro'", () => {
    const row = subscriptionRowFrom({ id: "sub_bare", status: "canceled" });
    expect(row).toEqual({
      stripe_subscription_id: "sub_bare",
      status: "canceled",
      plan: "pro",
      price_id: null,
      current_period_end: null,
      cancel_at_period_end: false,
    });
  });
});

// ---------------------------------------------------------------------------
// planForEvent
// ---------------------------------------------------------------------------

describe("planForEvent", () => {
  it("routes checkout.session.completed with ids (string form)", () => {
    const plan = planForEvent({
      id: "evt_c",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_1",
          subscription: "sub_1",
          customer: "cus_1",
          client_reference_id: "user_1",
        },
      },
    });
    expect(plan).toEqual({
      kind: "checkout-completed",
      subscriptionId: "sub_1",
      customerId: "cus_1",
      userId: "user_1",
    });
  });

  it("routes checkout.session.completed with expanded objects", () => {
    const plan = planForEvent({
      id: "evt_c2",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_2",
          subscription: { id: "sub_2" },
          customer: { id: "cus_2" },
          client_reference_id: "user_2",
        },
      },
    });
    expect(plan).toMatchObject({ subscriptionId: "sub_2", customerId: "cus_2", userId: "user_2" });
  });

  it("routes created and updated to an upsert (not forced canceled)", () => {
    for (const type of ["customer.subscription.created", "customer.subscription.updated"]) {
      const sub = { id: "sub_x", status: "active" };
      const plan = planForEvent({ id: "e", type, data: { object: sub } });
      expect(plan).toEqual({ kind: "subscription-upsert", subscription: sub, forceCanceled: false });
    }
  });

  it("routes deleted to an upsert forced to canceled", () => {
    const sub = { id: "sub_d", status: "active" };
    const plan = planForEvent({
      id: "e",
      type: "customer.subscription.deleted",
      data: { object: sub },
    });
    expect(plan).toEqual({ kind: "subscription-upsert", subscription: sub, forceCanceled: true });
  });

  it("ignores invoice.payment_failed and unknown event types", () => {
    expect(
      planForEvent({ id: "e", type: "invoice.payment_failed", data: { object: {} } }),
    ).toEqual({ kind: "ignore" });
    expect(planForEvent({ id: "e", type: "some.other.event", data: { object: {} } })).toEqual({
      kind: "ignore",
    });
  });
});

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

describe("formEncode / stripeId", () => {
  it("form-encodes bracket-notation keys and values", () => {
    expect(
      formEncode({
        mode: "subscription",
        "line_items[0][price]": "price_1",
        "line_items[0][quantity]": 1,
        "automatic_tax[enabled]": true,
      }),
    ).toBe(
      "mode=subscription&line_items%5B0%5D%5Bprice%5D=price_1&line_items%5B0%5D%5Bquantity%5D=1&automatic_tax%5Benabled%5D=true",
    );
  });

  it("reads an id from a string or an expanded object, null otherwise", () => {
    expect(stripeId("cus_1")).toBe("cus_1");
    expect(stripeId({ id: "cus_2" })).toBe("cus_2");
    expect(stripeId(null)).toBeNull();
    expect(stripeId({})).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// resolveStripeKey — DB-wins, env-fallback precedence (pure, no Supabase)
// ---------------------------------------------------------------------------

describe("resolveStripeKey", () => {
  it("a set DB value wins over the env var", () => {
    expect(resolveStripeKey("sk_db_value", "sk_env_value")).toBe("sk_db_value");
  });

  it("an empty or whitespace-only DB string falls back to env", () => {
    expect(resolveStripeKey("", "sk_env_value")).toBe("sk_env_value");
    expect(resolveStripeKey("   ", "sk_env_value")).toBe("sk_env_value");
  });

  it("null/undefined DB value with env set falls back to env", () => {
    expect(resolveStripeKey(null, "sk_env_value")).toBe("sk_env_value");
    expect(resolveStripeKey(undefined, "sk_env_value")).toBe("sk_env_value");
  });

  it("neither DB nor env set resolves to null", () => {
    expect(resolveStripeKey(null, undefined)).toBeNull();
    expect(resolveStripeKey("", "")).toBeNull();
    expect(resolveStripeKey("   ", "   ")).toBeNull();
  });

  it("a non-string DB value is treated as unset and falls back to env", () => {
    expect(resolveStripeKey(42, "sk_env_value")).toBe("sk_env_value");
    expect(resolveStripeKey({}, "sk_env_value")).toBe("sk_env_value");
    expect(resolveStripeKey(true, undefined)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// webhook route guards (no Supabase reached)
// ---------------------------------------------------------------------------

const { POST } = await import("../app/api/billing/webhook/route");

function webhookReq(body: string, signature?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (signature !== undefined) headers["stripe-signature"] = signature;
  return new Request("http://localhost/api/billing/webhook", { method: "POST", headers, body });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/billing/webhook — guards before any DB access", () => {
  it("503 when STRIPE_WEBHOOK_SECRET is unset", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "");
    const res = await POST(webhookReq('{"id":"evt_1","type":"x"}'));
    expect(res.status).toBe(503);
  });

  it("400 for an unsigned request (no signature header)", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    const res = await POST(webhookReq('{"id":"evt_1","type":"x"}'));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid signature");
  });

  it("400 for a request with a bad signature", async () => {
    vi.stubEnv("STRIPE_WEBHOOK_SECRET", "whsec_test");
    const body = '{"id":"evt_1","type":"customer.subscription.updated"}';
    const res = await POST(webhookReq(body, "t=1800000000,v1=deadbeef"));
    expect(res.status).toBe(400);
  });
});
