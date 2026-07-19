// Admin editor for `plan_grants` ("gratitude premium", migration 0068):
// manually grant a user Pro independent of any Stripe subscription, with an
// optional expiry, and revoke a grant. Same shape as
// app/api/admin/billing/route.ts / app/api/admin/flags/route.ts:
// requireAdmin first, all mutations via the secret client (RLS only lets a
// user select their OWN grants), every write audited.
//
// GET lists every grant joined with the owning user's email via
// `admin.auth.admin.listUsers({ page: 1, perPage: 1000 })` — same 1000-row
// bound and "a listUsers failure degrades to null emails, not a 500" as
// app/api/admin/users/route.ts, since the grants themselves are still valid
// (and revocable) without the email lookup.
//
// POST body `{ userId, expiresAt?, note? }`: userId is required (the admin
// UI resolves an email to a user id via GET /api/admin/users?q= first,
// mirroring app/admin/flags/page.tsx's override form); expiresAt is an
// optional ISO datetime or null (both mean infinite), invalid/past dates
// reject with 400; note is an optional trimmed string. Always inserts
// `plan: 'pro'`. Audited as "billing.grant".
//
// DELETE body `{ id }`: removes the grant by id, audited as
// "billing.grant.revoke", 404 if no such grant exists.

import { audit, requireAdmin } from "@/lib/server/require-admin";
import { supabaseSecret } from "@/lib/server/supabase-keys";
import { parseGrantBody } from "@/lib/server/billing-admin";

export const dynamic = "force-dynamic";

const MAX_USERS = 1000;

interface GrantRow {
  id: string;
  user_id: string;
  plan: string;
  expires_at: string | null;
  note: string | null;
  created_at: string;
  created_by: string | null;
}

export async function GET(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const admin = supabaseSecret();
  if (!admin) return Response.json({ error: "admin not configured" }, { status: 503 });

  const { data, error } = await admin
    .from("plan_grants")
    .select("id, user_id, plan, expires_at, note, created_at, created_by")
    .order("created_at", { ascending: false })
    .returns<GrantRow[]>();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Same 1000-row listUsers bound as app/api/admin/users/route.ts: fine for
  // a self-hosted instance with a registration cap. A failure here degrades
  // every row's email to null rather than failing the whole request, since
  // the grants are still valid (and revocable) without it.
  const emailById = new Map<string, string | null>();
  const { data: usersData, error: usersError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: MAX_USERS,
  });
  if (!usersError && usersData) {
    for (const u of usersData.users) emailById.set(u.id, u.email ?? null);
  }

  const grants = (data ?? []).map((g) => ({
    id: g.id,
    userId: g.user_id,
    email: emailById.get(g.user_id) ?? null,
    plan: g.plan,
    expiresAt: g.expires_at,
    note: g.note,
    createdAt: g.created_at,
    createdBy: g.created_by,
  }));

  return Response.json({ grants });
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const body = (raw ?? {}) as Record<string, unknown>;

  const parsed = parseGrantBody(body, new Date().toISOString());
  if (!parsed) return Response.json({ error: "invalid body" }, { status: 400 });

  const admin = supabaseSecret();
  if (!admin) return Response.json({ error: "admin not configured" }, { status: 503 });

  const actor = { userId: auth.userId, email: auth.email };

  const { data, error } = await admin
    .from("plan_grants")
    .insert({
      user_id: parsed.userId,
      plan: "pro",
      expires_at: parsed.expiresAt,
      note: parsed.note,
      created_by: actor.email,
    })
    .select("id")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await audit(actor, "billing.grant", parsed.userId, null, {
    expiresAt: parsed.expiresAt,
    note: parsed.note,
  });
  return Response.json({ ok: true, id: (data as { id: string } | null)?.id ?? null });
}

export async function DELETE(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const body = (raw ?? {}) as Record<string, unknown>;
  const { id } = body;
  if (typeof id !== "string" || id.trim() === "") {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }

  const admin = supabaseSecret();
  if (!admin) return Response.json({ error: "admin not configured" }, { status: 503 });

  const actor = { userId: auth.userId, email: auth.email };

  const { data: before, error: beforeError } = await admin
    .from("plan_grants")
    .select("user_id, plan, expires_at, note")
    .eq("id", id)
    .maybeSingle();
  if (beforeError) return Response.json({ error: beforeError.message }, { status: 500 });
  if (!before) return Response.json({ error: "not found" }, { status: 404 });

  const { error } = await admin.from("plan_grants").delete().eq("id", id);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  await audit(actor, "billing.grant.revoke", id, before, null);
  return Response.json({ ok: true });
}
