// "Fetch all": triggers every data refresh in one call — prices, ETF
// constituents, classifications (sector/region) and benchmark history. POST only
// with `Authorization: Bearer $CRON_SECRET`; it forwards the secret to each
// sibling endpoint. The per-instrument/specific endpoints still exist for
// targeted refreshes; this is the bulk option.
//
// Note: this runs several syncs sequentially, so it can be slow — if it times
// out, call the individual endpoints instead.

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function handle(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const origin = new URL(req.url).origin;
  const secret = process.env.CRON_SECRET;
  const headers: Record<string, string> = secret
    ? { authorization: `Bearer ${secret}` }
    : {};

  const results: Record<string, unknown> = {};

  const post = async (path: string) => {
    try {
      const r = await fetch(`${origin}${path}`, { method: "POST", headers });
      results[path] = r.ok ? await r.json() : { error: r.status };
    } catch (e) {
      results[path] = { error: e instanceof Error ? e.message : String(e) };
    }
  };

  // Each resource sync is secret-gated; the secret is forwarded. The query
  // string (e.g. ?revalidate=1) is forwarded only to prices, whose daily
  // self-heal / re-resolve behavior it controls.
  await post("/api/cron/sync/prices" + new URL(req.url).search);
  await post("/api/cron/sync/constituents");
  await post("/api/cron/sync/classifications");
  await post("/api/cron/sync/names");
  await post("/api/cron/sync/etf-breakdowns");
  await post("/api/cron/sync/benchmarks");
  await post("/api/cron/sync/shared-portfolios");
  await post("/api/cron/sync/error-logs");
  // The billing sub-sync resolves its own Stripe key (app_settings DB value
  // or the STRIPE_SECRET_KEY env fallback, see lib/server/billing-keys.ts)
  // and skips cleanly (200 with `skipped`) when neither is set, so it's
  // always posted here rather than gated on the env var alone.
  await post("/api/cron/sync/billing");
  await post("/api/cron/sync/retention");

  return Response.json({ ok: true, results });
}

export const POST = handle;
