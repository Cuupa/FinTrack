// isPriceFresh — the staleness check from lib/live/fetch-price.ts that gates
// whether the transaction form refetches a live price on open. fetchLivePrice
// itself isn't exercised here since it needs the browser fetch runtime.

import { describe, expect, it } from "vitest";
import { isPriceFresh } from "../lib/live/fetch-price";

describe("isPriceFresh", () => {
  const now = Date.parse("2026-07-10T12:00:00.000Z");
  const maxAgeMs = 3_600_000;

  it("is not fresh when there is no synced-at timestamp", () => {
    expect(isPriceFresh(null, now, maxAgeMs)).toBe(false);
  });

  it("is fresh when synced 30 minutes ago", () => {
    const syncedAt = new Date(now - 30 * 60 * 1000).toISOString();
    expect(isPriceFresh(syncedAt, now, maxAgeMs)).toBe(true);
  });

  it("is not fresh when synced 2 hours ago", () => {
    const syncedAt = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    expect(isPriceFresh(syncedAt, now, maxAgeMs)).toBe(false);
  });

  it("is not fresh for an unparseable timestamp", () => {
    expect(isPriceFresh("not-a-date", now, maxAgeMs)).toBe(false);
  });

  it("is not fresh exactly at the max-age boundary", () => {
    const syncedAt = new Date(now - maxAgeMs).toISOString();
    expect(isPriceFresh(syncedAt, now, maxAgeMs)).toBe(false);
  });
});
