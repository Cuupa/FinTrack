// Shareable cash-flow Sankey snapshots — separate from the portfolio share
// (they answer "where did the money go this period", not "what do I hold").
// They ride the same `shared_portfolios` table and `/api/share` route, but are
// discriminated by `mode = "sankey"` on the row and `kind = "sankey"` in the
// payload, so creating one never voids a portfolio share and vice versa.
//
// A "full" snapshot carries absolute figures; an "incognito" one carries ONLY
// relative link widths (each value is a fraction of the period's throughput) —
// no absolute amount exists in the payload, so the recipient cannot reveal it.

import type { SankeyGraph } from "@/lib/finance/spending";

export interface SankeySharePayload {
  kind: "sankey";
  v: 1;
  incognito: boolean;
  ownerName?: string | null;
  currency: string;
  createdAt: string;
  /** `YYYY-MM` when `periodKind` is "month", else a timeframe token ("3M", …). */
  period: string;
  periodKind: "month" | "timeframe";
  /** The hub/savings/shortfall node names, baked in the owner's locale so the
   *  viewer can color those special nodes regardless of the recipient's locale. */
  labels: { total: string; savings: string; shortfall: string };
  /** Link values are absolute (full) or fractions of throughput (incognito). */
  graph: SankeyGraph;
  /** Absolute figures in base currency, or null in incognito shares. */
  income: number | null;
  expense: number | null;
  net: number | null;
}

export function isSankeyShare(p: unknown): p is SankeySharePayload {
  if (!p || typeof p !== "object") return false;
  const o = p as Partial<SankeySharePayload>;
  return o.kind === "sankey" && Array.isArray(o.graph?.nodes) && Array.isArray(o.graph?.links);
}

/** Validate/normalise an arbitrary object into a SankeySharePayload, or null. */
export function normalizeSankeyShare(p: unknown): SankeySharePayload | null {
  return isSankeyShare(p) ? p : null;
}

function r(n: number, d: number): number {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

export function buildSankeyShare(args: {
  graph: SankeyGraph;
  labels: { total: string; savings: string; shortfall: string };
  income: number;
  expense: number;
  net: number;
  currency: string;
  ownerName: string | null;
  period: string;
  periodKind: "month" | "timeframe";
  incognito: boolean;
}): SankeySharePayload {
  const { graph, labels, income, expense, net, currency, ownerName, period, periodKind, incognito } = args;
  // Both sides of the hub balance, so throughput is the larger of the two.
  const throughput = Math.max(income, expense) || 1;
  const graphOut: SankeyGraph = {
    nodes: graph.nodes,
    links: graph.links.map((l) => ({
      ...l,
      value: incognito ? r(l.value / throughput, 4) : r(l.value, 2),
    })),
  };
  return {
    kind: "sankey",
    v: 1,
    incognito,
    ownerName,
    currency,
    createdAt: new Date().toISOString(),
    period,
    periodKind,
    labels,
    graph: graphOut,
    income: incognito ? null : r(income, 2),
    expense: incognito ? null : r(expense, 2),
    net: incognito ? null : r(net, 2),
  };
}
