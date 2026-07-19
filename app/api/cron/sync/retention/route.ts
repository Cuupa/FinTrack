// Retention for two server-side caches that would otherwise grow unbounded:
//
//   - simulation_runs (supabase/migrations/0024_simulation_runs.sql): rows
//     are a params-hash cache keyed by (user_id, params_hash) so an
//     identical Monte Carlo run reuses the stored result. Recompute is
//     client-side and cheap, so a stale cache entry is pure dead weight
//     once nobody has rerun those params in 90 days.
//   - instrument_history (supabase/migrations/0022_instrument_history.sql):
//     rows are replaced per (price_key, range) on every /api/history
//     refresh, so only series nobody has requested in 60 days remain
//     stale. /api/history refetches on demand, so deleting old rows is
//     always safe (it is a pure cache, never the source of truth).
//   - stripe_events (supabase/migrations/0066_billing.sql): the webhook
//     idempotency ledger. Each row only guards against a duplicate delivery of
//     the same event id; Stripe retries within hours, so after 30 days a row
//     is dead weight (MONETIZATION.md section 3).
//
// POST only with `Authorization: Bearer $CRON_SECRET`, same shape as the
// other app/api/cron/sync/* sub-syncs. middleware.ts already enforces the
// secret at the edge for the whole /api/cron/* tree; this repeats the check
// so the route is still safe if ever called directly in a context that
// skips middleware (matches every other sub-sync route's own `authorized`
// check, e.g. app/api/cron/sync/error-logs/route.ts).

import { supabaseSecret } from "@/lib/server/supabase-keys";

export const dynamic = "force-dynamic";

const SIMULATION_RETENTION_DAYS = 90;
const HISTORY_RETENTION_DAYS = 60;
const STRIPE_EVENTS_RETENTION_DAYS = 30;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const supabase = supabaseSecret();
  if (!supabase) {
    return Response.json({ error: "secret key not configured" }, { status: 500 });
  }

  const simulationCutoff = new Date(
    Date.now() - SIMULATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { error: simulationError, count: simulationRuns } = await supabase
    .from("simulation_runs")
    .delete({ count: "exact" })
    .lt("created_at", simulationCutoff);
  if (simulationError) return Response.json({ error: simulationError.message }, { status: 500 });

  const historyCutoff = new Date(
    Date.now() - HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { error: historyError, count: instrumentHistory } = await supabase
    .from("instrument_history")
    .delete({ count: "exact" })
    .lt("synced_at", historyCutoff);
  if (historyError) return Response.json({ error: historyError.message }, { status: 500 });

  const stripeEventsCutoff = new Date(
    Date.now() - STRIPE_EVENTS_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const { error: stripeEventsError, count: stripeEvents } = await supabase
    .from("stripe_events")
    .delete({ count: "exact" })
    .lt("received_at", stripeEventsCutoff);
  if (stripeEventsError) return Response.json({ error: stripeEventsError.message }, { status: 500 });

  return Response.json({
    ok: true,
    deleted: {
      simulationRuns: simulationRuns ?? 0,
      instrumentHistory: instrumentHistory ?? 0,
      stripeEvents: stripeEvents ?? 0,
    },
  });
}

export const POST = handle;
