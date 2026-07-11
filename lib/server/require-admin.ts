// Admin-route authorization. Same two-step pattern as
// app/api/account/delete/route.ts: (1) verify the CALLER via the publishable
// (RLS-scoped) client's `auth.getUser(token)`, which never trusts a user id
// supplied by the client, only what Supabase resolves the token to; (2) look
// up the admin allowlist via the secret client (public.admins has an RLS
// policy that only lets a user see their OWN row, so checking whether an
// arbitrary caller is an admin needs the RLS bypass).
//
// Callers do: `const auth = await requireAdmin(req); if (!auth.ok) return
// auth.res;` then use `auth.userId` / `auth.email` for the audit trail.

import "server-only";
import { supabasePublishable, supabaseSecret } from "./supabase-keys";

export type RequireAdminResult =
  | { ok: true; userId: string; email: string | null }
  | { ok: false; res: Response };

function unavailable(): Response {
  // Mirrors app/api/share/route.ts: Supabase not configured at all (Guest-
  // only deploy) is a 503, not a 401/403, since there is no admin concept
  // without a database.
  return Response.json({ error: "admin not configured" }, { status: 503 });
}

function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

function forbidden(): Response {
  return Response.json({ error: "forbidden" }, { status: 403 });
}

export async function requireAdmin(req: Request): Promise<RequireAdminResult> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  if (!token) return { ok: false, res: unauthorized() };

  const verifier = supabasePublishable();
  const admin = supabaseSecret();
  if (!verifier || !admin) return { ok: false, res: unavailable() };

  const { data: userData, error: userError } = await verifier.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return { ok: false, res: unauthorized() };

  const { data: row, error: rowError } = await admin
    .from("admins")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (rowError || !row) return { ok: false, res: forbidden() };

  return { ok: true, userId: user.id, email: user.email ?? null };
}

/**
 * Records an admin mutation in `admin_audit`. Best-effort: a logging hiccup
 * must never turn a successful admin action into a failed response, so
 * errors are swallowed here rather than thrown, matching the rest of the
 * server layer's fail-open style (e.g. lib/server/rate-limit.ts), since
 * there is no console logging anywhere else in this codebase's server code
 * to mirror instead.
 */
export async function audit(
  actor: { userId: string; email: string | null },
  action: string,
  target: string | null,
  oldValue: unknown,
  newValue: unknown,
): Promise<void> {
  const admin = supabaseSecret();
  if (!admin) return;
  try {
    await admin.from("admin_audit").insert({
      actor_id: actor.userId,
      actor_email: actor.email,
      action,
      target,
      old_value: oldValue ?? null,
      new_value: newValue ?? null,
    });
  } catch {
    // Best-effort: never let audit logging fail the caller's mutation.
  }
}
