// Admin feature-flags editor backend. All mutations go through here (never
// direct client writes) since global/override rows are owner-only under RLS
// (see supabase/schema.sql's feature_flags / user_feature_flags policies).
//
// GET returns all `user_feature_flags` rows for the admin overrides table.
// The client can't read this list directly: its RLS policy ("own feature
// flag overrides readable") only lets a user see their OWN overrides, not
// every user's, so an admin browsing all overrides needs the secret-key
// bypass, same reasoning as requireAdmin's own admins lookup.
//
// POST body is one of:
//   { kind: "global", flag, enabled }                    set a global default
//   { kind: "plan", flag, requiredPlan }                 set a flag's required plan
//   { kind: "override", userId, flag, enabled }          upsert a per-user override
//   { kind: "removeOverride", userId, flag }             delete a per-user override
// Each requires admin auth first, mutates via the secret client, and records
// an admin_audit row.

import { audit, requireAdmin } from "@/lib/server/require-admin";
import { supabaseSecret } from "@/lib/server/supabase-keys";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const admin = supabaseSecret();
  if (!admin) return Response.json({ error: "admin not configured" }, { status: 503 });

  const { data, error } = await admin
    .from("user_feature_flags")
    .select("user_id, flag, enabled, updated_at")
    .order("updated_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });

  return Response.json({ overrides: data ?? [] });
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  // Read as a plain unknown-valued record and validate per branch below,
  // rather than a discriminated union: a union with a catch-all `{ kind:
  // unknown }` member (needed to fall through to the "invalid kind" 400 at
  // the bottom) defeats TypeScript's literal-based narrowing on `kind`.
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

  if (body.kind === "global") {
    const { flag, enabled } = body;
    if (typeof flag !== "string" || typeof enabled !== "boolean") {
      return Response.json({ error: "invalid body" }, { status: 400 });
    }
    const { data: before } = await admin
      .from("feature_flags")
      .select("enabled")
      .eq("flag", flag)
      .maybeSingle();
    const { error } = await admin
      .from("feature_flags")
      .update({ enabled, updated_at: new Date().toISOString() })
      .eq("flag", flag);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    await audit(actor, "flag.set_global", flag, before ?? null, { enabled });
    return Response.json({ ok: true });
  }

  if (body.kind === "plan") {
    const { flag, requiredPlan } = body;
    if (
      typeof flag !== "string" ||
      (requiredPlan !== "free" && requiredPlan !== "pro")
    ) {
      return Response.json({ error: "invalid body" }, { status: 400 });
    }
    const { data: before } = await admin
      .from("feature_flags")
      .select("required_plan")
      .eq("flag", flag)
      .maybeSingle();
    const { error } = await admin
      .from("feature_flags")
      .update({ required_plan: requiredPlan, updated_at: new Date().toISOString() })
      .eq("flag", flag);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    await audit(actor, "flag.set_plan", flag, before ?? null, { requiredPlan });
    return Response.json({ ok: true });
  }

  if (body.kind === "override") {
    const { userId, flag, enabled } = body;
    if (typeof userId !== "string" || typeof flag !== "string" || typeof enabled !== "boolean") {
      return Response.json({ error: "invalid body" }, { status: 400 });
    }
    const { data: before } = await admin
      .from("user_feature_flags")
      .select("enabled")
      .eq("user_id", userId)
      .eq("flag", flag)
      .maybeSingle();
    const { error } = await admin
      .from("user_feature_flags")
      .upsert(
        { user_id: userId, flag, enabled, updated_at: new Date().toISOString() },
        { onConflict: "user_id,flag" },
      );
    if (error) return Response.json({ error: error.message }, { status: 500 });
    await audit(actor, "flag.set_override", `${userId}:${flag}`, before ?? null, { enabled });
    return Response.json({ ok: true });
  }

  if (body.kind === "removeOverride") {
    const { userId, flag } = body;
    if (typeof userId !== "string" || typeof flag !== "string") {
      return Response.json({ error: "invalid body" }, { status: 400 });
    }
    const { data: before } = await admin
      .from("user_feature_flags")
      .select("enabled")
      .eq("user_id", userId)
      .eq("flag", flag)
      .maybeSingle();
    const { error } = await admin
      .from("user_feature_flags")
      .delete()
      .eq("user_id", userId)
      .eq("flag", flag);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    await audit(actor, "flag.remove_override", `${userId}:${flag}`, before ?? null, null);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "invalid kind" }, { status: 400 });
}
