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

  // DB-writing syncs (each is secret-gated; the secret is forwarded).
  await post("/api/cron/sync-prices");
  await post("/api/cron/sync-constituents");
  await post("/api/cron/sync-classifications");

  // Benchmarks: force a full refresh of every benchmark's history.
  try {
    const r = await fetch(`${origin}/api/benchmarks?force=1`, { headers });
    results["/api/benchmarks?force=1"] = r.ok ? { ok: true } : { error: r.status };
  } catch (e) {
    results["/api/benchmarks?force=1"] = { error: e instanceof Error ? e.message : String(e) };
  }

  return Response.json({ ok: true, results });
}

export const POST = handle;
