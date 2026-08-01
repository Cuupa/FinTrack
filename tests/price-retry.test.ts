import { describe, expect, it } from "vitest";
import {
  compareRetryPriority,
  failurePatch,
  isQueued,
  isRetryDue,
  retryDelayMs,
  successPatch,
} from "../lib/server/price-retry";

const T0 = Date.parse("2026-08-01T03:00:00.000Z");
const MIN = 60_000;

describe("retryDelayMs", () => {
  it("backs off exponentially from 30 minutes", () => {
    expect(retryDelayMs(1)).toBe(30 * MIN);
    expect(retryDelayMs(2)).toBe(60 * MIN);
    expect(retryDelayMs(3)).toBe(120 * MIN);
  });

  it("caps at a day, so an unresolvable row still checks back but stops burning searches", () => {
    expect(retryDelayMs(20)).toBe(24 * 60 * MIN);
  });

  it("is zero for a row that never failed", () => {
    expect(retryDelayMs(0)).toBe(0);
  });
});

describe("isRetryDue", () => {
  it("ignores rows that priced fine", () => {
    expect(isQueued({ price_fail_count: 0 })).toBe(false);
    expect(isRetryDue({ price_fail_count: 0, price_failed_at: null }, T0)).toBe(false);
  });

  it("holds a fresh failure back until its backoff elapses", () => {
    const row = { price_fail_count: 1, price_failed_at: new Date(T0).toISOString() };
    expect(isRetryDue(row, T0 + 29 * MIN)).toBe(false);
    expect(isRetryDue(row, T0 + 31 * MIN)).toBe(true);
  });

  it("treats a row missing its columns as never-failed, not as due", () => {
    // A database that has not run migration 0114 reports both as undefined.
    expect(isRetryDue({}, T0)).toBe(false);
  });

  it("treats an unparseable stamp as due rather than stranding the row", () => {
    expect(isRetryDue({ price_fail_count: 2, price_failed_at: "not a date" }, T0)).toBe(true);
  });
});

describe("compareRetryPriority", () => {
  it("puts due retries first, oldest failure leading", () => {
    const fresh = { price_fail_count: 0, price_failed_at: null };
    const older = { price_fail_count: 1, price_failed_at: new Date(T0 - 500 * MIN).toISOString() };
    const newer = { price_fail_count: 1, price_failed_at: new Date(T0 - 100 * MIN).toISOString() };
    const sorted = [fresh, newer, older].sort((a, b) => compareRetryPriority(a, b, T0));
    expect(sorted).toEqual([older, newer, fresh]);
  });

  it("leaves a queued-but-not-due row with the ordinary rows", () => {
    const notDue = { price_fail_count: 1, price_failed_at: new Date(T0 - MIN).toISOString() };
    const fresh = { price_fail_count: 0, price_failed_at: null };
    expect(compareRetryPriority(notDue, fresh, T0)).toBe(0);
  });
});

describe("patches", () => {
  it("counts consecutive failures", () => {
    const at = new Date(T0).toISOString();
    expect(failurePatch({ price_fail_count: 2 }, at)).toEqual({
      price_failed_at: at,
      price_fail_count: 3,
    });
    expect(failurePatch({}, at)).toEqual({ price_failed_at: at, price_fail_count: 1 });
  });

  it("clears the queue on a successful price", () => {
    expect(successPatch()).toEqual({ price_failed_at: null, price_fail_count: 0 });
  });
});
