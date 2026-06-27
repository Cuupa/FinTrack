"use client";

// Fetches real history for the selected benchmarks and returns them as
// normalised-ready CompareSeries for PerformanceChart.

import { useMemo } from "react";
import { useHistory } from "@/lib/history/use-history";
import { BENCHMARKS } from "@/lib/finance/benchmarks";
import type { CompareSeries } from "./performance-chart";

export function useBenchmarkCompare(
  selected: string[],
  timeframe: string,
  base: string,
): CompareSeries[] {
  const chosen = useMemo(
    () => BENCHMARKS.filter((b) => selected.includes(b.id)),
    [selected],
  );
  const items = useMemo(() => chosen.map((b) => b.item), [chosen]);
  const { histories } = useHistory(items, timeframe, base);

  return useMemo(
    () =>
      chosen.map((b) => ({
        label: b.label,
        color: b.color,
        points: (histories[b.item.key] ?? []).map((p) => ({ date: p.date, value: p.close })),
      })),
    [chosen, histories],
  );
}
