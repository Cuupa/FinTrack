// Price-sync cron job. Fetches live prices + FX server-side and caches them on
// the instruments / fx_rates tables, so the web app reads everything from the
// catalog cache instead of each client polling the providers (rate limits).
//
// Schedule this (Vercel Cron, Supabase scheduled function, or any scheduler) to
// POST /api/cron/sync-prices with `Authorization: Bearer $CRON_SECRET`.
// Requires SUPABASE_SERVICE_ROLE_KEY to write the public reference tables.
//
// Caches:  equities (Yahoo, native currency), crypto (CoinGecko, USD),
//          FX rates (Frankfurter, EUR-anchored).
//
// Equities/ETFs are synced even when they have no preset quote listing — the
// job resolves one by ISIN/WKN/symbol via Yahoo and persists the resolved
// quote_source/quote_id, so auto-imported assets (created without a listing)
// start pricing without any manual catalog seeding.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { resolveQuote } from "@/lib/server/yahoo";

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
  // Header only — never accept the secret as a query param (it leaks via logs,
  // referrers and browser history). Matches Vercel Cron's Authorization header.
  return req.headers.get("authorization") === `Bearer ${secret}`;
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
        const resolved = await resolveQuote(query, r.currency || "", hint);
        const p = resolved ? resolved.price : null;
        const symbol = resolved?.symbol;
        if (p == null) return;
        // Auto-imported instruments are created without a quote listing, so the
        // cron resolves one (by ISIN/WKN/symbol — never hardcoded) and persists
        // it. Also re-persists when the resolved listing differs from the stored
        // one, so a previously mis-resolved quote_id self-corrects. Future syncs
        // short-circuit on the hint, and runtime live quotes reuse the quote_id.
        const learnsListing =
          !!symbol && (r.quote_source !== "yahoo" || r.quote_id !== symbol);
        if (!learnsListing && !changed(r.last_price, p)) return;
        const patch: Record<string, unknown> = {
          last_price: p,
          price_synced_at: syncedAt,
        };
        if (learnsListing) {
          patch.quote_source = "yahoo";
          patch.quote_id = symbol;
        }
        const { error } = await supabase
          .from("instruments")
          .update(patch)
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
      `https://api.frankfurter.dev/v1/latest?from=EUR&to=${FX_CURRENCIES.join(",")}`,
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
  // All instruments — including user-added ones that have no quote listing yet.
  // Equities/ETFs are resolved by identifier (ISIN/WKN/symbol); crypto needs a
  // CoinGecko id, so only rows that already carry one are synced.
  const { data, error } = await supabase
    .from("instruments")
    .select("id, isin, wkn, symbol, currency, type, quote_source, quote_id, last_price");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as InstrumentRow[];
  const syncedAt = new Date().toISOString();

  const [equities, crypto, fx] = await Promise.all([
    syncEquities(
      supabase,
      rows.filter(
        (r) =>
          (r.type === "STOCK" || r.type === "ETF") && r.quote_source !== "coingecko",
      ),
      syncedAt,
    ),
    syncCrypto(
      supabase,
      rows.filter((r) => r.quote_source === "coingecko" && r.quote_id),
      syncedAt,
    ),
    syncFx(supabase, syncedAt),
  ]);

  return Response.json({ ok: true, syncedAt, equities, crypto, fxRates: fx });
}

// POST only: this mutates the catalog (prices/FX), so it must not be a safe
// GET (Zalando REST guidelines — GET must be side-effect-free).
export const POST = handle;
