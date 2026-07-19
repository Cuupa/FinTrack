// Expired-share cleanup cron. RLS already makes an expired shared_portfolios
// row invisible (migration 0034's select policy), so this isn't needed for
// correctness — it just reclaims storage by deleting rows whose expires_at
// has passed.
//
// Schedule with `Authorization: Bearer $CRON_SECRET`. Requires the secret
// key (shared_portfolios has no client-facing delete-by-expiry policy);
// silently no-ops if it isn't configured rather than erroring, since this is
// a best-effort sweep, not a correctness-critical path.

import { supabaseSecret } from "@/lib/server/supabase-keys";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  // Header only — never accept the secret as a query param (leaks via logs).
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const supabase = supabaseSecret();
  if (!supabase) {
    // No secret key configured — silent no-op (nothing this route can do).
    return Response.json({ ok: true, deleted: 0 });
  }
  const { error, count } = await supabase
    .from("shared_portfolios")
    .delete({ count: "exact" })
    .not("expires_at", "is", null)
    .lt("expires_at", new Date().toISOString());
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true, deleted: count ?? 0 });
}

// POST only: this deletes rows, so it must not be a safe GET (Zalando REST
// guidelines — GET must be side-effect-free).
export const POST = handle;
