// Well-known benchmarks the user can overlay on the net-worth / asset charts.
// Each is fetched as REAL history via /api/history (broad ETFs by ISIN, indices
// by Yahoo symbol). Comparison is always normalised to %, so the listing
// currency is irrelevant.

import type { HistItem } from "../history/history";
import type { ResolvedMaster } from "../import/resolve-instrument";
import { assetPriceKey } from "../types";

export interface Benchmark {
  id: string;
  label: string;
  color: string;
  item: HistItem;
}

export const BENCHMARKS: Benchmark[] = [
  {
    id: "msci-world",
    label: "MSCI World",
    color: "#3b82f6",
    // iShares Core MSCI World UCITS ETF (IWDA), priced by ISIN.
    item: { key: "IE00B4L5Y983", source: "yahoo", id: "", currency: "EUR" },
  },
  {
    id: "ftse-all-world",
    label: "FTSE All-World",
    color: "#a855f7",
    // Vanguard FTSE All-World (VWCE / A2PKXG).
    item: { key: "IE00BK5BQT80", source: "yahoo", id: "", currency: "EUR" },
  },
  {
    id: "dax",
    label: "DAX",
    color: "#eab308",
    item: { key: "^GDAXI", source: "yahoo", id: "^GDAXI", currency: "EUR" },
  },
  {
    id: "sp500",
    label: "S&P 500",
    color: "#ef4444",
    item: { key: "^GSPC", source: "yahoo", id: "^GSPC", currency: "USD" },
  },
  {
    id: "stoxx-600",
    label: "STOXX Europe 600",
    color: "#14b8a6",
    item: { key: "^STOXX", source: "yahoo", id: "^STOXX", currency: "EUR" },
  },
];

// Palette for user-added custom benchmarks, cycled by insertion order. Kept
// visually distinct from the 5 curated hex colors above.
const CUSTOM_BENCHMARK_COLORS = [
  "#22c55e",
  "#ec4899",
  "#0ea5e9",
  "#f97316",
  "#84cc16",
  "#06b6d4",
  "#f43f5e",
];

/** Cycles through a small palette distinct from the curated benchmark colors. */
export function customBenchmarkColor(index: number): string {
  return CUSTOM_BENCHMARK_COLORS[index % CUSTOM_BENCHMARK_COLORS.length];
}

/**
 * Builds a user-added custom benchmark overlay from a resolved instrument
 * (ISIN/WKN/symbol lookup, same resolver as the add-asset/watchlist/savings-plan
 * flows). Returns null when the resolved price key already matches an existing
 * benchmark's underlying price key (`item.key`) — curated or already-added
 * custom — so the same instrument can't be added twice. Compared against
 * `item.key` rather than `id` because the curated entries' `id` is an
 * arbitrary slug ("msci-world"), not the ISIN/symbol the price is keyed by.
 */
export function buildCustomBenchmark(
  master: ResolvedMaster,
  existing: Benchmark[],
): Benchmark | null {
  const id = assetPriceKey(master);
  if (existing.some((b) => b.item.key === id)) return null;
  return {
    id,
    label: master.name,
    color: customBenchmarkColor(existing.length),
    item: { key: id, source: "yahoo", id: "", currency: master.currency || "EUR" },
  };
}
