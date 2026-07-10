// Phase 2 of offline mode (OFFLINE_DESIGN.md §2 / §3): the durable mutation
// queue and the OfflineStore wrapper that keeps Registered Mode usable
// without a network connection. The inner store is mocked so these tests
// exercise only the queue/mirror/enqueue behaviour, not real Supabase calls.

import { describe, expect, it } from "vitest";
import { emptyPortfolio, type PortfolioData } from "../lib/types";
import type { AssetInput, DataStore, TransactionInput } from "../lib/store/types";
import { MutationQueue, mutationQueueKey } from "../lib/store/mutation-queue";
import { OfflineStore } from "../lib/store/offline-store";
import { mirrorStorageKeys } from "../lib/store/local-store";

const GUEST_KEY = "fintrack:portfolio:v1";

/** In-memory Storage stub. Optionally throws on setItem for a given key, to
 *  simulate a localStorage quota failure. */
function makeStorage(opts?: { failOnKey?: string }): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts?.failOnKey && k === opts.failOnKey) {
        const err = new DOMException("The quota has been exceeded.", "QuotaExceededError");
        throw err;
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

const ASSET_INPUT: AssetInput = {
  isin: "US0378331005",
  wkn: null,
  symbol: null,
  name: "Apple Inc.",
  type: "STOCK",
  currency: "USD",
  notes: null,
};

const TX_INPUT: TransactionInput = {
  assetId: "asset-1",
  portfolioId: "default",
  type: "BUY",
  quantity: 1,
  price: 100,
  fee: 0,
  tax: 0,
  date: "2026-01-01T00:00:00.000Z",
};

/** A minimal DataStore mock that records calls and can be told to reject the
 *  next call — with either a network-style error or a generic app error. */
function makeInner(initial: PortfolioData) {
  const calls: string[] = [];
  let nextFailure: Error | null = null;
  const data = initial;

  function guard() {
    if (nextFailure) {
      const err = nextFailure;
      nextFailure = null;
      throw err;
    }
  }

  const store: DataStore = {
    persistent: true,
    async load() {
      calls.push("load");
      guard();
      return data;
    },
    async saveProfile(profile) {
      calls.push("saveProfile");
      guard();
      data.profile = profile;
    },
    async addAsset(input, id) {
      calls.push("addAsset");
      guard();
      const asset = { ...input, id: id ?? "server-generated-id" };
      data.assets.push(asset);
      return asset;
    },
    async updateAsset() {
      calls.push("updateAsset");
      guard();
    },
    async deleteAsset() {
      calls.push("deleteAsset");
      guard();
    },
    async addTransaction(input, id) {
      calls.push("addTransaction");
      guard();
      const tx = { ...input, id: id ?? "server-generated-id" };
      data.transactions.push(tx);
      return tx;
    },
    async updateTransaction() {
      calls.push("updateTransaction");
      guard();
    },
    async deleteTransaction() {
      calls.push("deleteTransaction");
      guard();
    },
    async addWatchlistItem(input, id) {
      calls.push("addWatchlistItem");
      guard();
      const item = { ...input, id: id ?? "server-generated-id" };
      data.watchlist.push(item);
      return item;
    },
    async removeWatchlistItem() {
      calls.push("removeWatchlistItem");
      guard();
    },
    async updateWatchlistItem() {
      calls.push("updateWatchlistItem");
      guard();
    },
    async addSavingsPlan(input, id) {
      calls.push("addSavingsPlan");
      guard();
      const plan = { ...input, id: id ?? "server-generated-id" };
      data.savingsPlans.push(plan);
      return plan;
    },
    async updateSavingsPlan() {
      calls.push("updateSavingsPlan");
      guard();
    },
    async deleteSavingsPlan() {
      calls.push("deleteSavingsPlan");
      guard();
    },
    async createPortfolio(name, id) {
      calls.push("createPortfolio");
      guard();
      const p = { id: id ?? "server-generated-id", name };
      data.portfolios.push(p);
      return p;
    },
    async renamePortfolio() {
      calls.push("renamePortfolio");
      guard();
    },
    async deletePortfolio() {
      calls.push("deletePortfolio");
      guard();
    },
    async loadSimulation() {
      calls.push("loadSimulation");
      guard();
      return null;
    },
    async saveSimulation() {
      calls.push("saveSimulation");
      guard();
    },
    async loadImportedFingerprints() {
      calls.push("loadImportedFingerprints");
      guard();
      return [];
    },
    async addImportedFingerprints() {
      calls.push("addImportedFingerprints");
      guard();
    },
  };

  return {
    store,
    calls,
    failNext(err: Error) {
      nextFailure = err;
    },
  };
}

const NETWORK_ERROR = () => new TypeError("Failed to fetch");

describe("MutationQueue", () => {
  it("append assigns increasing seq numbers and persists ops", () => {
    const storage = makeStorage();
    const queue = new MutationQueue("user-1", storage);
    const a = queue.append("addAsset", "user-1", "asset-1", { name: "Apple" });
    const b = queue.append("addTransaction", "user-1", "tx-1", { qty: 1 });
    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(queue.length).toBe(2);
  });

  it("peek returns ops oldest-first regardless of insertion quirks", () => {
    const storage = makeStorage();
    const queue = new MutationQueue("user-1", storage);
    queue.append("addAsset", "user-1", "a1", {});
    queue.append("addAsset", "user-1", "a2", {});
    queue.append("addAsset", "user-1", "a3", {});
    const ops = queue.peek();
    expect(ops.map((o) => o.seq)).toEqual([1, 2, 3]);
    expect(ops.map((o) => o.id)).toEqual(["a1", "a2", "a3"]);
  });

  it("ack removes only the acked ops, in order", () => {
    const storage = makeStorage();
    const queue = new MutationQueue("user-1", storage);
    queue.append("addAsset", "user-1", "a1", {});
    const b = queue.append("addAsset", "user-1", "a2", {});
    queue.append("addAsset", "user-1", "a3", {});
    queue.ack([b.seq]);
    const remaining = queue.peek();
    expect(remaining.map((o) => o.id)).toEqual(["a1", "a3"]);
  });

  it("clear empties the queue", () => {
    const storage = makeStorage();
    const queue = new MutationQueue("user-1", storage);
    queue.append("addAsset", "user-1", "a1", {});
    queue.clear();
    expect(queue.length).toBe(0);
  });

  it("scopes queues per user via distinct storage keys", () => {
    const storage = makeStorage();
    const queueA = new MutationQueue("user-a", storage);
    const queueB = new MutationQueue("user-b", storage);
    queueA.append("addAsset", "user-a", "a1", {});
    queueB.append("addAsset", "user-b", "b1", {});

    expect(queueA.peek().map((o) => o.id)).toEqual(["a1"]);
    expect(queueB.peek().map((o) => o.id)).toEqual(["b1"]);
    expect(mutationQueueKey("user-a")).not.toBe(mutationQueueKey("user-b"));
    expect(mutationQueueKey("user-a")).toBe("fintrack:queue:user-a:v1");
  });

  it("throws (never silently drops) when localStorage quota is exceeded", () => {
    const key = mutationQueueKey("user-1");
    const storage = makeStorage({ failOnKey: key });
    const queue = new MutationQueue("user-1", storage);
    expect(() => queue.append("addAsset", "user-1", "a1", {})).toThrow();
    // The failed append must not silently appear to have succeeded.
    expect(queue.length).toBe(0);
  });
});

describe("OfflineStore", () => {
  it("applies addAsset to the mirror and enqueues the op when inner throws a network error", async () => {
    const storage = makeStorage();
    const inner = makeInner(emptyPortfolio());
    inner.failNext(NETWORK_ERROR());
    const offline = new OfflineStore(inner.store, "user-1", storage);

    const asset = await offline.addAsset(ASSET_INPUT);

    // Mirror was written optimistically — inspect its storage key directly
    // (rather than via offline.load(), which would round-trip inner and is
    // exercised separately below).
    const raw = storage.getItem(mirrorStorageKeys("user-1").portfolio);
    expect(raw).not.toBeNull();
    const mirrorData = JSON.parse(raw as string) as PortfolioData;
    expect(mirrorData.assets.some((a) => a.id === asset.id)).toBe(true);

    // The failed mutation was queued, not dropped.
    const queue = new MutationQueue("user-1", storage);
    const queued = queue.peek();
    expect(queued).toHaveLength(1);
    expect(queued[0].op).toBe("addAsset");
    expect(queued[0].userId).toBe("user-1");

    // The id assigned to the mirror entity and the id in the queued op match
    // (OFFLINE_DESIGN.md §3 — required for idempotent replay).
    expect(queued[0].id).toBe(asset.id);
  });

  it("assigns the same id to addTransaction's mirror entity and its queued op", async () => {
    const storage = makeStorage();
    const inner = makeInner(emptyPortfolio());
    inner.failNext(NETWORK_ERROR());
    const offline = new OfflineStore(inner.store, "user-1", storage);

    const tx = await offline.addTransaction(TX_INPUT);

    const queue = new MutationQueue("user-1", storage);
    const queued = queue.peek();
    expect(queued).toHaveLength(1);
    expect(queued[0].op).toBe("addTransaction");
    expect(queued[0].id).toBe(tx.id);
  });

  it("does not enqueue and rethrows on a non-network (application) error", async () => {
    const storage = makeStorage();
    const inner = makeInner(emptyPortfolio());
    inner.failNext(new Error("You can have at most 20 portfolios."));
    const offline = new OfflineStore(inner.store, "user-1", storage);

    await expect(offline.createPortfolio("Too many")).rejects.toThrow(
      "at most 20 portfolios",
    );

    const queue = new MutationQueue("user-1", storage);
    expect(queue.peek()).toHaveLength(0);
  });

  it("load() falls back to the mirror when inner.load() rejects with a network error", async () => {
    const storage = makeStorage();
    const seeded = emptyPortfolio();
    seeded.assets.push({ ...ASSET_INPUT, id: "seed-asset" });
    const inner = makeInner(seeded);

    const offline = new OfflineStore(inner.store, "user-1", storage);
    // First load succeeds online and write-throughs the mirror.
    const first = await offline.load();
    expect(first.assets.map((a) => a.id)).toEqual(["seed-asset"]);

    // Now the network drops for a second load — must fall back to mirror.
    inner.failNext(NETWORK_ERROR());
    const second = await offline.load();
    expect(second.assets.map((a) => a.id)).toEqual(["seed-asset"]);
  });

  it("load() rethrows a non-network error instead of masking it as offline", async () => {
    const storage = makeStorage();
    const inner = makeInner(emptyPortfolio());
    inner.failNext(new Error("permission denied"));
    const offline = new OfflineStore(inner.store, "user-1", storage);

    await expect(offline.load()).rejects.toThrow("permission denied");
  });

  it("never touches the guest LocalStore key", async () => {
    const storage = makeStorage();
    const inner = makeInner(emptyPortfolio());
    inner.failNext(NETWORK_ERROR());
    const offline = new OfflineStore(inner.store, "user-1", storage);

    await offline.addAsset(ASSET_INPUT);
    await offline.load().catch(() => {});

    expect(storage.getItem(GUEST_KEY)).toBeNull();
  });

  it("mirror storage key is scoped per user and distinct from the guest key", () => {
    const keysA = mirrorStorageKeys("user-a");
    const keysB = mirrorStorageKeys("user-b");
    expect(keysA.portfolio).not.toBe(GUEST_KEY);
    expect(keysA.portfolio).not.toBe(keysB.portfolio);
    expect(keysA.simulations).not.toBe(keysB.simulations);
    expect(keysA.imported).not.toBe(keysB.imported);
  });
});
