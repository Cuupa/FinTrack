// Admin trigger for the price-sync cron (app/api/cron/sync/prices/route.ts).
//
// Body { instrumentId } — revalidate one row:
//   STOCK/ETF: null that row's quote_id + last_price via the secret client,
//   so the hint-based fast path in syncEquities() sees no hint and resolves
//   the listing from scratch (the same "self-heal" the daily 03:00 UTC /
//   ?revalidate=1 sweep does for a stuck mis-resolved quote_id — see
//   CLAUDE.md's cron notes) — then trigger a sync so it happens immediately
//   instead of waiting for the next cron run.
//   COMMODITY (and anything else): the stored quote_id is authoritative by
//   design (a bare metal ticker mis-resolves via Yahoo search — the gold
//   1.42 EUR incident) — never nulled. Just trigger the sync.
//
// Body {} (no instrumentId) — revalidate all: forwards ?revalidate=1 to the
// prices sync, the existing bulk self-heal that drops every STOCK/ETF row's
// hint for one run.
//
// The trigger re-enters /api/cron/sync/prices over HTTP (same self-call
// pattern as app/api/cron/sync/route.ts: origin from the request URL,
// CRON_SECRET forwarded as a Bearer header) rather than importing its
// handler directly, since that route doesn't export a callable outside its
// POST binding. Without CRON_SECRET configured, that self-call would carry
// no real authorization boundary (the sync route's own check only requires
// the secret when one is set) — a fully unauthenticated admin action ending
// up as a fully unauthenticated outbound sync, so this fails closed with a
// clear error instead of silently calling through.

import { audit, requireAdmin } from "@/lib/server/require-admin";
import { supabaseSecret } from "@/lib/server/supabase-keys";

export const dynamic = "force-dynamic";

interface InstrumentRow {
  id: string;
  type: string;
  quote_id: string | null;
  last_price: number | string | null;
}

async function triggerSync(origin: string, secret: string, revalidateAll: boolean): Promise<unknown> {
  const qs = revalidateAll ? "?revalidate=1" : "";
  try {
    const res = await fetch(`${origin}/api/cron/sync/prices${qs}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    });
    return res.ok ? await res.json() : { error: res.status };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function POST(req: Request): Promise<Response> {
  const auth = await requireAdmin(req);
  if (!auth.ok) return auth.res;

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return Response.json(
      { error: "CRON_SECRET is not configured on this deployment; price sync cannot be triggered" },
      { status: 503 },
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    raw = {};
  }
  const body = (raw ?? {}) as Record<string, unknown>;
  const instrumentId = typeof body.instrumentId === "string" && body.instrumentId ? body.instrumentId : null;

  const admin = supabaseSecret();
  if (!admin) return Response.json({ error: "admin not configured" }, { status: 503 });

  const actor = { userId: auth.userId, email: auth.email };
  const origin = new URL(req.url).origin;

  if (!instrumentId) {
    const result = await triggerSync(origin, secret, true);
    await audit(actor, "price.revalidate", "all", null, { revalidateAll: true });
    return Response.json({ ok: true, result });
  }

  const { data, error } = await admin
    .from("instruments")
    .select("id, type, quote_id, last_price")
    .eq("id", instrumentId)
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "instrument not found" }, { status: 404 });
  const before = data as InstrumentRow;

  const isSelfHealable = before.type === "STOCK" || before.type === "ETF";
  if (isSelfHealable) {
    const { error: updateError } = await admin
      .from("instruments")
      .update({ quote_id: null, last_price: null })
      .eq("id", instrumentId);
    if (updateError) return Response.json({ error: updateError.message }, { status: 500 });
  }

  const result = await triggerSync(origin, secret, false);
  await audit(
    actor,
    "price.revalidate",
    instrumentId,
    { quoteId: before.quote_id, lastPrice: before.last_price },
    isSelfHealable
      ? { quoteId: null, lastPrice: null }
      : { quoteId: before.quote_id, lastPrice: before.last_price },
  );
  return Response.json({ ok: true, result });
}
