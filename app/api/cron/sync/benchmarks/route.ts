// Force-refresh all cached benchmark history (delegates to /api/benchmarks which
// holds the fetch+store logic). POST only with `Authorization: Bearer
// $CRON_SECRET`.

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
  try {
    const r = await fetch(`${origin}/api/benchmarks?force=1`);
    return Response.json({ ok: r.ok });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export const POST = handle;
