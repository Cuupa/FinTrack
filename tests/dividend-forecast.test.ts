import { describe, expect, it } from "vitest";
import { applyAnnouncedDate } from "../lib/finance/dividends";

describe("applyAnnouncedDate", () => {
  const projected = [
    { date: "2026-08-15", amount: 10 },
    { date: "2026-11-15", amount: 10 },
    { date: "2027-02-15", amount: 10 },
  ];

  it("re-dates the earliest projected payment to the confirmed pay date and flags it", () => {
    const out = applyAnnouncedDate(projected, "2026-09-01", "2026-07-20");
    expect(out[0]).toEqual({ date: "2026-09-01", amount: 10, confirmed: true });
    // the rest stay projected, unchanged
    expect(out[1]).toEqual({ date: "2026-11-15", amount: 10, confirmed: false });
    expect(out[2]).toEqual({ date: "2027-02-15", amount: 10, confirmed: false });
  });

  it("leaves the projection untouched when there is no announced date", () => {
    const out = applyAnnouncedDate(projected, null, "2026-07-20");
    expect(out.every((p) => !p.confirmed)).toBe(true);
    expect(out.map((p) => p.date)).toEqual(projected.map((p) => p.date));
  });

  it("ignores a past announced date (projection stays the fallback)", () => {
    const out = applyAnnouncedDate(projected, "2026-07-01", "2026-07-20");
    expect(out.every((p) => !p.confirmed)).toBe(true);
  });

  it("finds the earliest even if the input is unsorted", () => {
    const unsorted = [
      { date: "2027-02-15", amount: 10 },
      { date: "2026-08-15", amount: 7 },
    ];
    const out = applyAnnouncedDate(unsorted, "2026-09-01", "2026-07-20");
    const confirmed = out.find((p) => p.confirmed);
    expect(confirmed).toEqual({ date: "2026-09-01", amount: 7, confirmed: true });
  });

  it("returns an empty list unchanged when there is nothing to project", () => {
    expect(applyAnnouncedDate([], "2026-09-01", "2026-07-20")).toEqual([]);
  });
});
