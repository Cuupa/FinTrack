// Account deletion (GDPR Art. 17). POST with `Authorization: Bearer <access
// token>` (the caller's own Supabase session token, e.g. from
// `supabase.auth.getSession()`).
//
// Two-step: (1) verify the CALLER via the publishable (RLS-scoped) client's
// `auth.getUser(token)` — this never trusts a user id supplied by the client,
// it only trusts what Supabase resolves the token to; (2) delete via the
// secret client's `auth.admin.deleteUser` (RLS bypass justified: this is the
// auth admin API, unavailable under RLS at all).
//
// Data cascade: profiles/assets/portfolios/simulation_runs/imported_rows/
// user_feature_flags all reference auth.users(id) on delete cascade, and
// transactions cascade transitively via assets — see supabase/schema.sql.
// The one exception is `shared_portfolios.owner`, which is a bare uuid with
// no foreign key (share links are meant to outlive edits, so it was never
// tied to a cascading FK) — those rows are deleted explicitly below.

import { supabasePublishable, supabaseSecret } from "@/lib/server/supabase-keys";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (!token) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const verifier = supabasePublishable();
  if (!verifier) {
    return Response.json({ error: "not configured" }, { status: 500 });
  }

  const { data: userData, error: userError } = await verifier.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userError || !userId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = supabaseSecret();
  if (!admin) {
    return Response.json({ error: "not configured" }, { status: 500 });
  }

  try {
    // shared_portfolios.owner has no cascading FK — clean up explicitly
    // before removing the auth user.
    await admin.from("shared_portfolios").delete().eq("owner", userId);

    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) throw error;

    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: "deletion failed" }, { status: 500 });
  }
}
