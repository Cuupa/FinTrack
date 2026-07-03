// All cached fund country breakdowns, keyed by fund (ISIN/symbol). Read-only
// from etf_breakdowns; populated by /api/cron/sync/etf-breakdowns.

import { supabasePublishable } from "@/lib/server/supabase-keys";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  // etf_breakdowns is world-readable (select-only RLS policy) — no bypass needed.
  const supabase = supabasePublishable();
  if (!supabase) return Response.json({ countries: {} });
  try {
    const { data } = await supabase
      .from("etf_breakdowns")
      .select("etf_key, data")
      .eq("kind", "country");
    const out: Record<string, unknown> = {};
    for (const r of (data ?? []) as { etf_key: string; data: unknown }[]) out[r.etf_key] = r.data;
    return Response.json({ countries: out });
  } catch {
    return Response.json({ countries: {} });
  }
}
