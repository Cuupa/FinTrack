// Best-effort per-IP rate limiting for the market-data API proxies, backed by
// a Postgres counter (in-process counters are useless on serverless: each
// invocation can be a fresh cold instance). Fails OPEN when Supabase is not
// configured or the IP is unknown, so Guest Mode and no-Supabase installs keep
// working.

import { supabaseSecret } from "./supabase-keys";

/** Client IP from the proxy header, or null if unknown. */
export function clientIp(req: Request): string | null {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

/**
 * Returns true if the request is allowed, false if it exceeds `limit` per
 * `windowSec`. Fails open on any error or when Supabase/IP is unavailable.
 */
export async function rateLimit(
  route: string,
  req: Request,
  limit: number,
  windowSec = 60,
): Promise<boolean> {
  const ip = clientIp(req);
  const supabase = supabaseSecret();
  if (!supabase || !ip) return true;
  const window = Math.floor(Date.now() / (windowSec * 1000));
  try {
    const { data, error } = await supabase.rpc("rate_limit_hit", {
      p_bucket: `${route}:${ip}:${window}`,
    });
    if (error) return true;
    return typeof data === "number" ? data <= limit : true;
  } catch {
    return true;
  }
}

/** Standard 429 response for a rate-limited request. */
export function tooManyRequests(): Response {
  return Response.json({ error: "rate limited, try again shortly" }, { status: 429 });
}
