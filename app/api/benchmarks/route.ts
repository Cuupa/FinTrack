// Benchmark price history, served from the DB cache (public.benchmark_history)
// so we don't hit Yahoo on every chart view. A benchmark is (re)fetched from
// Yahoo only when its cache is missing or stale — and only if the service role
// is available to write; otherwise we return whatever is cached.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { historyByQuery, isISIN } from "@/lib/server/yahoo";
import { BENCHMARKS } from "@/lib/finance/benchmarks";

export const dynamic = "force-dynamic";

const STALE_DAYS = 4; // markets close weekends; refresh when older than this
const RANGE = "10y";
const INTERVAL = "1d";

function daysSince(isoDate: string): number {
  return (Date.now() - new Date(isoDate + "T00:00:00Z").getTime()) / 86_400_000;
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
          await supabase
            .from("benchmark_history")
            .upsert(
              r.points.map((p) => ({ benchmark_id: b.id, date: p.date, close: p.close })),
              { onConflict: "benchmark_id,date" },
            );
        }
      }
    }

    const { data } = await supabase
      .from("benchmark_history")
      .select("date, close")
      .eq("benchmark_id", b.id)
      .order("date", { ascending: true });
    out[b.id] = ((data ?? []) as { date: string; close: number | string }[]).map((r) => ({
      date: r.date,
      close: Number(r.close),
    }));
  }

  return Response.json({ benchmarks: out });
}
