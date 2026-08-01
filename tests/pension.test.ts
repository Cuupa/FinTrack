import { describe, expect, it } from "vitest";
import {
  accessFactor,
  annualPointsOutlier,
  averageAnnualPoints,
  currentPensionPoints,
  maxPointsOn,
  pensionLevelOn,
  pointsTrend,
  pensionValueOn,
  projectPension,
  standardRetirementAge,
  totalPensionPoints,
  typicalAnnualPoints,
  type PensionReference,
} from "../lib/finance/pension";
import { DEFAULT_PENSION_SETTINGS, type PensionContract, type PensionPoint } from "../lib/types";

const reference: PensionReference[] = [
  { year: 2023, pensionValue: 37.6, levelPct: 48.2, maxPoints: 2.03 },
  { year: 2024, pensionValue: 39.32, levelPct: 48.1, maxPoints: 2.0 },
  { year: 2025, pensionValue: 40.79, levelPct: 48.0, maxPoints: 1.91 },
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
      { year: 2023, pensionValue: 37.6, levelPct: 48.2, maxPoints: null },
      { year: 2024, pensionValue: 39.32, levelPct: null, maxPoints: null },
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

describe("maxPointsOn", () => {
  it("carries the newest cap at or before the year forward", () => {
    expect(maxPointsOn(reference, 2024)).toBe(2.0);
    expect(maxPointsOn(reference, 2030)).toBe(1.91);
  });

  it("uses the newest recorded cap for a year predating the table", () => {
    // The ratio is structural (BBG ~ 2x the average wage), not a trend, so an
    // old year is capped rather than left uncapped.
    expect(maxPointsOn(reference, 1990)).toBe(1.91);
  });

  it("is null with no cap recorded at all, which disables the cap", () => {
    expect(maxPointsOn([], 2025)).toBeNull();
    expect(
      maxPointsOn([{ year: 2025, pensionValue: 40.79, levelPct: null, maxPoints: null }], 2025),
    ).toBeNull();
  });
});

describe("currentPensionPoints", () => {
  const settings = { totalPoints: null, totalPointsYear: null };

  it("sums the per-year record when no statement total is on file", () => {
    expect(currentPensionPoints(points([[2024, 1.0]]), settings)).toBeCloseTo(1, 10);
  });

  it("takes the statement total and adds only the years after it", () => {
    const entries = points([
      [2023, 1.1],
      [2024, 1.2],
      [2025, 1.3],
    ]);
    // The statement covers everything up to and including 2024.
    expect(
      currentPensionPoints(entries, { totalPoints: 17.03, totalPointsYear: 2024 }),
    ).toBeCloseTo(17.03 + 1.3, 10);
  });

  it("ignores the per-year record entirely when the total has no as-of year", () => {
    const entries = points([[2024, 1.2]]);
    expect(currentPensionPoints(entries, { totalPoints: 17.03, totalPointsYear: null })).toBeCloseTo(
      17.03,
      10,
    );
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

  it("discards a cumulative total typed into one year instead of multiplying it", () => {
    // The reported bug: 17 points is a Renteninformation TOTAL, but it went
    // into a single year's row, so the average read 17 points PER year and the
    // projection returned roughly 20.000 EUR a month.
    //
    // A year above the Beitragsbemessungsgrenze is not a year, so it is
    // dropped rather than clamped to the cap. Clamping would have silently
    // assumed the MAXIMUM a year can earn, for every year left -- an invented
    // figure dressed as a correction. With nothing else on record the honest
    // answer is that no rate is known, and the row is named so it gets fixed.
    const p = projectPension({
      entries: points([[2025, 17]]),
      contracts: [],
      reference,
      settings: { ...DEFAULT_PENSION_SETTINGS, birthYear: 1990 },
      currentYear: 2025,
    });
    expect(p.maxAnnualPoints).toBe(1.91);
    expect(p.outlierYear?.year).toBe(2025);
    expect(p.annualPoints).toBe(0);
    // The 17 still counts as EARNED; it is only the per-year rate it must not
    // become. Nowhere near the 17 + 32 x 17 the bug produced.
    expect(p.totalPoints).toBeCloseTo(17, 10);
    expect(p.monthlyStatutory!).toBeLessThan(1000);
  });

  it("leaves a plausible assumption alone", () => {
    const p = projectPension({
      entries,
      contracts: [],
      reference,
      settings: { ...DEFAULT_PENSION_SETTINGS, birthYear: 1990, annualPoints: 1.2 },
      currentYear: 2025,
    });
    // A typed assumption is held flat, so every projected year is exactly it.
    expect(p.annualPoints).toBeCloseTo(1.2, 10);
    expect(p.annualPointsSlope).toBe(0);
    expect(p.annualPointsCapped).toBe(false);
  });

  it("takes the statement total as the entitlement earned so far", () => {
    const p = projectPension({
      entries: [],
      contracts: [],
      reference,
      settings: {
        ...DEFAULT_PENSION_SETTINGS,
        birthYear: 1990,
        totalPoints: 17.0322,
        totalPointsYear: 2025,
        annualPoints: 1,
      },
      currentYear: 2025,
    });
    expect(p.currentPoints).toBeCloseTo(17.0322, 10);
    expect(p.monthlyEarned).toBeCloseTo(17.0322 * 40.79, 10);
    expect(p.totalPoints).toBeCloseTo(17.0322 + 32, 10);
  });

  it("extrapolates nothing from a statement total on its own", () => {
    // A total is a stock, not a rate: with no per-year record and no explicit
    // assumption there is nothing to measure a future year from, so the page
    // reports the entitlement rather than inventing an income history.
    const p = projectPension({
      entries: [],
      contracts: [],
      reference,
      settings: { ...DEFAULT_PENSION_SETTINGS, birthYear: 1990, totalPoints: 17.0322 },
      currentYear: 2025,
    });
    expect(p.annualPoints).toBe(0);
    expect(p.futurePoints).toBe(0);
    expect(p.totalPoints).toBeCloseTo(17.0322, 10);
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

// The reported case (owner, 2026-08): the projection said ~8.400 EUR/month
// where the Renteninformation said 2.640,13. The cause was a CUMULATIVE total
// typed into a single year's row -- the mistake the UI already warns about --
// dragging the mean-based per-year assumption to roughly five times reality.
// The cap that would have caught it is reference data, and reference data can
// be absent, so the assumption itself has to survive the bad row.
describe("a cumulative total typed into one year", () => {
  const entries = points([
    [2023, 1.1],
    [2024, 1.2],
    // The Renteninformation's running total, in the wrong field.
    [2025, 17.03],
  ]);

  it("moves the mean but not the median", () => {
    expect(averageAnnualPoints(entries)).toBeCloseTo(6.443, 3);
    expect(typicalAnnualPoints(entries)).toBe(1.2);
  });

  it("is reported so the user can correct the row", () => {
    const outlier = annualPointsOutlier(entries);
    expect(outlier?.year).toBe(2025);
    expect(outlier?.points).toBe(17.03);
  });

  it("finds nothing to report in a normal record", () => {
    expect(annualPointsOutlier(points([[2023, 1.1], [2024, 1.2], [2025, 1.3]]))).toBeNull();
  });

  it("keeps the projection plausible even with NO reference data to cap with", () => {
    const settings = { ...DEFAULT_PENSION_SETTINGS, birthYear: 1990, retirementAge: 67 };
    // No reference rows at all: `maxPointsOn` returns null, so the cap is off.
    // This is the live situation whenever migration 0111 has not run.
    const projection = projectPension({
      entries,
      contracts: [],
      reference: [],
      settings,
      currentYear: 2026,
    });
    // 31 years left. The mean would have assumed 6.44/yr -> ~219 points; the
    // median assumes 1.2 -> ~56, which is the order of magnitude a career
    // actually produces.
    expect(projection.annualPoints).toBeCloseTo(1.2, 10);
    expect(projection.totalPoints).toBeLessThan(70);
    expect(projection.outlierYear?.year).toBe(2025);
  });

  it("still prefers an explicit assumption the user typed", () => {
    const settings = {
      ...DEFAULT_PENSION_SETTINGS,
      birthYear: 1990,
      retirementAge: 67,
      annualPoints: 1.5,
    };
    const projection = projectPension({
      entries,
      contracts: [],
      reference,
      settings,
      currentYear: 2026,
    });
    expect(projection.annualPoints).toBe(1.5);
  });

  it("surfaces the Rentenwert it valued the points at", () => {
    const projection = projectPension({
      entries: points([[2025, 1.2]]),
      contracts: [],
      reference,
      settings: { ...DEFAULT_PENSION_SETTINGS, birthYear: 1990 },
      currentYear: 2026,
    });
    expect(projection.pensionValue).toBe(40.79);
  });
});

// Entgeltpunkte are your salary divided by the national average, so a career
// that is still going pushes them UP year after year. Holding the latest value
// flat to retirement understates a rising biography badly -- reported as being
// about a thousand euros a month short against the Renteninformation.
describe("projecting a rising career", () => {
  const rising = points([
    [2023, 1.0],
    [2024, 1.2],
    [2025, 1.4],
  ]);

  it("fits the increase instead of holding the last year flat", () => {
    const trend = pointsTrend(rising, 2.0);
    expect(trend.slope).toBeCloseTo(0.2, 6);
    expect(trend.base).toBeCloseTo(1.4, 6);
    expect(trend.sampleSize).toBe(3);
  });

  it("needs three years before it will claim a slope", () => {
    // Two points define a line through noise with unearned confidence.
    expect(pointsTrend(points([[2024, 1.2], [2025, 1.4]]), 2.0).slope).toBe(0);
    expect(pointsTrend(points([[2025, 1.4]]), 2.0).slope).toBe(0);
    // ...but the level is still carried forward.
    expect(pointsTrend(points([[2024, 1.2], [2025, 1.4]]), 2.0).base).toBeCloseTo(1.4, 6);
  });

  it("projects more than the flat assumption, and says so per year", () => {
    const settings = { ...DEFAULT_PENSION_SETTINGS, birthYear: 1990, retirementAge: 67 };
    const p = projectPension({
      entries: rising,
      contracts: [],
      reference,
      settings,
      currentYear: 2026,
    });
    // Rising, so the last projected year is worth more than the first.
    expect(p.annualPointsEnd).toBeGreaterThan(p.annualPointsStart);
    expect(p.annualPointsSlope).toBeCloseTo(0.2, 6);
    // And the whole projection beats holding 1.4 flat for the same span.
    const flat = projectPension({
      entries: rising,
      contracts: [],
      reference,
      settings: { ...settings, annualPoints: 1.4 },
      currentYear: 2026,
    });
    expect(p.totalPoints).toBeGreaterThan(flat.totalPoints);
  });

  it("never projects a year above the Beitragsbemessungsgrenze", () => {
    const p = projectPension({
      entries: rising,
      contracts: [],
      reference,
      settings: { ...DEFAULT_PENSION_SETTINGS, birthYear: 1990, retirementAge: 67 },
      currentYear: 2026,
    });
    // 0.2/yr over 31 years would reach 7+ points without the cap.
    expect(p.annualPointsEnd).toBeLessThanOrEqual(p.maxAnnualPoints!);
    expect(p.annualPointsCapped).toBe(true);
  });

  it("does not run away when there is no cap to stop it", () => {
    const p = projectPension({
      entries: rising,
      contracts: [],
      reference: [],
      settings: { ...DEFAULT_PENSION_SETTINGS, birthYear: 1990, retirementAge: 67 },
      currentYear: 2026,
    });
    // A three-year slope carried thirty years is past what the sample can
    // support, so it stops at twice the current year rather than compounding.
    expect(p.annualPointsEnd).toBeLessThanOrEqual(1.4 * 2 + 1e-9);
  });

  it("a falling record projects downward, not upward", () => {
    const falling = points([
      [2023, 1.6],
      [2024, 1.4],
      [2025, 1.2],
    ]);
    const p = projectPension({
      entries: falling,
      contracts: [],
      reference,
      settings: { ...DEFAULT_PENSION_SETTINGS, birthYear: 1990, retirementAge: 67 },
      currentYear: 2026,
    });
    expect(p.annualPointsSlope).toBeLessThan(0);
    expect(p.annualPointsEnd).toBeLessThan(p.annualPointsStart);
    // Never below zero: a year cannot earn negative points.
    expect(p.annualPointsEnd).toBeGreaterThanOrEqual(0);
  });
});

// A short sample does not license a long straight line.
describe("how far the trend is carried", () => {
  const rising = points([
    [2023, 1.0],
    [2024, 1.2],
    [2025, 1.4],
  ]);

  it("stops advancing the slope after twice the measured window", () => {
    // 3 recorded years -> the slope runs 6 years past the last one (to 2031),
    // reaching 1.4 + 6 x 0.2 = 2.6, and then holds flat for the rest.
    const p = projectPension({
      entries: rising,
      contracts: [],
      reference: [],
      settings: { ...DEFAULT_PENSION_SETTINGS, birthYear: 1990, retirementAge: 67 },
      currentYear: 2026,
    });
    // The 2x-base ceiling (2.8) is never reached, because the horizon bites
    // first at 2.6.
    expect(p.annualPointsEnd).toBeCloseTo(2.6, 6);
  });

  it("does not let a steep short sample assume the maximum for a whole career", () => {
    // With a real Beitragsbemessungsgrenze the projection still saturates, but
    // the point is that it is the CAP doing it, not an unbounded straight line.
    const p = projectPension({
      entries: rising,
      contracts: [],
      reference,
      settings: { ...DEFAULT_PENSION_SETTINGS, birthYear: 1990, retirementAge: 67 },
      currentYear: 2026,
    });
    expect(p.annualPointsEnd).toBeLessThanOrEqual(p.maxAnnualPoints!);
    // Averaged over the whole run it stays under the cap: the early years are
    // genuinely below it.
    expect(p.annualPoints).toBeLessThan(p.maxAnnualPoints!);
  });
});
