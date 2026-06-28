"use client";

// Keeps the signed-in user's *live* shares up to date. Whenever their portfolio
// snapshot changes, it rewrites the stored payload of each of their live shares
// (preserving each one's incognito setting), so viewers see the latest after the
// owner next uses the app. Renders nothing. Mounted on the dashboard, where the
// share source (incl. price history) is computed.

import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useShareSource } from "@/lib/share/use-share-source";
import { buildSharePayload, type SharePayload } from "@/lib/share/share";

export function LiveShareSync() {
  const { user } = useAuth();
  const { source, loading } = useShareSource();
  const lastKey = useRef<string>("");

  useEffect(() => {
    if (!user || loading || source.holdings.length === 0) return;
    // Cheap change-detector so we don't rewrite on every render.
    const key = `${source.netWorth}|${source.twr}|${source.holdings.length}|${source.ownerName}`;
    if (key === lastKey.current) return;
    lastKey.current = key;

    const supabase = getSupabaseClient();
    if (!supabase) return;
    let cancelled = false;

    void (async () => {
      const { data } = await supabase
        .from("shared_portfolios")
        .select("id, payload")
        .eq("owner", user.id)
        .eq("mode", "live");
      if (cancelled || !data || data.length === 0) return;

      for (const row of data as { id: string; payload: SharePayload }[]) {
        const incognito = !!row.payload?.incognito;
        const payload = buildSharePayload(source, incognito, true);
        await supabase.from("shared_portfolios").update({ payload }).eq("id", row.id);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, loading, source]);

  return null;
}
