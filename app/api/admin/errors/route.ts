// Admin purge for the self-hosted error-log pipeline. error_logs has no
// write policy for authenticated/anon (see supabase/schema.sql), so purging
// goes through here (requireAdmin + secret client), never a direct client
// delete — same admin-mutation convention as app/api/admin/flags/route.ts.
//
// DELETE body: { olderThanDays?: number } — omitted/absent purges every row
// ("Purge all"); a positive integer purges rows older than that many days
// ("Purge older than N days"). Records the deleted row count in the audit
// trail's new_value.

import { audit, requireAdmin } from "@/lib/server/require-admin";
import { supabaseSecret } from "@/lib/server/supabase-keys";

export const dynamic = "force-dynamic";

export async function DELETE(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const admin = supabaseSecret();
  if (!admin) return Response.json({ error: "admin not configured" }, { status: 503 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const body = (raw ?? {}) as Record<string, unknown>;
  const olderThanDays = body.olderThanDays;
  if (olderThanDays !== undefined && (typeof olderThanDays !== "number" || olderThanDays < 0)) {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const actor = { userId: auth.userId, email: auth.email };

  let query = admin.from("error_logs").delete({ count: "exact" });
  if (typeof olderThanDays === "number") {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    query = query.lt("created_at", cutoff);
  } else {
    // Supabase requires an explicit filter on delete; `neq` on the primary
    // key against a value no row can equal deletes every row, same idiom
    // needed for an unconditional "delete all" via the JS client.
    query = query.neq("id", "00000000-0000-0000-0000-000000000000");
  }

  const { error, count } = await query;
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await audit(actor, "error.purge", null, null, {
    olderThanDays: olderThanDays ?? null,
    deleted: count ?? 0,
  });

  return Response.json({ ok: true, deleted: count ?? 0 });
}
