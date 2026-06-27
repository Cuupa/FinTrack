// All cached fund sector breakdowns, keyed by fund (ISIN/symbol). Read-only from
// etf_breakdowns; populated by /api/cron/sync/etf-breakdowns.

import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return Response.json({ sectors: {} });
  try {
    const supabase = createClient(url, anon);
    const { data } = await supabase
      .from("etf_breakdowns")
      .select("etf_key, data")
      .eq("kind", "sector");
    const out: Record<string, unknown> = {};
    for (const r of (data ?? []) as { etf_key: string; data: unknown }[]) out[r.etf_key] = r.data;
    return Response.json({ sectors: out });
  } catch {
    return Response.json({ sectors: {} });
  }
}
