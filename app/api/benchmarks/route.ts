// Benchmark price history, served from the DB cache (public.benchmark_history)
// so we don't hit Yahoo on every chart view. A benchmark is (re)fetched from
// Yahoo only when its cache is missing or stale — and only if the service role
// is available to write; otherwise we return whatever is cached.

import type { SupabaseClient } from "@supabase/supabase-js";
import { historyByQuery, isISIN } from "@/lib/server/yahoo";
import { BENCHMARKS } from "@/lib/finance/benchmarks";
import { secretKey, supabaseSecret, supabasePublishable } from "@/lib/server/supabase-keys";
import { convertPoints } from "@/lib/server/fx-history";

export const dynamic = "force-dynamic";

const STALE_DAYS = 4; // markets close weekends; refresh when older than this
// Daily over ~2 years (~500 points, well under PostgREST's ~1000-row read cap)
// so benchmark overlays are smooth against the daily portfolio line instead of a
// coarse weekly staircase. Longer compare windows show up to this much history.
const RANGE = "2y";
const INTERVAL = "1d";
const DEFAULT_BASE = "EUR";
// Base currencies we pre-convert and persist on every sync, so a chart view is
// a plain DB read (no FX call). EUR is always included so the on-the-fly
// fallback for any other base always has a source series to convert from.
const PERSIST_CURRENCIES = ["EUR", "USD", "GBP", "CHF", "JPY", "CAD", "AUD"];

function daysSince(isoDate: string): number {
  return (Date.now() - new Date(isoDate + "T00:00:00Z").getTime()) / 86_400_000;
}

type Point = { date: string; close: number };

async function latestDate(supabase: SupabaseClient, id: string): Promise<string | null> {
  const { data } = await supabase
    .from("benchmark_history")
    .select("date")
    .eq("benchmark_id", id)
    .order("date", { ascending: false })
    .limit(1);
  return (data?.[0] as { date: string } | undefined)?.date ?? null;
}

export async function GET(req: Request): Promise<Response> {
  // Writing benchmark_history needs the secret key (RLS only grants select);
  // without it we still read whatever's cached with the publishable key.
  const supabase = supabaseSecret() ?? supabasePublishable();
  if (!supabase) return Response.json({ benchmarks: {} });

  const params = new URL(req.url).searchParams;
  const idsParam = params.get("ids");
  const base = (params.get("base") || DEFAULT_BASE).toUpperCase(); // user's base currency
  const force = params.get("force") != null; // refresh regardless of staleness
  const wanted = idsParam ? idsParam.split(",") : BENCHMARKS.map((b) => b.id);
  const chosen = BENCHMARKS.filter((b) => wanted.includes(b.id));

  const canWrite = !!secretKey();
  const out: Record<string, { date: string; close: number }[]> = {};

  for (const b of chosen) {
    if (canWrite) {
      const last = await latestDate(supabase, b.id);
      if (force || !last || daysSince(last) > STALE_DAYS) {
        const query = isISIN(b.item.key) ? b.item.key : b.item.id || b.item.key;
        const hint = b.item.id || undefined;
        // Total-return (adjusted close) so distributing benchmarks are
        // comparable to accumulating holdings.
        const r = await historyByQuery(query, b.item.currency, hint, RANGE, INTERVAL, true).catch(
          () => null,
        );
        if (r && r.points.length > 0) {
          // The cache is shared across users with different base currencies, so
          // we persist the native series PLUS a pre-converted copy in each
          // common base currency. A chart view is then a plain DB read.
          const native = (r.currency || b.item.currency || DEFAULT_BASE).toUpperCase();
          const targets = Array.from(new Set([native, ...PERSIST_CURRENCIES]));
          // Replace existing rows so a resolution/currency change doesn't mix.
          await supabase.from("benchmark_history").delete().eq("benchmark_id", b.id);
          for (const cur of targets) {
            const pts = cur === native ? r.points : await convertPoints(r.points, native, cur);
            if (!pts || pts.length === 0) continue;
            await supabase.from("benchmark_history").insert(
              pts.map((p) => ({
                benchmark_id: b.id,
                date: p.date,
                close: p.close,
                currency: cur,
              })),
            );
          }
        }
      }
    }

    // Read the MOST RECENT rows for the user's base currency (PostgREST caps at
    // ~1000): descending + limit, then reverse to ascending — otherwise we'd
    // return the oldest rows, years before the chart window, and every
    // benchmark would flat-line at 0%.
    out[b.id] = await readSeries(supabase, b.id, base);
  }

  return Response.json({ benchmarks: out });
}

/** Read a benchmark's series in `base`; if not pre-persisted, convert from EUR. */
async function readSeries(supabase: SupabaseClient, id: string, base: string): Promise<Point[]> {
  const fetchCurrency = async (cur: string): Promise<Point[]> => {
    const { data } = await supabase
      .from("benchmark_history")
      .select("date, close")
      .eq("benchmark_id", id)
      .eq("currency", cur)
      .order("date", { ascending: false })
      .limit(1000);
    return ((data ?? []) as { date: string; close: number | string }[])
      .map((r) => ({ date: r.date, close: Number(r.close) }))
      .reverse();
  };

  const direct = await fetchCurrency(base);
  if (direct.length > 0) return direct;

  // Base not pre-persisted (or rows predate the multi-currency migration):
  // fall back to converting the always-present EUR series on the fly.
  if (base !== DEFAULT_BASE) {
    const eur = await fetchCurrency(DEFAULT_BASE);
    if (eur.length > 0) {
      const converted = await convertPoints(eur, DEFAULT_BASE, base);
      if (converted) return converted;
    }
  }
  return direct; // empty
}
