// Operating metrics for the admin area: which features are actually used, how
// many people are registered, and whether the platform is healthy.
//
// There is no event tracking behind this and there must never be: every figure
// is an aggregate over data users already stored, computed when the page is
// opened (public.admin_feature_usage(), migration 0108). Nothing is written,
// nothing is retained, no cookie is involved -- which is what lets
// /datenschutz keep saying FinTrack runs no analytics or tracking services.
//
// Read-only, so like the other GET-only admin endpoints it records no
// admin_audit row.

import { requireAdmin } from "@/lib/server/require-admin";
import { supabaseSecret } from "@/lib/server/supabase-keys";
import { serverFail } from "@/lib/server/error-log";

export const dynamic = "force-dynamic";

interface UsageRow {
  feature: string;
  users: number;
  records: number;
}

type Admin = NonNullable<ReturnType<typeof supabaseSecret>>;

/** Rows created in the last `days` days, or null when the count is unavailable
 *  (never a zero, which would read as "nothing happened"). */
async function since(
  admin: Admin,
  table: string,
  column: string,
  days: number,
): Promise<number | null> {
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const { count, error } = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .gte(column, from);
  return error ? null : (count ?? 0);
}

const DAY = 86_400_000;

export async function GET(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const admin = supabaseSecret();
  if (!admin) return Response.json({ error: "admin not configured" }, { status: 503 });

  const { data, error } = await admin.rpc("admin_feature_usage");
  if (error) {
    // The owner needs the real reason on screen: an un-run migration reads as
    // "function does not exist", which is a fix, not a mystery.
    return serverFail("/api/admin/usage", error.message, { detail: error.details ?? undefined });
  }

  const { data: users, error: usersError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const recent = (iso: string | null | undefined, days: number) =>
    iso != null && Date.now() - new Date(iso).getTime() < days * DAY;
  const totalUsers = usersError ? null : users.users.length;
  const activeUsers = usersError
    ? null
    : users.users.filter((u) => recent(u.last_sign_in_at, 30)).length;
  const newUsers = usersError ? null : users.users.filter((u) => recent(u.created_at, 30)).length;

  const [errors24h, errors7d, shares30d, imports30d] = await Promise.all([
    since(admin, "error_logs", "created_at", 1),
    since(admin, "error_logs", "created_at", 7),
    since(admin, "shared_portfolios", "created_at", 30),
    since(admin, "imported_rows", "created_at", 30),
  ]);

  return Response.json({
    features: (data ?? []) as UsageRow[],
    users: { total: totalUsers, activeLast30d: activeUsers, newLast30d: newUsers },
    health: { errors24h, errors7d, shares30d, imports30d },
  });
}
