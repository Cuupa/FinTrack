import { afterEach, describe, expect, it } from "vitest";
import { parseDecimal, formatPercent, formatCompactCurrency } from "../lib/format";
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
});

describe("formatPercent", () => {
  it("signs and suffixes (locale-agnostic)", () => {
    const up = formatPercent(0.05);
    expect(up.startsWith("+")).toBe(true);
    expect(up.includes("%")).toBe(true);
    expect(formatPercent(-0.05).startsWith("-")).toBe(true);
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
