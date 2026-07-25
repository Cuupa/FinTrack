import { describe, expect, it } from "vitest";
import {
  ariaSortFor,
  compareValues,
  nextSort,
  sortRows,
  type SortState,
} from "@/lib/tables/sort";

describe("nextSort", () => {
  it("starts a newly clicked column ascending", () => {
    expect(nextSort({ key: "name", dir: "desc" }, "amount")).toEqual({ key: "amount", dir: "asc" });
  });

  it("flips direction when the active column is clicked again", () => {
    expect(nextSort({ key: "name", dir: "asc" }, "name")).toEqual({ key: "name", dir: "desc" });
    expect(nextSort({ key: "name", dir: "desc" }, "name")).toEqual({ key: "name", dir: "asc" });
  });
});

describe("compareValues", () => {
  it("compares numbers numerically, not lexically", () => {
    // The bug a naive String() comparator has: "10" < "9".
    expect(compareValues(9, 10)).toBeLessThan(0);
  });

  it("compares strings with locale collation", () => {
    expect(compareValues("Apfel", "Zebra")).toBeLessThan(0);
    expect(compareValues("Zebra", "Apfel")).toBeGreaterThan(0);
    expect(compareValues("gleich", "gleich")).toBe(0);
  });

  it("orders false before true", () => {
    expect(compareValues(false, true)).toBeLessThan(0);
  });

  it("sorts missing values after present ones", () => {
    expect(compareValues(null, 5)).toBeGreaterThan(0);
    expect(compareValues(undefined, "a")).toBeGreaterThan(0);
    expect(compareValues(Number.NaN, 0)).toBeGreaterThan(0);
    expect(compareValues(null, undefined)).toBe(0);
  });
});

describe("sortRows", () => {
  type Row = { name: string; amount: number; due: string | null };
  const rows: Row[] = [
    { name: "Rent", amount: 1200, due: "2026-03-01" },
    { name: "Coffee", amount: 9, due: null },
    { name: "Internet", amount: 40, due: "2026-01-15" },
  ];
  const value = (r: Row, k: keyof Row) => r[k];

  it("does not mutate the input array", () => {
    const before = [...rows];
    sortRows(rows, { key: "amount", dir: "desc" }, value);
    expect(rows).toEqual(before);
  });

  it("sorts numerically in both directions", () => {
    const asc = sortRows(rows, { key: "amount", dir: "asc" }, value);
    expect(asc.map((r) => r.amount)).toEqual([9, 40, 1200]);
    const desc = sortRows(rows, { key: "amount", dir: "desc" }, value);
    expect(desc.map((r) => r.amount)).toEqual([1200, 40, 9]);
  });

  it("keeps missing values last in BOTH directions", () => {
    // The whole point of the rule: flipping the arrow must not float the
    // blank due-date row to the top.
    const asc = sortRows(rows, { key: "due", dir: "asc" }, value);
    expect(asc.map((r) => r.name)).toEqual(["Internet", "Rent", "Coffee"]);
    const desc = sortRows(rows, { key: "due", dir: "desc" }, value);
    expect(desc.map((r) => r.name)).toEqual(["Rent", "Internet", "Coffee"]);
  });

  it("sorts ISO date strings chronologically", () => {
    type Dated = { name: string; due: string };
    const dated: Dated[] = [
      { name: "b", due: "2026-01-02" },
      { name: "a", due: "2025-12-31" },
    ];
    const asc = sortRows(dated, { key: "due", dir: "asc" }, (r: Dated, k: keyof Dated) => r[k]);
    expect(asc.map((r) => r.name)).toEqual(["a", "b"]);
  });

  it("handles an empty list", () => {
    expect(sortRows([], { key: "amount", dir: "asc" }, value)).toEqual([]);
  });
});

describe("ariaSortFor", () => {
  const sort: SortState<"name" | "amount"> = { key: "name", dir: "asc" };

  it("reports the active column's direction and none for the rest", () => {
    expect(ariaSortFor(sort, "name")).toBe("ascending");
    expect(ariaSortFor({ key: "name", dir: "desc" }, "name")).toBe("descending");
    expect(ariaSortFor(sort, "amount")).toBe("none");
  });
});
