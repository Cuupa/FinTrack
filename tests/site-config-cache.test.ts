// Client-side site-config cache (lib/site-config-cache.ts). Same in-memory
// Storage stub pattern as tests/history-cache.test.ts (no DOM/localStorage in
// the node test environment).

import { describe, expect, it } from "vitest";
import {
  readSiteConfigCache,
  writeSiteConfigCache,
  siteConfigEquals,
  createSiteConfigStore,
} from "../lib/site-config-cache";
import type { SiteConfigMap } from "../lib/site-config-cache";

function makeStorage(opts?: { failAlways?: boolean }): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts?.failAlways) {
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

const SAMPLE: SiteConfigMap = {
  legal_name: "Jane Doe",
  legal_street: "Musterstraße 1",
  legal_city: "12345 Berlin",
  legal_email: "jane@example.com",
};

describe("site-config-cache", () => {
  it("round-trips a write then read", () => {
    const storage = makeStorage();
    writeSiteConfigCache(SAMPLE, { storage });
    expect(readSiteConfigCache({ storage })).toEqual(SAMPLE);
  });

  it("misses when nothing is cached", () => {
    const storage = makeStorage();
    expect(readSiteConfigCache({ storage })).toBeNull();
  });

  it("returns null for malformed JSON instead of throwing", () => {
    const storage = makeStorage();
    storage.setItem("fintrack-site-config", "{not json");
    expect(readSiteConfigCache({ storage })).toBeNull();
  });

  it("returns null for a non-object payload", () => {
    const storage = makeStorage();
    storage.setItem("fintrack-site-config", JSON.stringify(["array", "not", "object"]));
    expect(readSiteConfigCache({ storage })).toBeNull();
  });

  it("drops unknown keys and non-string values, keeping only known SiteConfigKeys", () => {
    const storage = makeStorage();
    storage.setItem(
      "fintrack-site-config",
      JSON.stringify({ legal_name: "Jane Doe", legal_email: 12345, unknown_key: "x" }),
    );
    expect(readSiteConfigCache({ storage })).toEqual({ legal_name: "Jane Doe" });
  });

  it("gives up silently on a QuotaExceededError during write", () => {
    const storage = makeStorage({ failAlways: true });
    expect(() => writeSiteConfigCache(SAMPLE, { storage })).not.toThrow();
    expect(readSiteConfigCache({ storage })).toBeNull();
  });

  it("returns null / no-ops when window is unavailable (SSR) and no storage is injected", () => {
    expect(readSiteConfigCache()).toBeNull();
    expect(() => writeSiteConfigCache(SAMPLE)).not.toThrow();
  });

  describe("siteConfigEquals", () => {
    it("is true for identical maps", () => {
      expect(siteConfigEquals(SAMPLE, { ...SAMPLE })).toBe(true);
    });

    it("is true for two empty maps", () => {
      expect(siteConfigEquals({}, {})).toBe(true);
    });

    it("is false when a value differs", () => {
      expect(siteConfigEquals(SAMPLE, { ...SAMPLE, legal_name: "John Doe" })).toBe(false);
    });

    it("is false when one map has a key the other lacks", () => {
      expect(siteConfigEquals(SAMPLE, { legal_name: SAMPLE.legal_name })).toBe(false);
    });
  });

  describe("createSiteConfigStore", () => {
    it("getSnapshot returns a stable reference across repeated calls", () => {
      const store = createSiteConfigStore({ storage: makeStorage() });
      expect(store.getSnapshot()).toBe(store.getSnapshot());
    });

    it("getSnapshot starts from whatever is already cached in storage", () => {
      const storage = makeStorage();
      writeSiteConfigCache(SAMPLE, { storage });
      const store = createSiteConfigStore({ storage });
      expect(store.getSnapshot()).toEqual(SAMPLE);
    });

    it("getServerSnapshot always returns the same empty object", () => {
      const store = createSiteConfigStore({ storage: makeStorage() });
      expect(store.getServerSnapshot()).toEqual({});
      expect(store.getServerSnapshot()).toBe(store.getServerSnapshot());
    });

    it("update() with a differing payload writes through and notifies subscribers", () => {
      const storage = makeStorage();
      const store = createSiteConfigStore({ storage });
      let notified = 0;
      store.subscribe(() => notified++);

      const before = store.getSnapshot();
      store.update(SAMPLE);

      expect(notified).toBe(1);
      expect(store.getSnapshot()).toEqual(SAMPLE);
      expect(store.getSnapshot()).not.toBe(before);
      expect(readSiteConfigCache({ storage })).toEqual(SAMPLE);
    });

    it("update() with an identical payload does not rewrite storage or notify", () => {
      const storage = makeStorage();
      writeSiteConfigCache(SAMPLE, { storage });
      const store = createSiteConfigStore({ storage });
      const before = store.getSnapshot();

      let notified = 0;
      store.subscribe(() => notified++);
      store.update({ ...SAMPLE });

      expect(notified).toBe(0);
      expect(store.getSnapshot()).toBe(before);
    });

    it("unsubscribe stops further notifications", () => {
      const store = createSiteConfigStore({ storage: makeStorage() });
      let notified = 0;
      const unsubscribe = store.subscribe(() => notified++);
      unsubscribe();
      store.update(SAMPLE);
      expect(notified).toBe(0);
    });
  });
});
