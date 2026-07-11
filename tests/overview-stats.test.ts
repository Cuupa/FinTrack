import { describe, expect, it } from "vitest";
import { summarizeInstrumentHealth } from "../lib/admin/overview-stats";

const NOW = Date.parse("2026-07-11T12:00:00Z");
const HOUR = 60 * 60 * 1000;

describe("summarizeInstrumentHealth", () => {
  it("returns all zeroes for an empty catalog", () => {
    expect(summarizeInstrumentHealth([], NOW)).toEqual({
      total: 0,
      stale: 0,
      dead: 0,
      synthetic: 0,
    });
  });

  it("counts a fresh, priced row as neither stale nor dead nor synthetic", () => {
    const rows = [{ last_price: 100, price_synced_at: new Date(NOW - HOUR).toISOString() }];
    expect(summarizeInstrumentHealth(rows, NOW)).toEqual({
      total: 1,
      stale: 0,
      dead: 0,
      synthetic: 0,
    });
  });

  it("counts a stale row under stale", () => {
    const rows = [{ last_price: 100, price_synced_at: new Date(NOW - 10 * HOUR).toISOString() }];
    expect(summarizeInstrumentHealth(rows, NOW).stale).toBe(1);
  });

  it("counts a dead row under dead, not stale", () => {
    const rows = [{ last_price: 100, price_synced_at: new Date(NOW - 100 * HOUR).toISOString() }];
    const summary = summarizeInstrumentHealth(rows, NOW);
    expect(summary.dead).toBe(1);
    expect(summary.stale).toBe(0);
  });

  it("folds an unknown (no sync timestamp) row into stale", () => {
    const rows = [{ last_price: 100, price_synced_at: null }];
    const summary = summarizeInstrumentHealth(rows, NOW);
    expect(summary.stale).toBe(1);
    expect(summary.dead).toBe(0);
  });

  it("counts a null last_price as synthetic regardless of staleness", () => {
    const rows = [{ last_price: null, price_synced_at: new Date(NOW - HOUR).toISOString() }];
    expect(summarizeInstrumentHealth(rows, NOW).synthetic).toBe(1);
  });

  it("treats a non-numeric last_price string as synthetic", () => {
    const rows = [{ last_price: "not-a-number", price_synced_at: new Date(NOW).toISOString() }];
    expect(summarizeInstrumentHealth(rows, NOW).synthetic).toBe(1);
  });

  it("aggregates a mixed catalog correctly", () => {
    const rows = [
      { last_price: 100, price_synced_at: new Date(NOW - HOUR).toISOString() }, // fresh
      { last_price: 100, price_synced_at: new Date(NOW - 10 * HOUR).toISOString() }, // stale
      { last_price: 100, price_synced_at: new Date(NOW - 100 * HOUR).toISOString() }, // dead
      { last_price: null, price_synced_at: null }, // synthetic + unknown->stale
    ];
    expect(summarizeInstrumentHealth(rows, NOW)).toEqual({
      total: 4,
      stale: 2,
      dead: 1,
      synthetic: 1,
    });
  });
});
