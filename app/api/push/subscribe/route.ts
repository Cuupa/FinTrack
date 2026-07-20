// Store (or update) a browser push subscription + its per-event prefs for the
// authed user (F5). Auth: the caller's own Supabase session bearer token,
// verified server-side exactly like app/api/billing/checkout. Upsert by
// endpoint so re-subscribing on the same device updates prefs in place.

import { rateLimit, tooManyRequests } from "@/lib/server/rate-limit";
import { supabasePublishable, supabaseSecret } from "@/lib/server/supabase-keys";

export const dynamic = "force-dynamic";

const RATE_LIMIT_PER_MIN = 20;

interface Body {
  subscription?: {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  notifyDividends?: unknown;
  notifySavings?: unknown;
}

export async function POST(req: Request): Promise<Response> {
  const authz = req.headers.get("authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice("Bearer ".length).trim() : "";
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const verifier = supabasePublishable();
  if (!verifier) return Response.json({ error: "not configured" }, { status: 503 });
  const { data: userData, error: userErr } = await verifier.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) return Response.json({ error: "unauthorized" }, { status: 401 });

  if (!(await rateLimit("push/subscribe", req, RATE_LIMIT_PER_MIN))) return tooManyRequests();

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const endpoint = body.subscription?.endpoint;
  const p256dh = body.subscription?.keys?.p256dh;
  const auth = body.subscription?.keys?.auth;
  if (typeof endpoint !== "string" || typeof p256dh !== "string" || typeof auth !== "string") {
    return Response.json({ error: "invalid subscription" }, { status: 400 });
  }

  const admin = supabaseSecret();
  if (!admin) return Response.json({ error: "not configured" }, { status: 503 });

  const { error } = await admin.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint,
      p256dh,
      auth,
      notify_dividends: body.notifyDividends === true,
      notify_savings: body.notifySavings === true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );
  if (error) return Response.json({ error: "db error" }, { status: 500 });

  return Response.json({ ok: true });
}
