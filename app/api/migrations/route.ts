// Lists applied database migrations (from public.schema_migrations) so the
// /system page can show which schema changes a database has. Empty when
// Supabase isn't configured.

import { supabasePublishable } from "@/lib/server/supabase-keys";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  // schema_migrations is world-readable (select-only RLS policy) — no bypass needed.
  const supabase = supabasePublishable();
  if (!supabase) return Response.json({ migrations: [] });

  try {
    const { data, error } = await supabase
      .from("schema_migrations")
      .select("version, applied_at")
      .order("version", { ascending: true });
    if (error) throw error;
    return Response.json({ migrations: data ?? [] });
  } catch {
    return Response.json({ migrations: [] });
  }
}
