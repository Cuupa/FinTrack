import { afterEach, describe, expect, it } from "vitest";
import {
  formatCurrency,
  formatCompactCurrency,
  formatPercent,
  formatPercentPlain,
  normalizeZero,
  plColor,
} from "../lib/format";
import { PALETTE, colorForLabel } from "../lib/colors";
import { setActiveLocale } from "../lib/i18n/locale";

afterEach(() => setActiveLocale("en"));

describe("normalizeZero", () => {
  it("snaps a tiny negative that rounds to zero to positive zero", () => {
    expect(Object.is(normalizeZero(-0.001, 2), 0)).toBe(true);
    expect(Object.is(normalizeZero(-0, 2), 0)).toBe(true);
  });
  it("leaves a value that still rounds nonzero untouched", () => {
    expect(normalizeZero(-0.006, 2)).toBe(-0.006);
    expect(normalizeZero(12.34, 2)).toBe(12.34);
  });
});

describe("negative-zero display", () => {
  it("formatCurrency never renders a minus for a rounds-to-zero value", () => {
    setActiveLocale("de");
    expect(formatCurrency(-0.001).includes("-")).toBe(false);
    expect(formatCurrency(-0.004)).toBe(formatCurrency(0));
  });
  it("formatCompactCurrency never renders a minus for a rounds-to-zero value", () => {
    setActiveLocale("de");
    expect(formatCompactCurrency(-0.001).includes("-")).toBe(false);
  });
  it("formatPercent normalizes negative zero", () => {
    expect(formatPercent(-0.00001).includes("-")).toBe(false);
    expect(formatPercentPlain(-0.00001).includes("-")).toBe(false);
  });
  it("still shows a real negative", () => {
    setActiveLocale("de");
    expect(formatCurrency(-12.34).includes("-")).toBe(true);
    expect(formatPercent(-0.05).startsWith("-")).toBe(true);
  });
});

describe("plColor uses semantic tokens", () => {
  it("maps sign to positive/negative/tertiary, not raw emerald/red", () => {
    expect(plColor(1)).toBe("text-positive");
    expect(plColor(-1)).toBe("text-negative");
    expect(plColor(0)).toBe("text-tertiary");
  });
});

describe("categorical palette", () => {
  it("never uses the reserved positive/negative hues", () => {
    expect(PALETTE).not.toContain("#059669");
    expect(PALETTE).not.toContain("#ef4444");
  });
  it("colorForLabel is deterministic and always a palette entry", () => {
    expect(colorForLabel("Gambling")).toBe(colorForLabel("Gambling"));
    expect(PALETTE).toContain(colorForLabel("Gambling"));
    expect(PALETTE).toContain(colorForLabel("Anything else"));
  });
});
