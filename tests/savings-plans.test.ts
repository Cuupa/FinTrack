import { describe, expect, it } from "vitest";
import {
  dueOccurrences,
  MAX_DUE_OCCURRENCES,
  nextOccurrence,
  occurrenceAt,
} from "../lib/finance/savings-plans";
import type { SavingsPlan } from "../lib/types";

function plan(over: Partial<SavingsPlan>): SavingsPlan {
  return {
    id: "sp1",
    assetId: "a",
    portfolioId: "p1",
    amount: 100,
    interval: "MONTHLY",
    startDate: "2026-01-15",
    active: true,
    lastRunDate: null,
    ...over,
  };
}

describe("occurrenceAt", () => {
  it("keeps the day of month and clamps to shorter months", () => {
    const p = plan({ startDate: "2026-01-31" });
    expect(occurrenceAt(p, 0)).toBe("2026-01-31");
    expect(occurrenceAt(p, 1)).toBe("2026-02-28"); // clamped, 2026 not a leap year
    expect(occurrenceAt(p, 2)).toBe("2026-03-31"); // back to the anchor day
  });

  it("steps weekly plans by 7 days", () => {
    const p = plan({ interval: "WEEKLY", startDate: "2026-06-01" });
    expect(occurrenceAt(p, 1)).toBe("2026-06-08");
    expect(occurrenceAt(p, 4)).toBe("2026-06-29");
  });

  it("steps quarterly plans by 3 months", () => {
    const p = plan({ interval: "QUARTERLY", startDate: "2026-01-15" });
    expect(occurrenceAt(p, 1)).toBe("2026-04-15");
    expect(occurrenceAt(p, 2)).toBe("2026-07-15");
  });
});

describe("dueOccurrences", () => {
  it("returns every occurrence from start through today when never run", () => {
    const p = plan({ startDate: "2026-04-15" });
    expect(dueOccurrences(p, "2026-07-06")).toEqual([
      "2026-04-15",
      "2026-05-15",
      "2026-06-15",
    ]);
  });

  it("resumes strictly after lastRunDate", () => {
    const p = plan({ startDate: "2026-01-15", lastRunDate: "2026-05-15" });
    expect(dueOccurrences(p, "2026-07-06")).toEqual(["2026-06-15"]);
  });

  it("is empty for paused plans and future start dates", () => {
    expect(dueOccurrences(plan({ active: false }), "2026-07-06")).toEqual([]);
    expect(dueOccurrences(plan({ startDate: "2026-08-01" }), "2026-07-06")).toEqual([]);
  });

  it("caps a long-overdue plan at MAX_DUE_OCCURRENCES", () => {
    const p = plan({ interval: "WEEKLY", startDate: "2020-01-06" });
    expect(dueOccurrences(p, "2026-07-06")).toHaveLength(MAX_DUE_OCCURRENCES);
  });
});

describe("nextOccurrence", () => {
  it("is the first occurrence strictly after today", () => {
    expect(nextOccurrence(plan({ startDate: "2026-01-15" }), "2026-07-06")).toBe("2026-07-15");
    expect(nextOccurrence(plan({ startDate: "2026-07-15" }), "2026-07-06")).toBe("2026-07-15");
  });
});
