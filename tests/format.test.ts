import { afterEach, describe, expect, it } from "vitest";
import { parseDecimal, formatInputDecimal, formatPercent, formatCompactCurrency } from "../lib/format";
import { setActiveLocale } from "../lib/i18n/locale";

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

  // The mortgage case: a German user types the amount with grouping dots. This
  // used to parse to 250 (Number("250.000")) and book 250 euros of debt, or to
  // NaN once decimals were added, which call sites drop with a bare `return`.
  describe("thousands separators", () => {
    afterEach(() => setActiveLocale("en"));

    it("reads a lone grouping dot as grouping on a German UI", () => {
      setActiveLocale("de");
      expect(parseDecimal("250.000")).toBe(250000);
      expect(parseDecimal("-250.000")).toBe(-250000);
    });
    it("still reads a lone dot before fewer than three digits as a decimal point", () => {
      setActiveLocale("de");
      expect(parseDecimal("1.5")).toBe(1.5);
      expect(parseDecimal("1.25")).toBe(1.25);
    });
    it("lets the last separator win when both appear", () => {
      setActiveLocale("de");
      expect(parseDecimal("250.000,50")).toBe(250000.5);
      expect(parseDecimal("1.234.567,89")).toBe(1234567.89);
      setActiveLocale("en");
      expect(parseDecimal("250,000.50")).toBe(250000.5);
      expect(parseDecimal("1,234,567.89")).toBe(1234567.89);
    });
    it("reads a repeated separator as grouping in either locale", () => {
      setActiveLocale("en");
      expect(parseDecimal("1.000.000")).toBe(1000000);
      expect(parseDecimal("1,000,000")).toBe(1000000);
    });
    it("reads a lone grouping comma as grouping on an English UI", () => {
      setActiveLocale("en");
      expect(parseDecimal("1,234")).toBe(1234);
      expect(parseDecimal("1,5")).toBe(1.5);
    });
    it("rejects a malformed group pattern rather than inventing a number", () => {
      expect(Number.isNaN(parseDecimal("1.2.3"))).toBe(true);
      expect(Number.isNaN(parseDecimal("12.34.567"))).toBe(true);
    });
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

describe("formatInputDecimal", () => {
  afterEach(() => setActiveLocale("en"));

  it("uses the active locale decimal separator without grouping", () => {
    setActiveLocale("de");
    expect(formatInputDecimal(2.5)).toBe("2,5");
    setActiveLocale("en");
    expect(formatInputDecimal(2.5)).toBe("2.5");
  });
});

// Intl's own compact notation doesn't shorten thousands in de-DE (it renders
// "25.000,0 €" and only compacts at millions), so formatCompactCurrency builds
// the k/M/B label itself — these tests pin the behavior per locale.
describe("formatCompactCurrency", () => {
  afterEach(() => setActiveLocale("en"));

  it("compacts thousands/millions with a prefixed symbol in en", () => {
    setActiveLocale("en");
    expect(formatCompactCurrency(25_000)).toBe("€25k");
    expect(formatCompactCurrency(12_500)).toBe("€12.5k");
    expect(formatCompactCurrency(1_200_000)).toBe("€1.2M");
    expect(formatCompactCurrency(2_500_000_000)).toBe("€2.5B");
  });

  it("compacts thousands/millions with a suffixed symbol and comma decimals in de", () => {
    setActiveLocale("de");
    // de-DE uses a non-breaking space between number and symbol.
    expect(formatCompactCurrency(25_000).replace(/[\u00A0\u202F]/g, " ")).toBe("25k €");
    expect(formatCompactCurrency(12_500).replace(/[\u00A0\u202F]/g, " ")).toBe("12,5k €");
    expect(formatCompactCurrency(1_200_000).replace(/[\u00A0\u202F]/g, " ")).toBe("1,2M €");
  });

  it("keeps zero and 4-digit values uncompacted with no trailing ,0/.0", () => {
    setActiveLocale("en");
    expect(formatCompactCurrency(0)).toBe("€0");
    expect(formatCompactCurrency(9_999)).toBe("€9,999");
    setActiveLocale("de");
    expect(formatCompactCurrency(0).replace(/[\u00A0\u202F]/g, " ")).toBe("0 €");
    expect(formatCompactCurrency(9_999).replace(/[\u00A0\u202F]/g, " ")).toBe("9.999 €");
  });

  it("handles negative values in both locales", () => {
    setActiveLocale("en");
    expect(formatCompactCurrency(-25_000)).toBe("-€25k");
    setActiveLocale("de");
    expect(formatCompactCurrency(-25_000).replace(/[\u00A0\u202F]/g, " ")).toBe("-25k €");
  });
});

describe("formatCompactCurrency with a forced unit", () => {
  afterEach(() => setActiveLocale("en"));

  it("uses the forced unit instead of picking one per value", () => {
    setActiveLocale("en");
    expect(formatCompactCurrency(900, "EUR", { divisor: 1e3, suffix: "k" })).toBe("€0.9k");
    expect(formatCompactCurrency(4_000, "EUR", { divisor: 1e3, suffix: "k" })).toBe("€4k");
  });

  it("keeps an exact zero as €0 even with a forced unit", () => {
    setActiveLocale("en");
    expect(formatCompactCurrency(0, "EUR", { divisor: 1e3, suffix: "k" })).toBe("€0");
  });
});
