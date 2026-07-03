// Create a shared portfolio snapshot. Stores the (already mode-appropriate)
// payload server-side under a short random id, so the share link is short.
// The publishable key is enough to write: shared_portfolios' RLS insert
// policy is `with check (true)` (anyone may create a share — the point of a
// share link), so no service-role bypass is needed.

import { normalizeShare } from "@/lib/share/share";
import { supabasePublishable } from "@/lib/server/supabase-keys";

export const dynamic = "force-dynamic";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** Short, URL-safe, hard-to-guess id (~62^10 space). */
function shortId(len = 10): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export async function POST(req: Request): Promise<Response> {
  const supabase = supabasePublishable();
  if (!supabase) {
    return Response.json({ error: "sharing not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const b = body as { payload?: unknown; owner?: unknown; mode?: unknown };
  const payload = normalizeShare(b?.payload);
  if (!payload) return Response.json({ error: "invalid payload" }, { status: 400 });
  const owner = typeof b.owner === "string" ? b.owner : null;
  const mode = b.mode === "live" ? "live" : "snapshot";

  // Retry a couple of times on the (astronomically unlikely) id collision.
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = shortId();
    const { error } = await supabase
      .from("shared_portfolios")
      .insert({ id, payload, owner, mode });
    if (!error) return Response.json({ id });
    if (!/duplicate|unique/i.test(error.message)) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }
  return Response.json({ error: "could not allocate id" }, { status: 500 });
}
