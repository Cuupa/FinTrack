// Retention for the self-hosted error-log pipeline (see
// supabase/migrations/0051_error_logs.sql, app/api/errors/route.ts,
// app/admin/errors/page.tsx): deletes error_logs rows older than 30 days so
// the table doesn't grow unbounded. Matches /datenschutz's "deleted after 30
// days at the latest" disclosure — keep both in sync if this window changes.
//
// POST only with `Authorization: Bearer $CRON_SECRET`, same shape as the
// other app/api/cron/sync/* sub-syncs. middleware.ts already enforces the
// secret at the edge for the whole /api/cron/* tree; this repeats the check
// so the route is still safe if ever called directly in a context that
// skips middleware (matches every other sub-sync route's own `authorized`
// check, e.g. app/api/cron/sync/names/route.ts).

import { supabaseSecret } from "@/lib/server/supabase-keys";

export const dynamic = "force-dynamic";

const RETENTION_DAYS = 30;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const supabase = supabaseSecret();
  if (!supabase) {
    return Response.json({ error: "secret key not configured" }, { status: 500 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error, count } = await supabase
    .from("error_logs")
    .delete({ count: "exact" })
    .lt("created_at", cutoff);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ ok: true, deleted: count ?? 0 });
}

export const POST = handle;
