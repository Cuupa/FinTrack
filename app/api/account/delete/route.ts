// Account deletion (GDPR Art. 17). POST with `Authorization: Bearer <access
// token>` (the caller's own Supabase session token, e.g. from
// `supabase.auth.getSession()`) and an optional JSON body `{ password?:
// string }`.
//
// Two-step: (1) verify the CALLER via the publishable (RLS-scoped) client's
// `auth.getUser(token)` — this never trusts a user id supplied by the client,
// it only trusts what Supabase resolves the token to; (2) delete via the
// secret client's `auth.admin.deleteUser` (RLS bypass justified: this is the
// auth admin API, unavailable under RLS at all).
//
// Password re-auth: accounts with an email/password identity
// (`user.identities` includes provider "email") must additionally confirm
// their CURRENT password before deletion proceeds — verified server-side via
// `signInWithPassword` on a fresh client, never trusted from the client's say-
// so. OAuth-only accounts (Google/GitHub, no email identity) have no
// password to check and keep the keyword-only confirmation flow.
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

  let password: string | undefined;
  try {
    const body = (await req.json()) as { password?: string };
    if (typeof body?.password === "string") password = body.password;
  } catch {
    // No/invalid JSON body — treat as no password supplied.
  }

  const verifier = supabasePublishable();
  if (!verifier) {
    return Response.json({ error: "not configured" }, { status: 500 });
  }

  const { data: userData, error: userError } = await verifier.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const userId = user.id;

  const hasPassword = user.identities?.some((i) => i.provider === "email") ?? false;
  if (hasPassword) {
    if (!password) {
      return Response.json({ error: "password required" }, { status: 400 });
    }
    // Fresh client: signInWithPassword mutates the client's own auth state,
    // so it must not share `verifier`, which we still use to trust `user`.
    const authCheck = supabasePublishable();
    if (!authCheck) {
      return Response.json({ error: "not configured" }, { status: 500 });
    }
    const { error: pwError } = await authCheck.auth.signInWithPassword({
      email: user.email!,
      password,
    });
    if (pwError) {
      return Response.json({ error: "invalid password" }, { status: 403 });
    }
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
