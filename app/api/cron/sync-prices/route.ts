// Price-sync cron job. Fetches live prices + FX server-side and caches them on
// the instruments / fx_rates tables, so the web app reads everything from the
// catalog cache instead of each client polling the providers (rate limits).
//
// Schedule this (Vercel Cron, Supabase scheduled function, or any scheduler) to
// hit GET/POST /api/cron/sync-prices with `Authorization: Bearer $CRON_SECRET`.
// Requires SUPABASE_SERVICE_ROLE_KEY to write the public reference tables.
//
// Caches:  equities (Yahoo, native currency), crypto (CoinGecko, USD),
//          FX rates (Frankfurter, EUR-anchored).

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { price, resolveSymbol } from "@/lib/server/yahoo";

export const dynamic = "force-dynamic";

interface InstrumentRow {
  id: string;
  isin: string | null;
  wkn: string | null;
  symbol: string | null;
  currency: string | null;
  type: string;
  quote_source: string | null;
  quote_id: string | null;
  last_price: number | string | null;
}

const FX_CURRENCIES = ["USD", "GBP", "CHF", "JPY", "CAD", "AUD"];

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // no secret configured → allow (e.g. local dev)
  const auth = req.headers.get("authorization") || "";
  const url = new URL(req.url);
  return auth === `Bearer ${secret}` || url.searchParams.get("secret") === secret;
}

const changed = (prev: number | string | null, next: number): boolean => {
  if (prev == null) return true;
  const p = Number(prev);
  return Math.abs(p - next) >= p * 1e-4;
};

async function syncEquities(
  supabase: SupabaseClient,
  rows: InstrumentRow[],
  syncedAt: string,
): Promise<number> {
  let updated = 0;
  await Promise.all(
    rows.map(async (r) => {
      const query = r.isin || r.wkn || r.symbol;
      if (!query) return;
      const hint = r.quote_source === "yahoo" && r.quote_id ? r.quote_id : undefined;
      try {
        const symbol = await resolveSymbol(query, r.currency || "", hint);
        const p = symbol ? await price(symbol) : null;
        if (p == null || !changed(r.last_price, p)) return;
        const { error } = await supabase
          .from("instruments")
          .update({ last_price: p, price_synced_at: syncedAt })
          .eq("id", r.id);
        if (!error) updated += 1;
      } catch {
        /* skip */
      }
    }),
  );
  return updated;
}

async function syncCrypto(
  supabase: SupabaseClient,
  rows: InstrumentRow[],
  syncedAt: string,
): Promise<number> {
  const ids = Array.from(new Set(rows.map((r) => r.quote_id).filter(Boolean)));
  if (ids.length === 0) return 0;
  let data: Record<string, { usd?: number }> | null = null;
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(10_000) },
    );
    if (res.ok) data = (await res.json()) as Record<string, { usd?: number }>;
  } catch {
    return 0;
  }
  if (!data) return 0;

  let updated = 0;
  await Promise.all(
    rows.map(async (r) => {
      const p = r.quote_id ? data[r.quote_id]?.usd : undefined;
      if (p == null || p <= 0 || !changed(r.last_price, p)) return;
      const { error } = await supabase
        .from("instruments")
        .update({ last_price: p, price_synced_at: syncedAt })
        .eq("id", r.id);
      if (!error) updated += 1;
    }),
  );
  return updated;
}

async function syncFx(supabase: SupabaseClient, syncedAt: string): Promise<number> {
  try {
    const res = await fetch(
      `https://api.frankfurter.app/latest?from=EUR&to=${FX_CURRENCIES.join(",")}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return 0;
    const data = (await res.json()) as { rates?: Record<string, number> };
    const rows = [{ currency: "EUR", rate: 1, synced_at: syncedAt }];
    for (const [cur, rate] of Object.entries(data.rates ?? {})) {
      if (typeof rate === "number" && rate > 0) {
        rows.push({ currency: cur, rate, synced_at: syncedAt });
      }
    }
    const { error } = await supabase.from("fx_rates").upsert(rows);
    return error ? 0 : rows.length;
  } catch {
    return 0;
  }
}

async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return Response.json({ error: "supabase service role not configured" }, { status: 500 });
  }

  const supabase = createClient(url, serviceKey);
  const { data, error } = await supabase
    .from("instruments")
    .select("id, isin, wkn, symbol, currency, type, quote_source, quote_id, last_price")
    .not("quote_source", "is", null);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as InstrumentRow[];
  const syncedAt = new Date().toISOString();

  const [equities, crypto, fx] = await Promise.all([
    syncEquities(
      supabase,
      rows.filter((r) => r.quote_source === "yahoo" || r.quote_source === "stooq"),
      syncedAt,
    ),
    syncCrypto(
      supabase,
      rows.filter((r) => r.quote_source === "coingecko"),
      syncedAt,
    ),
    syncFx(supabase, syncedAt),
  ]);

  return Response.json({ ok: true, syncedAt, equities, crypto, fxRates: fx });
}

export const GET = handle;
export const POST = handle;
