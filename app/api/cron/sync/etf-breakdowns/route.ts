// Caches each catalog ETF's sector + region weightings in `etf_breakdowns`, so
// the Analysis pies read from the DB instead of hitting Yahoo/onvista on every
// view. POST only with `Authorization: Bearer $CRON_SECRET`; requires the
// service role key. Keyed by the asset price key (ISIN, else symbol) the client
// queries with.

import { createClient } from "@supabase/supabase-js";
import {
  etfSectorWeights,
  fetchEtfRegionWeights,
  fetchEtfCountryWeights,
} from "@/lib/server/classify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
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
    .select("isin, symbol")
    .eq("type", "ETF");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows: { etf_key: string; kind: string; data: unknown }[] = [];
  let funds = 0;
  for (const r of (data ?? []) as { isin: string | null; symbol: string | null }[]) {
    const key = (r.isin || r.symbol || "").toUpperCase();
    if (!key) continue;
    funds += 1;
    const [sectors, regions, countries] = await Promise.all([
      // Yahoo + onvista together (whichever delivers the sector breakdown).
      etfSectorWeights(r.isin || key).catch(() => null),
      fetchEtfRegionWeights(r.isin || key).catch(() => null),
      fetchEtfCountryWeights(r.isin || key).catch(() => null),
    ]);
    if (sectors?.length) rows.push({ etf_key: key, kind: "sector", data: sectors });
    if (regions?.length) rows.push({ etf_key: key, kind: "region", data: regions });
    if (countries?.length) rows.push({ etf_key: key, kind: "country", data: countries });
  }

  if (rows.length > 0) {
    const { error: upErr } = await supabase
      .from("etf_breakdowns")
      .upsert(rows, { onConflict: "etf_key,kind" });
    if (upErr) return Response.json({ error: upErr.message }, { status: 500 });
  }

  return Response.json({ ok: true, etfs: funds, cached: rows.length });
}

export const POST = handle;
