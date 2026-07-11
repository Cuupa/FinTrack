// Admin user lookup by email, backing the email search in
// app/admin/flags/page.tsx's "add override" form (raw user ids are hard to
// come by otherwise: auth.users isn't exposed through any client-readable
// table). Read-only, so unlike the mutating admin routes this does NOT
// record an admin_audit row, same as the other GET-only admin endpoints
// (app/api/admin/flags/route.ts's GET, app/api/admin/site/route.ts's GET).
//
// `q` (?q=) must be at least 2 characters to avoid a 1000-row scan for a
// near-empty query. Same 1000-row `listUsers` bound as
// app/api/admin/site/route.ts's user count: fine for a self-hosted instance
// with a registration cap. Filtering happens in memory (Supabase Auth's
// admin API has no server-side email search), case-insensitive substring
// match, capped at 10 results.

import { requireAdmin } from "@/lib/server/require-admin";
import { supabaseSecret } from "@/lib/server/supabase-keys";

export const dynamic = "force-dynamic";

const MAX_RESULTS = 10;

export async function GET(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (q.length < 2) return Response.json({ error: "query too short" }, { status: 400 });

  const admin = supabaseSecret();
  if (!admin) return Response.json({ error: "admin not configured" }, { status: 503 });

  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const needle = q.toLowerCase();
  const users = data.users
    .filter((u) => (u.email ?? "").toLowerCase().includes(needle))
    .slice(0, MAX_RESULTS)
    .map((u) => ({ id: u.id, email: u.email ?? null }));

  return Response.json({ users });
}
