// Phase 3 of offline mode (OFFLINE_DESIGN.md §2 / §4): reconnect sync. Tests
// `drain()` against a mocked `DataStore` so the LWW replay rules are exercised
// deterministically, without a real Supabase connection — mirrors the mocking
// approach in tests/offline-store.test.ts (phase 2).

import { describe, expect, it } from "vitest";
import { emptyPortfolio, type PortfolioData, type Asset, type Transaction } from "../lib/types";
import type { AssetInput, DataStore, TransactionInput } from "../lib/store/types";
import { RowNotFoundError } from "../lib/store/types";
import { MutationQueue } from "../lib/store/mutation-queue";
import { OfflineStore } from "../lib/store/offline-store";
import { drain } from "../lib/offline/sync";

/** In-memory Storage stub (same shape as tests/offline-store.test.ts). */
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
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
  date: "2026-01-01T00:00:00.000Z",
};

/** A Postgres unique_violation, the shape SupabaseStore's insert throws on a
 *  replayed create whose id already exists server-side. */
function uniqueViolationError(): Error & { code: string } {
  const err = new Error(
    'duplicate key value violates unique constraint "assets_pkey"',
  ) as Error & { code: string };
  err.code = "23505";
  return err;
}

/** A PostgREST JWT-expired error, the shape an auth failure surfaces as. */
function authError(): Error & { code: string } {
  const err = new Error("JWT expired") as Error & { code: string };
  err.code = "PGRST301";
  return err;
}

interface InnerOpts {
  /** ids for which a create op throws a unique-violation (already synced). */
  duplicateIds?: Set<string>;
  /** ids for which an update op throws RowNotFoundError (row deleted elsewhere). */
  missingIds?: Set<string>;
  /** One-shot outcomes consumed in order by successive mutation ops —
   *  `undefined` lets that op through, so `[undefined, err]` fails the 2nd
   *  op. The attempt is still recorded in `calls` before the throw. */
  failSequence?: (Error | undefined)[];
}

/** A minimal DataStore mock recording call order, with configurable per-id
 *  and sequential failure injection to drive `drain()`'s error classification. */
function makeInner(initial: PortfolioData, opts: InnerOpts = {}) {
  const calls: string[] = [];
  const data = initial;
  const duplicateIds = opts.duplicateIds ?? new Set<string>();
  const missingIds = opts.missingIds ?? new Set<string>();
  const failSequence = [...(opts.failSequence ?? [])];

  function maybeFail(): void {
    if (failSequence.length > 0) {
      const err = failSequence.shift();
      if (err) throw err;
    }
  }

  const store: DataStore = {
    persistent: true,
    async load() {
      calls.push("load");
      return data;
    },
    async saveProfile(profile) {
      calls.push("saveProfile");
      maybeFail();
      data.profile = profile;
    },
    async addAsset(input, id) {
      calls.push(`addAsset:${id}`);
      maybeFail();
      if (id && duplicateIds.has(id)) throw uniqueViolationError();
      const asset: Asset = { ...input, id: id ?? "server-id" };
      data.assets.push(asset);
      return asset;
    },
    async updateAsset(id, patch) {
      calls.push(`updateAsset:${id}`);
      maybeFail();
      if (missingIds.has(id)) throw new RowNotFoundError(`asset ${id} not found`);
      const idx = data.assets.findIndex((a) => a.id === id);
      if (idx >= 0) data.assets[idx] = { ...data.assets[idx], ...patch };
    },
    async deleteAsset(id) {
      calls.push(`deleteAsset:${id}`);
      maybeFail();
      data.assets = data.assets.filter((a) => a.id !== id);
    },
    async addTransaction(input, id) {
      calls.push(`addTransaction:${id}`);
      maybeFail();
      if (id && duplicateIds.has(id)) throw uniqueViolationError();
      const tx: Transaction = { ...input, id: id ?? "server-id" };
      data.transactions.push(tx);
      return tx;
    },
    async updateTransaction(id, patch) {
      calls.push(`updateTransaction:${id}`);
      maybeFail();
      if (missingIds.has(id)) throw new RowNotFoundError(`transaction ${id} not found`);
      const idx = data.transactions.findIndex((t) => t.id === id);
      if (idx >= 0) data.transactions[idx] = { ...data.transactions[idx], ...patch };
    },
    async deleteTransaction(id) {
      calls.push(`deleteTransaction:${id}`);
      maybeFail();
      data.transactions = data.transactions.filter((t) => t.id !== id);
    },
    async createPortfolio(name, id) {
      calls.push(`createPortfolio:${id}`);
      maybeFail();
      if (id && duplicateIds.has(id)) throw uniqueViolationError();
      const p = { id: id ?? "server-id", name };
      data.portfolios.push(p);
      return p;
    },
    async renamePortfolio(id) {
      calls.push(`renamePortfolio:${id}`);
      maybeFail();
    },
    async deletePortfolio(id) {
      calls.push(`deletePortfolio:${id}`);
      maybeFail();
    },
    async loadSimulation() {
      calls.push("loadSimulation");
      return null;
    },
    async saveSimulation() {
      calls.push("saveSimulation");
    },
    async loadImportedFingerprints() {
      calls.push("loadImportedFingerprints");
      return [];
    },
    async addImportedFingerprints() {
      calls.push("addImportedFingerprints");
    },
  };

  return { store, calls };
}

describe("drain", () => {
  it("replays ops in seq order", async () => {
    const storage = makeStorage();
    const queue = new MutationQueue("user-1", storage);
    queue.append("addAsset", "user-1", "a1", { ...ASSET_INPUT, name: "First" });
    queue.append("addAsset", "user-1", "a2", { ...ASSET_INPUT, name: "Second" });
    queue.append("addAsset", "user-1", "a3", { ...ASSET_INPUT, name: "Third" });
    const { store, calls } = makeInner(emptyPortfolio());

    const result = await drain(queue, store, "user-1");

    expect(calls).toEqual(["addAsset:a1", "addAsset:a2", "addAsset:a3", "load"]);
    expect(result).toMatchObject({ applied: 3, dropped: 0, status: "synced" });
    expect(queue.peek()).toHaveLength(0);
  });

  it("acks a unique-violation on create as already-synced", async () => {
    const storage = makeStorage();
    const queue = new MutationQueue("user-1", storage);
    queue.append("addAsset", "user-1", "dup-1", ASSET_INPUT);
    const { store } = makeInner(emptyPortfolio(), { duplicateIds: new Set(["dup-1"]) });

    const result = await drain(queue, store, "user-1");

    expect(result).toMatchObject({ applied: 1, dropped: 0, status: "synced" });
    expect(queue.peek()).toHaveLength(0);
  });

  it("drops (and counts) an update whose row no longer exists server-side", async () => {
    const storage = makeStorage();
    const queue = new MutationQueue("user-1", storage);
    queue.append("updateAsset", "user-1", "gone-1", { notes: "edited offline" });
    const { store } = makeInner(emptyPortfolio(), { missingIds: new Set(["gone-1"]) });

    const result = await drain(queue, store, "user-1");

    expect(result).toMatchObject({ applied: 0, dropped: 1, status: "synced" });
    expect(queue.peek()).toHaveLength(0);
  });

  it("treats delete-of-an-absent-row as a no-op success", async () => {
    const storage = makeStorage();
    const queue = new MutationQueue("user-1", storage);
    queue.append("deleteAsset", "user-1", "already-gone", null);
    const { store, calls } = makeInner(emptyPortfolio());

    const result = await drain(queue, store, "user-1");

    expect(calls).toContain("deleteAsset:already-gone");
    expect(result).toMatchObject({ applied: 1, dropped: 0, status: "synced" });
    expect(queue.peek()).toHaveLength(0);
  });

  it("pauses on an auth failure, keeping the remaining ops queued", async () => {
    const storage = makeStorage();
    const queue = new MutationQueue("user-1", storage);
    queue.append("addAsset", "user-1", "a1", ASSET_INPUT);
    queue.append("addAsset", "user-1", "a2", ASSET_INPUT);
    queue.append("addAsset", "user-1", "a3", ASSET_INPUT);
    // a2 fails with an expired-JWT-shaped error.
    const { store, calls } = makeInner(emptyPortfolio(), {
      failSequence: [undefined, authError()],
    });

    const result = await drain(queue, store, "user-1");

    // a2 was attempted (and hit the 401); a3 was never attempted, and no
    // reconciling load() happened — the drain stopped dead per §5.2.
    expect(calls).toEqual(["addAsset:a1", "addAsset:a2"]);
    expect(result).toMatchObject({ applied: 1, dropped: 0, status: "paused" });
    expect(queue.peek().map((o) => o.id)).toEqual(["a2", "a3"]);
  });

  it("refuses to drain a queue belonging to a different signed-in user", async () => {
    const storage = makeStorage();
    const queue = new MutationQueue("user-a", storage);
    queue.append("addAsset", "user-a", "a1", ASSET_INPUT);
    const { store, calls } = makeInner(emptyPortfolio());

    const result = await drain(queue, store, "user-b");

    expect(result).toEqual({ applied: 0, dropped: 0, status: "refused" });
    expect(calls).toHaveLength(0);
    expect(queue.peek()).toHaveLength(1); // untouched
  });

  it("stops on an unclassified failure, keeping the unacked tail (partial failure)", async () => {
    const storage = makeStorage();
    const queue = new MutationQueue("user-1", storage);
    queue.append("addAsset", "user-1", "a1", ASSET_INPUT);
    queue.append("addAsset", "user-1", "a2", ASSET_INPUT);
    queue.append("addAsset", "user-1", "a3", ASSET_INPUT);
    const { store, calls } = makeInner(emptyPortfolio(), {
      failSequence: [undefined, new Error("some unexpected failure")],
    });

    const result = await drain(queue, store, "user-1");

    expect(calls).toEqual(["addAsset:a1", "addAsset:a2"]);
    expect(result).toMatchObject({ applied: 1, dropped: 0, status: "interrupted" });
    // a2 (the failed op) and a3 (never attempted) both stay queued.
    expect(queue.peek().map((o) => o.id)).toEqual(["a2", "a3"]);
  });

  it("returns freshly loaded server data on a full drain", async () => {
    const storage = makeStorage();
    const queue = new MutationQueue("user-1", storage);
    queue.append("addTransaction", "user-1", "tx-1", TX_INPUT);
    const seeded = emptyPortfolio();
    const { store } = makeInner(seeded);

    const result = await drain(queue, store, "user-1");

    expect(result.status).toBe("synced");
    expect(result.data?.transactions.map((t) => t.id)).toEqual(["tx-1"]);
  });

  it("does nothing and reports synced for an already-empty queue", async () => {
    const storage = makeStorage();
    const queue = new MutationQueue("user-1", storage);
    const { store, calls } = makeInner(emptyPortfolio());

    const result = await drain(queue, store, "user-1");

    expect(result).toEqual({ applied: 0, dropped: 0, status: "synced" });
    expect(calls).toHaveLength(0); // never even calls load() when there's nothing to reconcile
  });
});

describe("OfflineStore.sync (seam)", () => {
  it("exposes pendingCount and reconciles the mirror after a full drain", async () => {
    const storage = makeStorage();
    const inner = makeInner(emptyPortfolio());
    const offline = new OfflineStore(inner.store, "user-1", storage);

    // Queue a mutation the way OfflineStore itself would: force the inner
    // call to fail with a network error so it's enqueued, not applied inline.
    const networkErr = new TypeError("Failed to fetch");
    const originalAddAsset = inner.store.addAsset.bind(inner.store);
    let first = true;
    inner.store.addAsset = async (input, id) => {
      if (first) {
        first = false;
        throw networkErr;
      }
      return originalAddAsset(input, id);
    };
    const asset = await offline.addAsset(ASSET_INPUT);
    expect(offline.pendingCount).toBe(1);

    const result = await offline.sync("user-1");

    expect(result.status).toBe("synced");
    expect(offline.pendingCount).toBe(0);
    expect(result.data?.assets.some((a) => a.id === asset.id)).toBe(true);
  });

  it("refuses when synced against a different user id than it was constructed for", async () => {
    const storage = makeStorage();
    const inner = makeInner(emptyPortfolio());
    const offline = new OfflineStore(inner.store, "user-1", storage);

    const result = await offline.sync("user-2");

    expect(result.status).toBe("refused");
  });
});
