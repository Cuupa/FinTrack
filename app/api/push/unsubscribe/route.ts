// Remove a browser push subscription for the authed user (F5). Scoped to the
// user's own rows (endpoint + user_id) so a token can only delete its own.

import { supabasePublishable, supabaseSecret } from "@/lib/server/supabase-keys";

export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const authz = req.headers.get("authorization") ?? "";
  const token = authz.startsWith("Bearer ") ? authz.slice("Bearer ".length).trim() : "";
  if (!token) return Response.json({ error: "unauthorized" }, { status: 401 });

  const verifier = supabasePublishable();
  if (!verifier) return Response.json({ error: "not configured" }, { status: 503 });
  const { data: userData, error: userErr } = await verifier.auth.getUser(token);
  const user = userData?.user;
  if (userErr || !user) return Response.json({ error: "unauthorized" }, { status: 401 });

  let endpoint: unknown;
  try {
    endpoint = ((await req.json()) as { endpoint?: unknown }).endpoint;
  } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  if (typeof endpoint !== "string") return Response.json({ error: "invalid body" }, { status: 400 });

  const admin = supabaseSecret();
  if (!admin) return Response.json({ error: "not configured" }, { status: 503 });

  const { error } = await admin
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", endpoint);
  if (error) return Response.json({ error: "db error" }, { status: 500 });

  return Response.json({ ok: true });
}
