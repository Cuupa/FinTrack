// Benchmark price history, served from the DB cache (public.benchmark_history)
// so we don't hit Yahoo on every chart view. A benchmark is (re)fetched from
// Yahoo only when its cache is missing or stale — and only if the service role
// is available to write; otherwise we return whatever is cached.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { historyByQuery, isISIN } from "@/lib/server/yahoo";
import { BENCHMARKS } from "@/lib/finance/benchmarks";

export const dynamic = "force-dynamic";

const STALE_DAYS = 4; // markets close weekends; refresh when older than this
// Weekly keeps row counts well under PostgREST's ~1000-row read cap while still
// covering long timeframes (1000 weekly points ≈ 19 years).
const RANGE = "max";
const INTERVAL = "1wk";
const HOME = "EUR"; // base currency benchmark history is normalised to

function daysSince(isoDate: string): number {
  return (Date.now() - new Date(isoDate + "T00:00:00Z").getTime()) / 86_400_000;
}

/**
 * Historic FX series (1 unit of `from` in `to`) keyed by date, ascending, via
 * Frankfurter's time-series endpoint. Used to convert a benchmark's native
 * price history into the home currency so returns are comparable to home-
 * currency holdings (the conversion changes returns when FX drifts over time).
 */
async function fxSeries(from: string, to: string, start: string): Promise<[string, number][]> {
  try {
    const res = await fetch(`https://api.frankfurter.dev/v1/${start}..?from=${from}&to=${to}`, {
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { rates?: Record<string, Record<string, number>> };
    return Object.entries(data.rates ?? {})
      .map(([date, r]) => [date, r[to]] as [string, number])
      .filter(([, v]) => typeof v === "number" && v > 0)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  } catch {
    return [];
  }
}

/** Rate on/just before `date` from an ascending [date, rate] series. */
function rateAt(series: [string, number][], date: string): number | null {
  if (series.length === 0 || date < series[0][0]) return series[0]?.[1] ?? null;
  let lo = 0;
  let hi = series.length - 1;
  let ans = series[0][1];
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] <= date) {
      ans = series[mid][1];
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !(service || anon)) return Response.json({ benchmarks: {} });

  const params = new URL(req.url).searchParams;
  const idsParam = params.get("ids");
  const force = params.get("force") != null; // refresh regardless of staleness
  const wanted = idsParam ? idsParam.split(",") : BENCHMARKS.map((b) => b.id);
  const chosen = BENCHMARKS.filter((b) => wanted.includes(b.id));

  const canWrite = !!service;
  const supabase = createClient(url, service || anon!);
  const out: Record<string, { date: string; close: number }[]> = {};

  for (const b of chosen) {
    if (canWrite) {
      const last = await latestDate(supabase, b.id);
      if (force || !last || daysSince(last) > STALE_DAYS) {
        const query = isISIN(b.item.key) ? b.item.key : b.item.id || b.item.key;
        const hint = b.item.id || undefined;
        const r = await historyByQuery(query, b.item.currency, hint, RANGE, INTERVAL).catch(
          () => null,
        );
        if (r && r.points.length > 0) {
          let points = r.points;
          // Convert the native price history into the home currency via historic
          // FX, so a USD-listed benchmark is comparable to a EUR holding.
          const native = (r.currency || "").toUpperCase();
          if (native && native !== HOME) {
            const fx = await fxSeries(native, HOME, points[0].date);
            if (fx.length > 0) {
              points = points.map((p) => {
                const rate = rateAt(fx, p.date);
                return rate ? { date: p.date, close: p.close * rate } : p;
              });
            }
          }
          // Replace existing rows so a currency/resolution change doesn't leave
          // stale native-currency points mixed in.
          await supabase.from("benchmark_history").delete().eq("benchmark_id", b.id);
          await supabase.from("benchmark_history").insert(
            points.map((p) => ({
              benchmark_id: b.id,
              date: p.date,
              close: p.close,
              currency: HOME,
            })),
          );
        }
      }
    }

    // Read the MOST RECENT rows (PostgREST caps at ~1000): descending + limit,
    // then reverse to ascending — otherwise we'd return the oldest rows, years
    // before the chart window, and every benchmark would flat-line at 0%.
    const { data } = await supabase
      .from("benchmark_history")
      .select("date, close")
      .eq("benchmark_id", b.id)
      .order("date", { ascending: false })
      .limit(1000);
    out[b.id] = ((data ?? []) as { date: string; close: number | string }[])
      .map((r) => ({ date: r.date, close: Number(r.close) }))
      .reverse();
  }

  return Response.json({ benchmarks: out });
}
