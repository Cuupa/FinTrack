// A fund's geographic (region) breakdown by ISIN. Serves the DB cache
// (etf_breakdowns, filled by /api/cron/sync/etf-breakdowns) and only falls back
// to a live onvista fetch when the fund isn't cached. The client falls back to
// the constituent look-through if absent.

import { createClient } from "@supabase/supabase-js";
import { fetchEtfRegionWeights } from "@/lib/server/classify";

export const dynamic = "force-dynamic";

async function cached(key: string): Promise<unknown[] | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  try {
    const supabase = createClient(url, anon);
    const { data } = await supabase
      .from("etf_breakdowns")
      .select("data")
      .eq("etf_key", key)
      .eq("kind", "region")
      .maybeSingle();
    const rows = (data as { data?: unknown[] } | null)?.data;
    return Array.isArray(rows) && rows.length ? rows : null;
  } catch {
    return null;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> },
): Promise<Response> {
  const { symbol } = await params;
  const q = symbol?.trim();
  if (!q) return Response.json({ found: false });

  const hit = await cached(q.toUpperCase());
  if (hit) return Response.json({ found: true, regions: hit });

  const regions = await fetchEtfRegionWeights(q);
  if (!regions) return Response.json({ found: false });
  return Response.json({ found: true, regions });
}
