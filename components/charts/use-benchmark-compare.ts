"use client";

// Provides selected benchmarks as CompareSeries for PerformanceChart, reading
// from the DB-backed /api/benchmarks cache (Yahoo is only hit server-side when
// the cache is stale). Fetched benchmarks are memoised so toggling doesn't
// refetch.

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import { BENCHMARKS } from "@/lib/finance/benchmarks";
import type { CompareSeries } from "./performance-chart";

type Hist = Record<string, { date: string; close: number }[]>;

export function useBenchmarkCompare(selected: string[], base: string): CompareSeries[] {
  // Keyed by base currency so switching base refetches in the new currency.
  const [hist, setHist] = useState<Record<string, Hist>>({});
  const byBase = useMemo(() => hist[base] ?? {}, [hist, base]);

  // Only fetch ids we don't already have for this base currency.
  const missing = useMemo(
    () => selected.filter((id) => !(id in byBase)),
    [selected, byBase],
  );
  const missingKey = useMemo(() => [...missing].sort().join(","), [missing]);

  useEffect(() => {
    if (missing.length === 0) return;
    let cancelled = false;
    apiFetch(
      `/api/benchmarks?ids=${encodeURIComponent(missing.join(","))}&base=${encodeURIComponent(base)}`,
    )
      .then((r) => (r.ok ? r.json() : { benchmarks: {} }))
      .then((d: { benchmarks?: Hist }) => {
        if (!cancelled && d.benchmarks)
          setHist((prev) => ({ ...prev, [base]: { ...prev[base], ...d.benchmarks } }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missingKey, base]);

  return useMemo(
    () =>
      BENCHMARKS.filter((b) => selected.includes(b.id)).map((b) => ({
        label: b.label,
        color: b.color,
        points: (byBase[b.id] ?? []).map((p) => ({ date: p.date, value: p.close })),
      })),
    [selected, byBase],
  );
}
