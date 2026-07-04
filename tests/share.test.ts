import { describe, expect, it } from "vitest";
import { validateExpiresAt } from "../lib/share/share";

const NOW = new Date("2026-07-04T12:00:00.000Z");

describe("validateExpiresAt", () => {
  it("treats a missing value as never expires (null)", () => {
    expect(validateExpiresAt(undefined, NOW)).toBeNull();
    expect(validateExpiresAt(null, NOW)).toBeNull();
  });

  it("accepts a future date and normalises it to an ISO string", () => {
    const future = new Date(NOW.getTime() + 60_000).toISOString();
    expect(validateExpiresAt(future, NOW)).toBe(future);
  });

  it("rejects a date in the past", () => {
    const past = new Date(NOW.getTime() - 60_000).toISOString();
    expect(validateExpiresAt(past, NOW)).toBeUndefined();
  });

  it("rejects the current instant (must be strictly in the future)", () => {
    expect(validateExpiresAt(NOW.toISOString(), NOW)).toBeUndefined();
  });

  it("rejects an unparseable string", () => {
    expect(validateExpiresAt("not a date", NOW)).toBeUndefined();
  });

  it("rejects a non-string value", () => {
    expect(validateExpiresAt(12345, NOW)).toBeUndefined();
  });
});
