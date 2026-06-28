// Create a shared portfolio snapshot. Stores the (already mode-appropriate)
// payload server-side under a short random id, so the share link is short.
// Requires the service role to write; without it the client falls back to the
// URL-fragment link.

import { createClient } from "@supabase/supabase-js";
import { normalizeShare } from "@/lib/share/share";

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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return Response.json({ error: "sharing not configured" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const payload = normalizeShare((body as { payload?: unknown })?.payload);
  if (!payload) return Response.json({ error: "invalid payload" }, { status: 400 });

  const supabase = createClient(url, serviceKey);
  // Retry a couple of times on the (astronomically unlikely) id collision.
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = shortId();
    const { error } = await supabase.from("shared_portfolios").insert({ id, payload });
    if (!error) return Response.json({ id });
    if (!/duplicate|unique/i.test(error.message)) {
      return Response.json({ error: error.message }, { status: 500 });
    }
  }
  return Response.json({ error: "could not allocate id" }, { status: 500 });
}
