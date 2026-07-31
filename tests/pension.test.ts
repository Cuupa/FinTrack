import { describe, expect, it } from "vitest";
import {
  accessFactor,
  averageAnnualPoints,
  pensionLevelOn,
  pensionValueOn,
  projectPension,
  standardRetirementAge,
  totalPensionPoints,
  type PensionReference,
} from "../lib/finance/pension";
import { DEFAULT_PENSION_SETTINGS, type PensionContract, type PensionPoint } from "../lib/types";

const reference: PensionReference[] = [
  { year: 2023, pensionValue: 37.6, levelPct: 48.2 },
  { year: 2024, pensionValue: 39.32, levelPct: 48.1 },
  { year: 2025, pensionValue: 40.79, levelPct: 48.0 },
];

function points(spec: [number, number][]): PensionPoint[] {
  return spec.map(([year, p]) => ({ year, points: p, note: null }));
}

function contract(over: Partial<PensionContract> = {}): PensionContract {
  return {
    id: "c1",
    name: "Riester",
    kind: "riester",
    provider: null,
    monthlyContribution: null,
    currentValue: null,
    expectedMonthlyPension: null,
    startsOn: null,
    note: null,
    ...over,
  };
}

describe("pensionValueOn", () => {
  it("carries the newest row at or before the year forward", () => {
    expect(pensionValueOn(reference, 2024)).toBe(39.32);
    // 2026 has no row yet: the 2025 Rentenwert stays in force.
    expect(pensionValueOn(reference, 2026)).toBe(40.79);
  });

  it("falls back to the oldest row for a year predating the table", () => {
    expect(pensionValueOn(reference, 1999)).toBe(37.6);
  });

  it("returns null with no reference data at all", () => {
    // The UI must then show points only — never a euro figure from a constant.
    expect(pensionValueOn([], 2025)).toBeNull();
  });
});

describe("pensionLevelOn", () => {
  it("carries forward and ignores rows with no level recorded", () => {
    const sparse: PensionReference[] = [
      { year: 2023, pensionValue: 37.6, levelPct: 48.2 },
      { year: 2024, pensionValue: 39.32, levelPct: null },
    ];
    expect(pensionLevelOn(sparse, 2024)).toBe(48.2);
    expect(pensionLevelOn([], 2024)).toBeNull();
  });
});

describe("totalPensionPoints / averageAnnualPoints", () => {
  it("sums the record and averages the most recent years", () => {
    const entries = points([
      [2020, 1.0],
      [2021, 1.2],
      [2022, 0.8],
    ]);
    expect(totalPensionPoints(entries)).toBeCloseTo(3.0, 10);
    expect(averageAnnualPoints(entries, 2)).toBeCloseTo(1.0, 10);
  });

  it("is 0 with no history rather than NaN", () => {
    expect(averageAnnualPoints([])).toBe(0);
  });
});

describe("standardRetirementAge", () => {
  it("follows the statutory cohort ramp", () => {
    expect(standardRetirementAge(1946)).toBe(65);
    expect(standardRetirementAge(1947)).toBeCloseTo(65 + 1 / 12, 10);
    expect(standardRetirementAge(1957)).toBeCloseTo(65 + 11 / 12, 10);
    expect(standardRetirementAge(1958)).toBeCloseTo(66 + 2 / 12, 10);
    expect(standardRetirementAge(1964)).toBe(67);
    expect(standardRetirementAge(1990)).toBe(67);
  });
});

describe("accessFactor", () => {
  it("deducts 0.3% per month early and adds 0.5% per month late", () => {
    expect(accessFactor(67, 67)).toBe(1);
    expect(accessFactor(66, 67)).toBeCloseTo(1 - 12 * 0.003, 10);
    expect(accessFactor(68, 67)).toBeCloseTo(1 + 12 * 0.005, 10);
  });

  it("never goes negative", () => {
    expect(accessFactor(20, 67)).toBe(0);
  });
});

describe("projectPension", () => {
  const entries = points([
    [2022, 1.0],
    [2023, 1.0],
    [2024, 1.0],
    [2025, 1.0],
  ]);

  it("values earned points at the current Rentenwert without a Zugangsfaktor", () => {
    const p = projectPension({
      entries,
      contracts: [],
      reference,
      settings: { ...DEFAULT_PENSION_SETTINGS },
      currentYear: 2025,
    });
    expect(p.currentPoints).toBeCloseTo(4, 10);
    expect(p.monthlyEarned).toBeCloseTo(4 * 40.79, 10);
  });

  it("extrapolates the measured average over the years left to retirement", () => {
    const p = projectPension({
      entries,
      contracts: [],
      reference,
      settings: { ...DEFAULT_PENSION_SETTINGS, birthYear: 1990 },
      currentYear: 2025,
    });
    // Cohort 1990 retires at 67, i.e. in 2057 — 32 years at 1.0 points.
    expect(p.retirementYear).toBe(2057);
    expect(p.standardAge).toBe(67);
    expect(p.annualPoints).toBeCloseTo(1, 10);
    expect(p.futurePoints).toBeCloseTo(32, 10);
    expect(p.totalPoints).toBeCloseTo(36, 10);
    expect(p.accessFactor).toBe(1);
    expect(p.monthlyStatutory).toBeCloseTo(36 * 40.79, 10);
  });

  it("applies the Zugangsfaktor when drawing early", () => {
    const p = projectPension({
      entries,
      contracts: [],
      reference,
      settings: { ...DEFAULT_PENSION_SETTINGS, birthYear: 1990, retirementAge: 63 },
      currentYear: 2025,
    });
    // 4 years early = 48 months x 0.3%.
    expect(p.accessFactor).toBeCloseTo(1 - 48 * 0.003, 10);
    expect(p.monthlyStatutory!).toBeLessThan(p.totalPoints * 40.79);
  });

  it("adds the private policies and reports the gap against the target", () => {
    const p = projectPension({
      entries,
      contracts: [
        contract({ expectedMonthlyPension: 200 }),
        // A policy with no expected payout yet contributes nothing, never NaN.
        contract({ id: "c2", expectedMonthlyPension: null }),
      ],
      reference,
      settings: {
        ...DEFAULT_PENSION_SETTINGS,
        birthYear: 1990,
        annualPoints: 1,
        targetMonthly: 3000,
      },
      currentYear: 2025,
    });
    expect(p.monthlyPrivate).toBe(200);
    expect(p.monthlyTotal).toBeCloseTo(36 * 40.79 + 200, 10);
    expect(p.gap).toBeCloseTo(3000 - (36 * 40.79 + 200), 10);
  });

  it("reports no gap once the target is covered", () => {
    const p = projectPension({
      entries,
      contracts: [],
      reference,
      settings: {
        ...DEFAULT_PENSION_SETTINGS,
        birthYear: 1990,
        annualPoints: 1,
        targetMonthly: 100,
      },
      currentYear: 2025,
    });
    expect(p.gap).toBe(0);
  });

  it("extrapolates nothing without a birth year", () => {
    const p = projectPension({
      entries,
      contracts: [],
      reference,
      settings: { ...DEFAULT_PENSION_SETTINGS },
      currentYear: 2025,
    });
    expect(p.retirementYear).toBeNull();
    expect(p.futurePoints).toBe(0);
    expect(p.totalPoints).toBeCloseTo(4, 10);
  });

  it("reports points but no euro figure with no reference data", () => {
    const p = projectPension({
      entries,
      contracts: [contract({ expectedMonthlyPension: 200 })],
      reference: [],
      settings: { ...DEFAULT_PENSION_SETTINGS, birthYear: 1990 },
      currentYear: 2025,
    });
    expect(p.totalPoints).toBeCloseTo(36, 10);
    expect(p.monthlyStatutory).toBeNull();
    expect(p.monthlyEarned).toBeNull();
    expect(p.monthlyTotal).toBeNull();
    // No total means no honest gap, even with a target set.
    expect(p.gap).toBe(0);
  });
});
