"use client";

// Keeps the signed-in user's *live* shares up to date. Whenever their portfolio
// changes, it rebuilds the stored payload of each live share — using that
// share's own chosen portfolios (payload.portfolioIds) and incognito setting —
// so viewers see the latest after the owner next uses the app. Renders nothing.
// Mounted on the dashboard, where price history is available.

import { useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useLivePrices } from "@/lib/live/live-prices-context";
import { useCatalog } from "@/lib/catalog/catalog-context";
import { quoteItemFor } from "@/lib/finance/prices";
import { useHistory } from "@/lib/history/use-history";
import { getSupabaseClient } from "@/lib/supabase/client";
import { buildShareSource } from "@/lib/share/use-share-source";
import { buildSharePayload, type SharePayload } from "@/lib/share/share";

export function LiveShareSync() {
  const { user } = useAuth();
  const { data, allTransactions } = usePortfolio();
  const { valuation } = useLivePrices();
  const { version } = useCatalog();
  const currency = data.profile.currency;
  const lastKey = useRef<string>("");

  const histItems = useMemo(
    () => data.assets.map(quoteItemFor).filter((x): x is NonNullable<typeof x> => x !== null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.assets, version],
  );
  const { histories, loading } = useHistory(histItems, "MAX", currency);

  const txSig = allTransactions
    .map((t) => `${t.id}:${t.quantity}:${t.price}:${t.portfolioId}`)
    .join(",");

  useEffect(() => {
    if (!user || loading || allTransactions.length === 0) return;
    const key = `${txSig}|${data.profile.name}`;
    if (key === lastKey.current) return;
    lastKey.current = key;

    const supabase = getSupabaseClient();
    if (!supabase) return;
    let cancelled = false;

    void (async () => {
      const { data: rows } = await supabase
        .from("shared_portfolios")
        .select("id, payload")
        .eq("owner", user.id)
        .eq("mode", "live");
      if (cancelled || !rows || rows.length === 0) return;

      for (const row of rows as { id: string; payload: SharePayload }[]) {
        const portfolioIds = row.payload?.portfolioIds ?? null;
        const transactions =
          portfolioIds === null
            ? allTransactions
            : allTransactions.filter((t) => portfolioIds.includes(t.portfolioId));
        const source = buildShareSource({
          assets: data.assets,
          transactions,
          valuation,
          histories,
          ownerName: data.profile.name ?? null,
          currency,
          portfolioIds,
        });
        const payload = buildSharePayload(source, !!row.payload?.incognito, true);
        await supabase.from("shared_portfolios").update({ payload }).eq("id", row.id);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading, txSig, histories]);

  return null;
}
