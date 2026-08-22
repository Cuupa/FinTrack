import { describe, expect, it } from "vitest";
import { portfolioRiskStats } from "../lib/finance/stats";
import { compositeLevelSeries } from "../lib/finance/returns";
import type { HistoryMap } from "../lib/history/history";
import type { Asset } from "../lib/types";

// Regression: one freshly listed holding (a two-point history) used to poison
// the whole portfolio's aggregate risk. portfolioRiskStats truncated every
// return series to the shortest one, so a single in-window return collapsed the
// correlation matrix to zeros (corrcoef returns 0 for n < 2, diagonal included)
// -> volatility 0, Sharpe/Sortino null; compositeLevelSeries intersected all
// dates, so the same stub shrank the shared window below 3 and killed the
// portfolio beta/alpha. Both must degrade over the stub, not on it.

function asset(over: Partial<Asset> & Pick<Asset, "id">): Asset {
  return {
    isin: null,
    wkn: null,
    symbol: null,
    name: "Test",
    currency: null,
    type: "STOCK",
    notes: null,
    ...over,
  };
}

/** Daily points, one per listed YYYY-MM-DD, ascending. */
function hist(points: [string, number][]) {
  return points.map(([date, close]) => ({ date, close }));
}

describe("portfolioRiskStats — a stub holding must not zero the aggregate", () => {
  // Asset A: one close per month across 14 distinct months -> 13 monthly returns.
  const aPoints: [string, number][] = Array.from({ length: 14 }, (_, i) => {
    const month = String((i % 12) + 1).padStart(2, "0");
    const year = 2024 + Math.floor(i / 12);
    return [`${year}-${month}-15`, 100 + i * 3 + (i % 2 === 0 ? 5 : -4)];
  });
  // Asset B: six daily points (>= MIN_REAL_MONTHS, so "real") but across only
  // two calendar months -> a single monthly return. This is the stub.
  const bPoints: [string, number][] = [
    ["2025-01-05", 50],
    ["2025-01-12", 51],
    ["2025-01-20", 52],
    ["2025-02-03", 53],
    ["2025-02-10", 54],
    ["2025-02-18", 55],
  ];

  const A = asset({ id: "a", isin: "AAAA", name: "Mature" });
  const B = asset({ id: "b", isin: "BBBB", name: "Freshly listed" });
  const history: HistoryMap = { AAAA: hist(aPoints), BBBB: hist(bPoints) };

  it("produces a positive volatility and a real Sharpe despite the stub", () => {
    const pr = portfolioRiskStats(
      [
        { asset: A, marketValue: 8000 },
        { asset: B, marketValue: 2000 },
      ],
      2,
      history,
    );
    expect(pr).not.toBeNull();
    // The bug returned exactly 0 here (and a null Sharpe).
    expect(pr!.volatility).toBeGreaterThan(0);
    expect(pr!.sharpe).not.toBeNull();
    expect(Number.isFinite(pr!.volatility)).toBe(true);
  });

  it("still works when the stub is the only other holding of two", () => {
    // Two mature holdings alone must also be fine (baseline, equal lengths).
    const C = asset({ id: "c", isin: "CCCC", name: "Mature two" });
    const pr = portfolioRiskStats(
      [
        { asset: A, marketValue: 5000 },
        { asset: C, marketValue: 5000 },
      ],
      2,
      { AAAA: hist(aPoints), CCCC: hist(aPoints.map(([d, v]) => [d, v * 1.1] as [string, number])) },
    );
    expect(pr!.volatility).toBeGreaterThan(0);
    expect(pr!.sharpe).not.toBeNull();
  });
});

describe("compositeLevelSeries — drops the stub, does not return empty", () => {
  const mature = (mult: number) =>
    Array.from({ length: 8 }, (_, i) => ({ date: `2025-0${i + 1}-15`, value: (100 + i * 2) * mult }));

  it("keeps the shared window of the mature holdings when a two-point stub is present", () => {
    const stub = [
      { date: "2025-11-03", value: 10 },
      { date: "2025-11-10", value: 11 },
    ];
    const withStub = compositeLevelSeries([
      { levels: mature(1), weight: 8000 },
      { levels: mature(1.2), weight: 6000 },
      { levels: stub, weight: 500 },
    ]);
    // The bug returned [] here (intersection of dates was 0).
    expect(withStub.length).toBeGreaterThanOrEqual(3);
    // Identical to dropping the stub and renormalising over the survivors.
    const withoutStub = compositeLevelSeries([
      { levels: mature(1), weight: 8000 },
      { levels: mature(1.2), weight: 6000 },
    ]);
    expect(withStub).toEqual(withoutStub);
  });

  it("single holding is rescaled to start at 1.0 (unchanged guarantee)", () => {
    const one = compositeLevelSeries([{ levels: mature(3), weight: 1000 }]);
    expect(one[0].value).toBeCloseTo(1, 10);
    expect(one.length).toBe(8);
  });
});
