// First global constituent fetch. Called when an asset is created: if the ETF
// has no constituents cached yet (globally — keyed by etf_symbol), fetch and
// cache them. No-ops when they already exist, so it runs effectively once per
// fund regardless of which user adds it. Writes the global reference table via
// the service role.

import { createClient } from "@supabase/supabase-js";
import { fetchConstituents } from "@/lib/server/constituents";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  let symbol: string | undefined;
  let isin: string | null = null;
  try {
    const body = (await req.json()) as { symbol?: string; isin?: string };
    symbol = (body.symbol || "").trim().toUpperCase();
    isin = (body.isin || "").trim().toUpperCase() || null;
  } catch {
    return Response.json({ ok: false });
  }
  if (!symbol) return Response.json({ ok: false });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return Response.json({ ok: false, reason: "service role not configured" });
  }

  const supabase = createClient(url, serviceKey);

  // Already cached globally? Then nothing to do.
  const { count } = await supabase
    .from("instrument_constituents")
    .select("id", { count: "exact", head: true })
    .eq("etf_symbol", symbol);
  if ((count ?? 0) > 0) return Response.json({ ok: true, cached: true });

  const rows = await fetchConstituents(symbol, isin);
  if (!rows || rows.length === 0) return Response.json({ ok: true, fetched: 0 });

  const { error } = await supabase.from("instrument_constituents").upsert(
    rows.map((r) => ({
      etf_symbol: symbol,
      constituent_name: r.name,
      constituent_symbol: r.symbol,
      constituent_isin: r.isin,
      weight: r.weight,
    })),
    { onConflict: "etf_symbol,constituent_name", ignoreDuplicates: true },
  );
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  return Response.json({ ok: true, fetched: rows.length });
}
