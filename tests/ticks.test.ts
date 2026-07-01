import { describe, expect, it } from "vitest";
import { niceTicks } from "../lib/ticks";

const ranges: [number, number][] = [
  [120, 168],
  [0, 22000],
  [20, 30],
  [-0.068, 0.1],
  [1180, 1220],
  [0.5, 1.5],
  [55000, 61000],
  [98, 102],
  [0, 1],
  [-5000, 5000],
];

function lastDigitOk(tick: number): boolean {
  const cents = Math.round(tick * 100);
  return cents % 5 === 0;
}

describe("niceTicks", () => {
  it("only emits ticks whose last visible digit is 0 or 5", () => {
    for (const [min, max] of ranges) {
      const ticks = niceTicks(min, max);
      expect(ticks.length).toBeGreaterThan(0);
      for (const t of ticks) expect(lastDigitOk(t)).toBe(true);
    }
  });

  it("brackets the data range", () => {
    for (const [min, max] of ranges) {
      const ticks = niceTicks(min, max);
      expect(ticks[0]).toBeLessThanOrEqual(min);
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max);
    }
  });

  it("keeps a sane tick count", () => {
    for (const [min, max] of ranges) {
      const ticks = niceTicks(min, max, 6);
      expect(ticks.length).toBeLessThanOrEqual(9);
    }
  });

  it("is monotonically increasing with a constant step", () => {
    const ticks = niceTicks(120, 168);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]).toBeGreaterThan(ticks[i - 1]);
    }
  });
});
