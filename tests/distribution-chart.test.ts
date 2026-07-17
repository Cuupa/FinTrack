import { describe, expect, it } from "vitest";
import { yearTicks } from "../components/charts/distribution-chart";

describe("yearTicks", () => {
  it("returns just [0] for a zero or negative horizon", () => {
    expect(yearTicks(0)).toEqual([0]);
    expect(yearTicks(-5)).toEqual([0]);
  });

  it("picks a regular step, starts at 0 and ends at maxYear", () => {
    for (const maxYear of [6, 15, 30, 44, 50]) {
      const ticks = yearTicks(maxYear);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBe(maxYear);
      // At most 8 regular steps plus a possible trailing partial tick.
      expect(ticks.length).toBeLessThanOrEqual(9);
      // Every tick but possibly the last is a multiple of the step.
      const step = ticks[1] - ticks[0];
      for (let i = 0; i < ticks.length - 1; i++) {
        expect(ticks[i]).toBe(i * step);
      }
    }
  });

  it("uses step 1 for a small horizon (6y)", () => {
    expect(yearTicks(6)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("uses step 5 for a 30y horizon, landing exactly on maxYear", () => {
    expect(yearTicks(30)).toEqual([0, 5, 10, 15, 20, 25, 30]);
  });

  it("uses step 10 for a 44y horizon, appending the odd last tick", () => {
    expect(yearTicks(44)).toEqual([0, 10, 20, 30, 40, 44]);
  });
});
