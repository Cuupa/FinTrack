// Client-side history cache (lib/history/history-cache.ts). The test
// environment has no DOM/localStorage (vitest.config.ts runs "node"), so we
// inject an in-memory Storage stub, same pattern as tests/offline-store.test.ts.

import { describe, expect, it } from "vitest";
import {
  clearHistoryCache,
  readHistoryCache,
  writeHistoryCache,
} from "../lib/history/history-cache";
import type { HistoryMap } from "../lib/history/history";

/** In-memory Storage stub. Optionally throws on setItem for a given key, to
 *  simulate a localStorage quota failure. */
function makeStorage(opts?: { failOnKey?: string; failAlways?: boolean }): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts?.failAlways || (opts?.failOnKey && k === opts.failOnKey)) {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      map.set(k, v);
    },
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const SAMPLE: HistoryMap = {
  "US0378331005": [
    { date: "2026-01-01", close: 100 },
    { date: "2026-01-02", close: 101 },
  ],
};

describe("history-cache", () => {
  it("round-trips a write then read", () => {
    const storage = makeStorage();
    writeHistoryCache("sig-a", SAMPLE, { storage, now: 1_000 });
    expect(readHistoryCache("sig-a", { storage, now: 1_000 })).toEqual(SAMPLE);
  });

  it("misses on an absent sig", () => {
    const storage = makeStorage();
    expect(readHistoryCache("nope", { storage })).toBeNull();
  });

  it("expires entries older than the 7 day TTL", () => {
    const storage = makeStorage();
    const writtenAt = 1_000;
    writeHistoryCache("sig-a", SAMPLE, { storage, now: writtenAt });
    const justUnderTtl = writtenAt + 7 * 24 * 60 * 60 * 1000 - 1;
    expect(readHistoryCache("sig-a", { storage, now: justUnderTtl })).toEqual(SAMPLE);
    const overTtl = writtenAt + 7 * 24 * 60 * 60 * 1000 + 1;
    expect(readHistoryCache("sig-a", { storage, now: overTtl })).toBeNull();
  });

  it("evicts the expired entry on read", () => {
    const storage = makeStorage();
    writeHistoryCache("sig-a", SAMPLE, { storage, now: 0 });
    const overTtl = 8 * 24 * 60 * 60 * 1000;
    expect(readHistoryCache("sig-a", { storage, now: overTtl })).toBeNull();
    expect(storage.getItem("fintrack:histcache:v1:sig-a")).toBeNull();
  });

  it("caps at 24 entries, evicting the oldest first (LRU by write time)", () => {
    const storage = makeStorage();
    for (let i = 0; i < 24; i++) {
      writeHistoryCache(`sig-${i}`, SAMPLE, { storage, now: i });
    }
    // 25th entry should evict sig-0 (the oldest).
    writeHistoryCache("sig-24", SAMPLE, { storage, now: 24 });
    expect(readHistoryCache("sig-0", { storage, now: 24 })).toBeNull();
    expect(readHistoryCache("sig-1", { storage, now: 24 })).toEqual(SAMPLE);
    expect(readHistoryCache("sig-24", { storage, now: 24 })).toEqual(SAMPLE);

    let count = 0;
    for (let i = 0; i < storage.length; i++) {
      if (storage.key(i)?.startsWith("fintrack:histcache:v1:")) count++;
    }
    expect(count).toBe(24);
  });

  it("returns null for malformed JSON instead of throwing", () => {
    const storage = makeStorage();
    storage.setItem("fintrack:histcache:v1:bad", "{not json");
    expect(readHistoryCache("bad", { storage })).toBeNull();
  });

  it("returns null for a well-formed but incomplete entry", () => {
    const storage = makeStorage();
    storage.setItem("fintrack:histcache:v1:bad", JSON.stringify({ sig: "bad" }));
    expect(readHistoryCache("bad", { storage })).toBeNull();
  });

  it("evicts oldest entries and retries once on QuotaExceededError, then gives up silently", () => {
    const storage = makeStorage();
    writeHistoryCache("sig-old", SAMPLE, { storage, now: 0 });
    // Simulate quota exceeded on the first setItem attempt for the new key
    // only; the retry (after eviction) goes through to the real stub. All
    // other methods (including the live `length` getter) delegate straight
    // through - a plain object spread would freeze `length` at copy time.
    let attempts = 0;
    const failingStorage: Storage = {
      getItem: (k: string) => storage.getItem(k),
      removeItem: (k: string) => storage.removeItem(k),
      clear: () => storage.clear(),
      key: (i: number) => storage.key(i),
      get length() {
        return storage.length;
      },
      setItem: (k: string, v: string) => {
        if (k === "fintrack:histcache:v1:sig-new" && attempts === 0) {
          attempts++;
          throw new DOMException("quota", "QuotaExceededError");
        }
        storage.setItem(k, v);
      },
    } as Storage;
    expect(() =>
      writeHistoryCache("sig-new", SAMPLE, { storage: failingStorage, now: 1 }),
    ).not.toThrow();
    // The retry succeeded after eviction freed room.
    expect(readHistoryCache("sig-new", { storage, now: 1 })).toEqual(SAMPLE);
  });

  it("gives up silently when setItem always throws QuotaExceededError", () => {
    const storage = makeStorage({ failAlways: true });
    expect(() => writeHistoryCache("sig-a", SAMPLE, { storage, now: 0 })).not.toThrow();
  });

  it("clearHistoryCache removes only prefixed keys", () => {
    const storage = makeStorage();
    writeHistoryCache("sig-a", SAMPLE, { storage, now: 0 });
    writeHistoryCache("sig-b", SAMPLE, { storage, now: 1 });
    storage.setItem("fintrack:portfolio:v1", "{\"unrelated\":true}");
    clearHistoryCache(storage);
    expect(readHistoryCache("sig-a", { storage })).toBeNull();
    expect(readHistoryCache("sig-b", { storage })).toBeNull();
    expect(storage.getItem("fintrack:portfolio:v1")).toBe("{\"unrelated\":true}");
  });

  it("returns null when window is unavailable (SSR) and no storage is injected", () => {
    // No storage passed and vitest runs in a node environment (no window),
    // so this exercises the SSR-safe fallback path.
    expect(readHistoryCache("sig-a")).toBeNull();
    expect(() => writeHistoryCache("sig-a", SAMPLE)).not.toThrow();
    expect(() => clearHistoryCache()).not.toThrow();
  });
});
