// Fetch a shared portfolio snapshot by its short id. Public-readable (the share
// link is the capability); the stored payload is already mode-appropriate
// (incognito snapshots contain no absolute figures).

import { normalizeShare } from "@/lib/share/share";
import { supabasePublishable } from "@/lib/server/supabase-keys";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  // shared_portfolios is world-readable by id (select-only RLS policy) — no bypass needed.
  const supabase = supabasePublishable();
  if (!supabase || !id) return Response.json({ found: false });

  try {
    const { data } = await supabase
      .from("shared_portfolios")
      .select("payload")
      .eq("id", id)
      .maybeSingle();
    const payload = normalizeShare((data as { payload?: unknown } | null)?.payload);
    if (!payload) return Response.json({ found: false });
    return Response.json({ found: true, payload });
  } catch {
    return Response.json({ found: false });
  }
}
