import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE_SIZE, pageSlice } from "@/lib/tables/pagination";

const rows = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("pageSlice", () => {
  it("keeps a short list on one page and hides the controls", () => {
    const p = pageSlice(rows(3), 1, 25);
    expect(p.rows).toEqual([1, 2, 3]);
    expect(p.pageCount).toBe(1);
    expect(p.hasPages).toBe(false);
    expect([p.from, p.to, p.total]).toEqual([1, 3, 3]);
  });

  it("slices and reports the visible range", () => {
    const p = pageSlice(rows(60), 2, 25);
    expect(p.rows[0]).toBe(26);
    expect(p.rows).toHaveLength(25);
    expect([p.from, p.to, p.total, p.pageCount]).toEqual([26, 50, 60, 3]);
    expect(p.hasPages).toBe(true);
  });

  it("the last page holds the remainder", () => {
    const p = pageSlice(rows(60), 3, 25);
    expect(p.rows).toEqual([51, 52, 53, 54, 55, 56, 57, 58, 59, 60]);
    expect([p.from, p.to]).toEqual([51, 60]);
  });

  // Deleting the last row of page 4 must not leave an empty table behind.
  it("clamps a page past the end back onto the last one", () => {
    const p = pageSlice(rows(30), 9, 25);
    expect(p.page).toBe(2);
    expect(p.rows[0]).toBe(26);
  });

  it("clamps a nonsense page onto the first one", () => {
    expect(pageSlice(rows(30), 0, 25).page).toBe(1);
    expect(pageSlice(rows(30), -3, 25).page).toBe(1);
  });

  it("survives an empty list", () => {
    const p = pageSlice([], 1, 25);
    expect(p.rows).toEqual([]);
    expect([p.page, p.pageCount, p.from, p.to, p.total]).toEqual([1, 1, 0, 0, 0]);
    expect(p.hasPages).toBe(false);
  });

  it("defaults to the app-wide page size", () => {
    expect(pageSlice(rows(100), 1).rows).toHaveLength(DEFAULT_PAGE_SIZE);
  });
});
