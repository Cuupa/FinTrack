// Guest Mode storage-quota handling (PROD_READY.md "Guest portfolio write can
// throw and lose data"): LocalStore.write() must never let a quota failure
// crash uncaught, nor silently swallow it, it tags the error so callers know
// the mutation did not persist. See lib/store/errors.ts.

import { describe, expect, it } from "vitest";
import { LocalStore } from "../lib/store/local-store";
import { isStorageFullError, StorageFullError } from "../lib/store/errors";

const ASSET_INPUT = {
  isin: "US0378331005",
  wkn: null,
  symbol: null,
  name: "Apple Inc.",
  type: "STOCK" as const,
  currency: "USD",
  notes: null,
};

/** In-memory Storage stub whose setItem always throws a given error. */
function makeThrowingStorage(err: unknown): Storage {
  return {
    getItem: () => null,
    setItem: () => {
      throw err;
    },
    removeItem: () => {},
    clear: () => {},
    key: () => null,
    get length() {
      return 0;
    },
  } as Storage;
}

/** In-memory Storage stub whose setItem succeeds `okCalls` times, then throws. */
function makeStorageThrowingAfter(okCalls: number, err: unknown): Storage {
  const map = new Map<string, string>();
  let calls = 0;
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      calls++;
      if (calls > okCalls) throw err;
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

const QUOTA_EXCEEDED = () =>
  new DOMException("The quota has been exceeded.", "QuotaExceededError");
const LEGACY_QUOTA_EXCEEDED = () =>
  new DOMException("The quota has been exceeded.", "NS_ERROR_DOM_QUOTA_REACHED");

describe("LocalStore quota handling", () => {
  it("tags a QuotaExceededError as StorageFullError and rejects addAsset", async () => {
    const store = new LocalStore(makeThrowingStorage(QUOTA_EXCEEDED()));
    await expect(store.addAsset(ASSET_INPUT)).rejects.toSatisfy(isStorageFullError);
  });

  it("recognises the legacy Firefox quota error name too", async () => {
    const store = new LocalStore(makeThrowingStorage(LEGACY_QUOTA_EXCEEDED()));
    await expect(store.addAsset(ASSET_INPUT)).rejects.toSatisfy(isStorageFullError);
  });

  it("recognises a quota DOMException identified only by legacy code 22", async () => {
    // Some engines report the quota failure via `code` rather than `name`.
    const err = new DOMException("quota", "SomeOtherName");
    Object.defineProperty(err, "code", { value: 22 });
    const store = new LocalStore(makeThrowingStorage(err));
    await expect(store.addAsset(ASSET_INPUT)).rejects.toSatisfy(isStorageFullError);
  });

  it("rethrows a non-quota error untagged", async () => {
    const boom = new Error("disk on fire");
    const store = new LocalStore(makeThrowingStorage(boom));
    await expect(store.addAsset(ASSET_INPUT)).rejects.toBe(boom);
    await expect(store.addAsset(ASSET_INPUT)).rejects.not.toSatisfy(isStorageFullError);
  });

  it("StorageFullError has a stable name distinct from a generic Error", () => {
    const err = new StorageFullError();
    expect(err.name).toBe("StorageFullError");
    expect(isStorageFullError(err)).toBe(true);
    expect(isStorageFullError(new Error("StorageFullError"))).toBe(false); // message text, not name
    expect(isStorageFullError(new Error("nope"))).toBe(false);
    expect(isStorageFullError(null)).toBe(false);
  });

  it("leaves the previously-persisted data untouched after a failed write", async () => {
    const storage = makeStorageThrowingAfter(1, QUOTA_EXCEEDED());
    const store = new LocalStore(storage);
    const first = await store.addAsset(ASSET_INPUT);
    expect(first).toBeTruthy();

    // Second write throws (once-throwing stub); the add must reject and the
    // stored snapshot from the first successful write must be unchanged.
    const before = storage.getItem("fintrack:portfolio:v1");
    await expect(
      store.addAsset({ ...ASSET_INPUT, isin: "DE0007236101", name: "Siemens AG" }),
    ).rejects.toSatisfy(isStorageFullError);
    expect(storage.getItem("fintrack:portfolio:v1")).toBe(before);

    // A subsequent successful load only has the first asset.
    const data = await store.load();
    expect(data.assets).toHaveLength(1);
    expect(data.assets[0].name).toBe("Apple Inc.");
  });
});
