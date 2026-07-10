import { describe, expect, it } from "vitest";
import { byCustom } from "../lib/finance/allocation";
import type { HoldingSummary } from "../lib/finance/portfolio";
import type { Asset } from "../lib/types";

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

function holding(id: string, marketValue: number): HoldingSummary {
  return { asset: asset({ id }), marketValue } as unknown as HoldingSummary;
}

describe("byCustom", () => {
  it("gives a single value the holding's full market value", () => {
    const slices = byCustom(
      [holding("a", 1000)],
      { a: { g1: ["gamble"] } },
      "g1",
    );
    expect(slices).toEqual([{ label: "gamble", value: 1000 }]);
  });

  it("buckets holdings with no value in the group under Untagged", () => {
    const slices = byCustom([holding("a", 500)], {}, "g1");
    expect(slices).toEqual([{ label: "Untagged", value: 500 }]);
  });

  it("splits a holding's value evenly across two values in the group", () => {
    const slices = byCustom(
      [holding("a", 1000)],
      { a: { g1: ["gamble", "core"] } },
      "g1",
    );
    expect(slices.sort((x, y) => x.label.localeCompare(y.label))).toEqual([
      { label: "core", value: 500 },
      { label: "gamble", value: 500 },
    ]);
  });

  it("computes independent slices for the same holdings under a different group", () => {
    const assignments = { a: { g1: ["gamble"], g2: ["low-risk"] } };
    expect(byCustom([holding("a", 1000)], assignments, "g1")).toEqual([
      { label: "gamble", value: 1000 },
    ]);
    expect(byCustom([holding("a", 1000)], assignments, "g2")).toEqual([
      { label: "low-risk", value: 1000 },
    ]);
  });

  it("skips holdings with market value at or below zero", () => {
    const slices = byCustom(
      [holding("a", 0), holding("b", -100), holding("c", 200)],
      { a: { g1: ["x"] }, b: { g1: ["x"] }, c: { g1: ["x"] } },
      "g1",
    );
    expect(slices).toEqual([{ label: "x", value: 200 }]);
  });
});
