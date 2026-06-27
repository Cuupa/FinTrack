// Well-known benchmarks the user can overlay on the net-worth / asset charts.
// Each is fetched as REAL history via /api/history (broad ETFs by ISIN, indices
// by Yahoo symbol). Comparison is always normalised to %, so the listing
// currency is irrelevant.

import type { HistItem } from "../history/history";

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
