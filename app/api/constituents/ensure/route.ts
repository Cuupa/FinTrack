// First global constituent fetch. Called when an asset is created: if the ETF
// has no constituents cached yet (globally — keyed by etf_symbol), fetch and
// cache them. No-ops when they already exist, so it runs effectively once per
// fund regardless of which user adds it. Writes the global reference table via
// the secret key (instrument_constituents' RLS is select-only, no upsert grant
// for authenticated/anon).

import { fetchConstituents } from "@/lib/server/constituents";
import { supabaseSecret } from "@/lib/server/supabase-keys";

export const dynamic = "force-dynamic";

// Writes global reference data, so it's secured like the crons: only callers
// with the secret (Bearer header) may trigger it. Open only when no secret is
// configured (local dev).
function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
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

  const supabase = supabaseSecret();
  if (!supabase) {
    return Response.json({ ok: false, reason: "secret key not configured" });
  }

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
