"use client";

// Fetches confirmed announced dividend ex/pay dates for a set of holdings
// (COMPETITION.md F4), from /api/dividends/calendar. Only fires when `enabled`
// (the `dividendCalendar` feature flag) is on, so a disabled flag spends no
// Yahoo crumb calls. Same on-demand, settle-either-way shape as useDividends;
// the previous map is kept on a failed/empty response.

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { HistItem } from "./history";

export type AnnouncedMap = Record<string, { exDate: string | null; payDate: string | null }>;

export function useAnnouncedDividends(items: HistItem[], enabled: boolean): AnnouncedMap {
  const sig = useMemo(
    () => (enabled ? items.map((i) => `${i.key}:${i.source}:${i.id}`).sort().join(",") : ""),
    [items, enabled],
  );

  const [state, setState] = useState<{ sig: string; map: AnnouncedMap }>({ sig: "", map: {} });

  useEffect(() => {
    if (!enabled || items.length === 0) return;
    let cancelled = false;
    const run = async () => {
      let fetched: AnnouncedMap | null = null;
      try {
        const res = await apiFetch("/api/dividends/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items }),
        });
        const json = res.ok ? ((await res.json()) as { announced?: AnnouncedMap }) : null;
        fetched = json?.announced ?? null;
      } catch {
        fetched = null;
      }
      if (!cancelled) setState((s) => ({ sig, map: fetched ?? s.map }));
    };
    const t = setTimeout(run, 0);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return enabled ? state.map : {};
}
