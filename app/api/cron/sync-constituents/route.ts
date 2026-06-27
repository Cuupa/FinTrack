// Constituent-refresh cron. Re-fetches holdings for every catalog ETF that has
// a fetchable source (see lib/server/constituents.ts) and replaces the cached
// rows. Funds without a source (e.g. World ETFs, unless FMP_API_KEY is set) are
// left as-is (their seeded data is kept).
//
// Schedule with `Authorization: Bearer $CRON_SECRET`. Requires the service role
// key to write the global reference table.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchConstituents } from "@/lib/server/constituents";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  // Header only — never accept the secret as a query param (leaks via logs).
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function refresh(
  supabase: SupabaseClient,
  symbol: string,
  isin: string | null,
): Promise<number> {
  const rows = await fetchConstituents(symbol, isin);
  if (!rows || rows.length === 0) return 0;
  // Replace existing rows for this ETF.
  await supabase.from("instrument_constituents").delete().eq("etf_symbol", symbol);
  const { error } = await supabase.from("instrument_constituents").insert(
    rows.map((r) => ({
      etf_symbol: symbol,
      constituent_name: r.name,
      constituent_symbol: r.symbol,
      constituent_isin: r.isin,
      weight: r.weight,
    })),
  );
  return error ? 0 : rows.length;
}

async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return Response.json({ error: "service role not configured" }, { status: 500 });
  }

  const supabase = createClient(url, serviceKey);
  const { data, error } = await supabase
    .from("instruments")
    .select("symbol, isin")
    .eq("type", "ETF")
    .not("symbol", "is", null);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const funds = Array.from(
    new Map(
      ((data ?? []) as { symbol: string; isin: string | null }[]).map((r) => [
        r.symbol,
        r,
      ]),
    ).values(),
  );
  const results = await Promise.all(
    funds.map(async (f) => ({
      symbol: f.symbol,
      updated: await refresh(supabase, f.symbol, f.isin).catch(() => 0),
    })),
  );
  const refreshed = results.filter((r) => r.updated > 0);

  return Response.json({
    ok: true,
    etfs: funds.length,
    refreshed: refreshed.length,
    details: refreshed,
  });
}

// POST only: replaces cached constituents, so it must not be a safe GET
// (Zalando REST guidelines — GET must be side-effect-free).
export const POST = handle;
