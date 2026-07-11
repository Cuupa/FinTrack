// Admin site-config + app-settings editor backend. All mutations go through
// here (never direct client writes), same convention as
// app/api/admin/flags/route.ts: `site_config` has a read-only RLS policy
// (owner writes only via the secret key) and `app_settings` has RLS enabled
// with no policy at all — not even readable by the publishable key — so an
// admin browsing/editing either needs the secret-key bypass.
//
// GET returns the current `app_settings` row (the client can't read it
// directly, unlike `site_config`, which is world-readable and read straight
// from the browser client by app/admin/site/page.tsx via useSiteConfig())
// plus the current registered-user count, via the secret client's
// `auth.admin.listUsers` (no client-readable table exposes `auth.users`).
//
// POST body is one of:
//   { kind: "config", key, value }   upsert a site_config row (key must be
//                                     one of SITE_CONFIG_KEYS)
//   { kind: "maxUsers", value }      set app_settings.max_users (integer
//                                     >= 0, or null for "no limit")
// Each requires admin auth first, mutates via the secret client, and records
// an admin_audit row.

import { audit, requireAdmin } from "@/lib/server/require-admin";
import { supabaseSecret } from "@/lib/server/supabase-keys";
import { SITE_CONFIG_KEYS, type SiteConfigKey } from "@/lib/site-config-cache";

export const dynamic = "force-dynamic";

function isSiteConfigKey(key: unknown): key is SiteConfigKey {
  return typeof key === "string" && (SITE_CONFIG_KEYS as readonly string[]).includes(key);
}

export async function GET(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const admin = supabaseSecret();
  if (!admin) return Response.json({ error: "admin not configured" }, { status: 503 });

  const { data, error } = await admin
    .from("app_settings")
    .select("max_users, updated_at")
    .eq("id", 1)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Self-hosted instances are expected to stay well under 1000 registered
  // users; a single page is enough to get an exact count without paginating.
  // A listUsers failure degrades to userCount: null rather than failing the
  // whole GET, since the max-users editor above is the more important half.
  let userCount: number | null = null;
  try {
    const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (!usersError) userCount = usersPage.users.length;
  } catch {
    userCount = null;
  }

  return Response.json({
    maxUsers: data?.max_users ?? null,
    updatedAt: data?.updated_at ?? null,
    userCount,
  });
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  // Same reasoning as app/api/admin/flags/route.ts: read as an unknown-valued
  // record and validate per branch, rather than a discriminated union.
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const body = (raw ?? {}) as Record<string, unknown>;

  const admin = supabaseSecret();
  if (!admin) return Response.json({ error: "admin not configured" }, { status: 503 });

  const actor = { userId: auth.userId, email: auth.email };

  if (body.kind === "config") {
    const { key, value } = body;
    if (!isSiteConfigKey(key) || typeof value !== "string") {
      return Response.json({ error: "invalid body" }, { status: 400 });
    }
    const { data: before } = await admin
      .from("site_config")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    const { error } = await admin
      .from("site_config")
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return Response.json({ error: error.message }, { status: 500 });
    await audit(actor, "site.set", key, before ?? null, { value });
    return Response.json({ ok: true });
  }

  if (body.kind === "maxUsers") {
    const { value } = body;
    if (value !== null && (typeof value !== "number" || !Number.isInteger(value) || value < 0)) {
      return Response.json({ error: "invalid body" }, { status: 400 });
    }
    const { data: before } = await admin
      .from("app_settings")
      .select("max_users")
      .eq("id", 1)
      .maybeSingle();
    const { error } = await admin
      .from("app_settings")
      .update({ max_users: value, updated_at: new Date().toISOString() })
      .eq("id", 1);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    await audit(actor, "settings.set_max_users", "app_settings", before ?? null, { maxUsers: value });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "invalid kind" }, { status: 400 });
}
