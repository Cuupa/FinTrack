// Classification-backfill cron. Fills sector + geographic region for ETF
// constituents (and directly-held stocks) that don't have them yet, by fetching
// Yahoo's assetProfile online and persisting it to the catalog — so the
// Analysis sector/region breakdowns stop collapsing into "Other". No hardcoded
// data: everything is resolved from the asset's symbol/ISIN.
//
// POST only (mutates the catalog) with `Authorization: Bearer $CRON_SECRET`.
// Requires the service role key. Processes a capped batch per call (Yahoo is
// rate-limited); the response reports whether more rows remain, so re-run until
// `remaining` is 0.

import { createClient } from "@supabase/supabase-js";
import { classify } from "@/lib/server/classify";

export const dynamic = "force-dynamic";

const BATCH = 40; // rows resolved per call
const CONCURRENCY = 6;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/** Resolve `items` with bounded concurrency, returning how many were updated. */
async function runPool<T>(
  items: T[],
  worker: (item: T) => Promise<boolean>,
): Promise<number> {
  let updated = 0;
  let i = 0;
  const next = async (): Promise<void> => {
    while (i < items.length) {
      const item = items[i++];
      if (await worker(item)) updated += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, next));
  return updated;
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

  // ETF constituents missing a sector — the bulk of the look-through.
  const { data: consRows, error: consErr } = await supabase
    .from("instrument_constituents")
    .select("id, constituent_isin, constituent_symbol")
    .is("sector", null)
    .limit(BATCH);
  if (consErr) return Response.json({ error: consErr.message }, { status: 500 });

  const constituents = await runPool(consRows ?? [], async (r) => {
    const q = r.constituent_symbol || r.constituent_isin;
    if (!q) return false;
    const c = await classify(q).catch(() => null);
    if (!c || (!c.sector && !c.region)) return false;
    const { error } = await supabase
      .from("instrument_constituents")
      .update({ sector: c.sector, region: c.region })
      .eq("id", r.id);
    return !error;
  });

  // Any directly-held instrument missing a sector (stocks, ETFs, crypto).
  const { data: instRows, error: instErr } = await supabase
    .from("instruments")
    .select("id, isin, symbol")
    .neq("type", "CASH")
    .is("sector", null)
    .limit(BATCH);
  if (instErr) return Response.json({ error: instErr.message }, { status: 500 });

  const instruments = await runPool(instRows ?? [], async (r) => {
    const q = r.symbol || r.isin;
    if (!q) return false;
    const c = await classify(q).catch(() => null);
    if (!c || (!c.sector && !c.region)) return false;
    const { error } = await supabase
      .from("instruments")
      .update({ sector: c.sector, region: c.region })
      .eq("id", r.id);
    return !error;
  });

  // A full batch likely means more rows are waiting — caller should re-run.
  const remaining =
    (consRows?.length ?? 0) === BATCH || (instRows?.length ?? 0) === BATCH;

  return Response.json({ ok: true, constituents, instruments, remaining });
}

export const POST = handle;
