// Create a shared portfolio snapshot. Stores the (already mode-appropriate)
// payload server-side under a short random id, so the share link is short.
// This now writes with the secret key: the open `with check (true)` insert
// policy that used to make the publishable key sufficient is being removed
// (migration 0031 — an unauthenticated write policy on a public table is an
// abuse vector with no rate limiting of its own), so writes go through the
// service-role-equivalent client and the app enforces the size cap + rate
// limit below itself.

import { normalizeShare, validateExpiresAt } from "@/lib/share/share";
import { supabaseSecret } from "@/lib/server/supabase-keys";

export const dynamic = "force-dynamic";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Reject payloads above this size outright (also enforced by a DB check constraint). */
const MAX_PAYLOAD_BYTES = 256 * 1024;

/** Short, URL-safe, hard-to-guess id (~62^10 space). */
function shortId(len = 10): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export async function POST(req: Request): Promise<Response> {
  const supabase = supabaseSecret();
  if (!supabase) {
    return Response.json({ error: "sharing not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const b = body as { payload?: unknown; owner?: unknown; mode?: unknown; expiresAt?: unknown };
  const payload = normalizeShare(b?.payload);
  if (!payload) return Response.json({ error: "invalid payload" }, { status: 400 });
  if (JSON.stringify(payload).length > MAX_PAYLOAD_BYTES) {
    return Response.json({ error: "payload too large" }, { status: 413 });
  }
  const owner = typeof b.owner === "string" ? b.owner : null;
  const mode = b.mode === "live" ? "live" : "snapshot";
  const expiresAt = validateExpiresAt(b.expiresAt);
  if (expiresAt === undefined) return Response.json({ error: "invalid expiry" }, { status: 400 });

  // Best-effort rate limit, deliberately DB-side: an in-process counter is
  // worthless on serverless (every invocation can be a cold instance with its
  // own memory), so we count recent rows in Postgres instead.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
  const { count: globalCount } = await supabase
    .from("shared_portfolios")
    .select("id", { count: "exact", head: true })
    .gt("created_at", oneMinuteAgo);
  if ((globalCount ?? 0) >= 60) {
    return Response.json({ error: "too many shares created, try again later" }, { status: 429 });
  }
  if (ip) {
    const { count: ipCount } = await supabase
      .from("shared_portfolios")
      .select("id", { count: "exact", head: true })
      .eq("creator_ip", ip)
      .gt("created_at", oneMinuteAgo);
    if ((ipCount ?? 0) >= 5) {
      return Response.json({ error: "too many shares created, try again later" }, { status: 429 });
    }
  }

  // Retry a couple of times on the (astronomically unlikely) id collision.
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = shortId();
    const { error } = await supabase
      .from("shared_portfolios")
      .insert({ id, payload, owner, mode, creator_ip: ip, expires_at: expiresAt });
    if (!error) return Response.json({ id, expiresAt });
    if (!/duplicate|unique/i.test(error.message)) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }
  return Response.json({ error: "could not allocate id" }, { status: 500 });
}
