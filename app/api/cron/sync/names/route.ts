// Name-resolution cron. Re-resolves the "official" name for catalog
// instruments via the same multi-source lookup that powers auto-import
// (lib/server/search.ts), so the shared `instruments.name` stays accurate
// instead of relying on a client-side "official names" button.
//
// POST only (mutates the catalog) with `Authorization: Bearer $CRON_SECRET`.
// Requires the secret key: it updates instruments, and RLS grants no update
// policy there for authenticated/anon. Processes a capped batch per call,
// tracked via the `name_synced_at` staleness marker so it is safely
// re-runnable; the response reports whether more rows remain.
//
// CASH and COMMODITY are excluded: CASH has no resolvable identifier, and
// COMMODITY names are authoritative (see lib/import/resolve-names.ts). The
// lookup can mis-resolve a bare metal ticker like XAU to Tether Gold or an
// E-mini future, so it must never rename a COMMODITY row.

import { pickBest, searchInstruments } from "@/lib/server/search";
import { supabaseSecret } from "@/lib/server/supabase-keys";

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
  const supabase = supabaseSecret();
  if (!supabase) {
    return Response.json({ error: "secret key not configured" }, { status: 500 });
  }

  const staleBefore = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await supabase
    .from("instruments")
    .select("id, isin, wkn, symbol, name, type")
    .not("type", "in", "(CASH,COMMODITY)")
    .or(`name_synced_at.is.null,name_synced_at.lt.${staleBefore}`)
    .order("name_synced_at", { ascending: true, nullsFirst: true })
    .limit(BATCH);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const now = new Date().toISOString();

  const updated = await runPool(rows ?? [], async (r) => {
    const q = r.isin || r.symbol || r.wkn;
    if (!q) {
      // No identifier to resolve by; still stamp it so it is not retried every run.
      await supabase.from("instruments").update({ name_synced_at: now }).eq("id", r.id);
      return false;
    }
    let official: string | null = null;
    try {
      const merged = await searchInstruments(q);
      const best = pickBest(q, merged);
      // Only trust a same-type resolution: a cross-type hit (e.g. a metal
      // ticker resolving to a crypto) must never rename a catalog row.
      if (best && best.name && best.name.trim() && (!best.type || best.type === r.type)) {
        official = best.name.trim();
      }
    } catch {
      /* lookup failed; just stamp and move on */
    }
    const patch: { name_synced_at: string; name?: string } = { name_synced_at: now };
    const changed = official != null && official !== r.name;
    if (changed) patch.name = official as string;
    const { error: upErr } = await supabase.from("instruments").update(patch).eq("id", r.id);
    return !upErr && changed;
  });

  // A full batch likely means more rows are waiting; caller should re-run.
  const remaining = (rows?.length ?? 0) === BATCH;

  return Response.json({ ok: true, updated, processed: rows?.length ?? 0, remaining });
}

export const POST = handle;
