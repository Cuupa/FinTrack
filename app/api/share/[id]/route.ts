// Fetch a shared portfolio snapshot by its short id. Public-readable (the share
// link is the capability); the stored payload is already mode-appropriate
// (incognito snapshots contain no absolute figures).

import { createClient } from "@supabase/supabase-js";
import { normalizeShare } from "@/lib/share/share";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon || !id) return Response.json({ found: false });

  try {
    const supabase = createClient(url, anon);
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
