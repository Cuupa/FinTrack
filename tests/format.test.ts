import { describe, expect, it } from "vitest";
import { parseDecimal, formatPercent } from "../lib/format";

describe("parseDecimal", () => {
  it("parses a decimal comma (de-DE)", () => {
    expect(parseDecimal("0,25")).toBe(0.25);
  });
  it("parses a decimal point", () => {
    expect(parseDecimal("1.5")).toBe(1.5);
  });
  it("strips whitespace", () => {
    expect(parseDecimal(" 1 000,5 ")).toBe(1000.5);
  });
  it("returns NaN for blank input", () => {
    expect(Number.isNaN(parseDecimal(""))).toBe(true);
    expect(Number.isNaN(parseDecimal("   "))).toBe(true);
  });
});

describe("formatPercent", () => {
  it("signs and suffixes (locale-agnostic)", () => {
    const up = formatPercent(0.05);
    expect(up.startsWith("+")).toBe(true);
    expect(up.includes("%")).toBe(true);
    expect(formatPercent(-0.05).startsWith("-")).toBe(true);
  });
});
