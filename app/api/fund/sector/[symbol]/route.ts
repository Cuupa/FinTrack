// A fund's sector weightings by ISIN/symbol. Serves the DB cache
// (etf_breakdowns, filled by /api/cron/sync/etf-breakdowns) and only falls back
// to a live Yahoo fetch when the fund isn't cached.

import { createClient } from "@supabase/supabase-js";
import { fetchEtfSectorWeights } from "@/lib/server/classify";

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
      .eq("kind", "sector")
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
  if (hit) return Response.json({ found: true, sectors: hit });

  const sectors = await fetchEtfSectorWeights(q);
  if (!sectors) return Response.json({ found: false });
  return Response.json({ found: true, sectors });
}
