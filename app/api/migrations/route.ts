// Lists applied database migrations (from public.schema_migrations) so the
// /system page can show which schema changes a database has. Empty when
// Supabase isn't configured.

import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return Response.json({ migrations: [] });

  try {
    const supabase = createClient(url, key);
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
