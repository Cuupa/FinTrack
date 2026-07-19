// Create a Stripe Billing portal session (MONETIZATION.md section 3, Phase 1).
// Self-service: change plan, payment method, cancel, invoices — all on
// Stripe's hosted portal. Redirect-based like checkout (no Stripe.js, CSP
// untouched). Same bearer session auth + rate limit as checkout; requires an
// existing billing_customers row (404 if the user never started a checkout).

import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { stripeFetch } from "@/lib/server/stripe";
import { supabasePublishable, supabaseSecret } from "@/lib/server/supabase-keys";

export const dynamic = "force-dynamic";

const RATE_LIMIT_PER_MIN = 20;

export async function POST(req: Request): Promise<Response> {
  const authz = req.headers.get("authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice("Bearer ".length).trim() : "";
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const verifier = supabasePublishable();
  if (!verifier) return Response.json({ error: "not configured" }, { status: 503 });

  const { data: userData, error: userErr } = await verifier.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) return Response.json({ error: "unauthorized" }, { status: 401 });

  if (!(await rateLimit("billing/portal", req, RATE_LIMIT_PER_MIN))) {
    return tooManyRequests();
  }

  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return Response.json({ error: "billing not configured" }, { status: 503 });

  const admin = supabaseSecret();
  if (!admin) return Response.json({ error: "not configured" }, { status: 503 });

  const { data: mapping } = await admin
    .from("billing_customers")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle<{ stripe_customer_id: string }>();
  if (!mapping?.stripe_customer_id) {
    return Response.json({ error: "no subscription" }, { status: 404 });
  }

  const origin = new URL(req.url).origin;
  const portal = await stripeFetch<{ url?: string }>("/billing_portal/sessions", {
    method: "POST",
    secretKey,
    params: {
      customer: mapping.stripe_customer_id,
      return_url: `${origin}/settings`,
    },
  });
  if (!portal.ok || !portal.data?.url) {
    return Response.json({ error: "stripe error" }, { status: 502 });
  }

  return Response.json({ url: portal.data.url });
}
