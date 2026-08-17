import { describe, expect, it } from "vitest";
import { validateExpiresAt } from "../lib/share/share";
import { buildSankeyShare, isSankeyShare, normalizeSankeyShare } from "../lib/share/sankey-share";
import type { SankeyGraph } from "../lib/finance/spending";

const GRAPH: SankeyGraph = {
  nodes: [
    { name: "Total", column: "hub" },
    { name: "Salary", column: "source" },
    { name: "Rent", column: "target" },
    { name: "Savings", column: "target" },
  ],
  links: [
    { source: 1, target: 0, value: 1000 },
    { source: 0, target: 2, value: 600 },
    { source: 0, target: 3, value: 400 },
  ],
};
const LABELS = { total: "Total", savings: "Savings", shortfall: "Shortfall" };

const NOW = new Date("2026-07-04T12:00:00.000Z");

describe("validateExpiresAt", () => {
  it("treats a missing value as never expires (null)", () => {
    expect(validateExpiresAt(undefined, NOW)).toBeNull();
    expect(validateExpiresAt(null, NOW)).toBeNull();
  });

  it("accepts a future date and normalises it to an ISO string", () => {
    const future = new Date(NOW.getTime() + 60_000).toISOString();
    expect(validateExpiresAt(future, NOW)).toBe(future);
  });

  it("rejects a date in the past", () => {
    const past = new Date(NOW.getTime() - 60_000).toISOString();
    expect(validateExpiresAt(past, NOW)).toBeUndefined();
  });

  it("rejects the current instant (must be strictly in the future)", () => {
    expect(validateExpiresAt(NOW.toISOString(), NOW)).toBeUndefined();
  });

  it("rejects an unparseable string", () => {
    expect(validateExpiresAt("not a date", NOW)).toBeUndefined();
  });

  it("rejects a non-string value", () => {
    expect(validateExpiresAt(12345, NOW)).toBeUndefined();
  });
});

describe("Sankey share", () => {
  const base = {
    graph: GRAPH,
    labels: LABELS,
    income: 1000,
    expense: 600,
    net: 400,
    currency: "EUR",
    ownerName: "Simon",
    period: "2026-03",
    periodKind: "month" as const,
  };

  it("a full share keeps absolute figures and link values", () => {
    const p = buildSankeyShare({ ...base, incognito: false });
    expect(p.kind).toBe("sankey");
    expect(p.income).toBe(1000);
    expect(p.net).toBe(400);
    expect(p.graph.links[0].value).toBe(1000);
    expect(isSankeyShare(p)).toBe(true);
  });

  it("an incognito share drops absolute figures and scales links to throughput", () => {
    const p = buildSankeyShare({ ...base, incognito: true });
    expect(p.income).toBeNull();
    expect(p.expense).toBeNull();
    expect(p.net).toBeNull();
    // Income side sums to the full throughput -> 1.0 as a fraction.
    expect(p.graph.links[0].value).toBe(1);
    expect(p.graph.links[1].value).toBe(0.6);
  });

  it("normalizes only genuine sankey payloads", () => {
    expect(normalizeSankeyShare(buildSankeyShare({ ...base, incognito: false }))).not.toBeNull();
    expect(normalizeSankeyShare({ kind: "portfolio", holdings: [] })).toBeNull();
    expect(normalizeSankeyShare(null)).toBeNull();
    expect(isSankeyShare({ kind: "sankey" })).toBe(false);
  });
});
