// Price-sync cron job. Fetches live prices + FX server-side and caches them on
// the instruments / fx_rates tables, so the web app reads everything from the
// catalog cache instead of each client polling the providers (rate limits).
//
// Schedule this (Vercel Cron, Supabase scheduled function, or any scheduler) to
// POST /api/cron/sync-prices with `Authorization: Bearer $CRON_SECRET`.
// Requires the secret key: it updates `instruments`/`fx_rates`, and RLS grants
// no update/write policy there for authenticated/anon (see supabase/schema.sql).
//
// Caches:  equities (Yahoo, native currency), crypto (CoinGecko, USD),
//          FX rates (Frankfurter, EUR-anchored).
//
// Equities/ETFs are synced even when they have no preset quote listing — the
// job resolves one by ISIN/WKN/symbol via Yahoo and persists the resolved
// quote_source/quote_id, so auto-imported assets (created without a listing)
// start pricing without any manual catalog seeding.

import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveQuote } from "@/lib/server/yahoo";
import { supabaseSecret } from "@/lib/server/supabase-keys";

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
  quote_scale: number | string | null;
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

// 1 unit of `from` in `to` (Frankfurter/ECB), cached per run. 1 when equal.
const fxCache = new Map<string, number>();
async function fxRate(from: string, to: string): Promise<number> {
  const a = (from || "").toUpperCase();
  const b = (to || "").toUpperCase();
  if (!a || !b || a === b) return 1;
  const ck = `${a}|${b}`;
  const cached = fxCache.get(ck);
  if (cached) return cached;
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/latest?from=${a}&to=${b}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = (await res.json()) as { rates?: Record<string, number> };
      const rate = data.rates?.[b];
      if (typeof rate === "number" && rate > 0) {
        fxCache.set(ck, rate);
        return rate;
      }
    }
  } catch {
    /* fall through */
  }
  return 1;
}

async function syncEquities(
  supabase: SupabaseClient,
  rows: InstrumentRow[],
  syncedAt: string,
  revalidate: boolean,
): Promise<number> {
  let updated = 0;
  await Promise.all(
    rows.map(async (r) => {
      const query = r.isin || r.wkn || r.symbol;
      if (!query) return;
      const hasHint = r.quote_source === "yahoo" && !!r.quote_id;
      const isCommodity = r.type === "COMMODITY";
      // COMMODITY listings are seeded and authoritative (e.g. gold's
      // XAUEUR=X + quote_scale) - a bare metal ticker mis-resolves via Yahoo
      // search (this put gold at 1.42 EUR: the cron learned a ~44 EUR
      // listing and then applied quote_scale on top of it). Rows with a
      // hint always reuse it and never fall back to search; rows without
      // one (not yet seeded) keep resolving normally. Non-COMMODITY rows
      // are excluded from this and instead self-heal daily below.
      const hint = hasHint && (isCommodity || !revalidate) ? (r.quote_id as string) : undefined;
      // A COMMODITY row's authoritative listing can trade in a different
      // currency than the instrument's native one (gold's replacement
      // listing GC=F is USD, the gold row itself is EUR) - resolveQuote's
      // hint fast path rejects a currency mismatch, which would otherwise
      // fall through to an unreliable search and get caught by the guard
      // below anyway. Passing an empty want-currency lets the fast path
      // accept the hint regardless of currency; the FX conversion + scale
      // below already handle the difference.
      const want = isCommodity && hint ? "" : r.currency || "";
      try {
        const resolved = await resolveQuote(query, want, hint);
        if (isCommodity && hasHint && (!resolved || resolved.symbol !== hint)) {
          // The hinted listing failed (no data / currency mismatch) or
          // resolveQuote fell through to search and picked a different one -
          // either way, never trust it for a commodity. Skip until the
          // seeded row is fixed manually.
          return;
        }
        const symbol = resolved?.symbol;
        let p = resolved ? resolved.price : null;
        if (p == null) return;
        // The instrument's last_price must be in the instrument's own currency.
        // When only a different-currency listing exists (e.g. a US stock the user
        // holds in EUR resolves to the USD NASDAQ line), convert via FX — exactly
        // as /api/price does — so the cached price isn't a raw USD number stored
        // as EUR (the Alphabet 337.39 vs 295.93 bug).
        if (r.currency && resolved && resolved.currency && resolved.currency !== r.currency) {
          p = p * (await fxRate(resolved.currency, r.currency));
        }
        // after FX, per-instrument unit scale (e.g. Yahoo's per-ounce gold
        // price -> the user's per-gram holding). No-op when scale is 1.
        const scale = Number(r.quote_scale ?? 1);
        if (scale !== 1) p = p * scale;
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
  const supabase = supabaseSecret();
  if (!supabase) {
    return Response.json({ error: "supabase secret key not configured" }, { status: 500 });
  }
  // All instruments — including user-added ones that have no quote listing yet.
  // Equities/ETFs are resolved by identifier (ISIN/WKN/symbol); crypto needs a
  // CoinGecko id, so only rows that already carry one are synced.
  const { data, error } = await supabase
    .from("instruments")
    .select("id, isin, wkn, symbol, currency, type, quote_source, quote_id, quote_scale, last_price");
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as InstrumentRow[];
  const syncedAt = new Date().toISOString();

  // Hint-less resolution costs a full Yahoo search per instrument, so it
  // only runs in the 03:00 UTC hour (once a day) or on an explicit
  // ?revalidate=1 - this heals a stuck mis-resolved quote_id (the GME
  // 2.23 case) within a day instead of never, while keeping every other
  // sync on the cheap hinted fast path.
  const revalidate =
    new URL(req.url).searchParams.get("revalidate") === "1" ||
    new Date(syncedAt).getUTCHours() === 3;

  const [equities, crypto, fx] = await Promise.all([
    syncEquities(
      supabase,
      rows.filter(
        (r) =>
          (r.type === "STOCK" || r.type === "ETF" || r.type === "COMMODITY") &&
          r.quote_source !== "coingecko",
      ),
      syncedAt,
      revalidate,
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
