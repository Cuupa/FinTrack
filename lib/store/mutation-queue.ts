// Durable ordered op-log for offline mutations — OFFLINE_DESIGN.md §2 phase 2
// / §5.4. Persisted to localStorage keyed *per user*
// (`fintrack:queue:<userId>:v1`) so switching accounts, or falling back to
// Guest Mode, never blends or leaks another account's pending writes.
//
// This is the table phase 3 ("reconnect sync") will drain: `peek()` returns
// ops in `seq` order, `ack()` removes the ones that synced. Kept ops-only
// (never simulation results or anything large) to stay well under the
// localStorage quota — but a lost queue write IS a lost mutation, so a quota
// failure on `append` is a hard, surfaced error, never swallowed.

import { memoryStorageFallback } from "./local-store";

export type MutationOp =
  | "saveProfile"
  | "addAsset"
  | "updateAsset"
  | "deleteAsset"
  | "addTransaction"
  | "updateTransaction"
  | "deleteTransaction"
  | "addWatchlistItem"
  | "removeWatchlistItem"
  | "updateWatchlistItem"
  | "addSavingsPlan"
  | "updateSavingsPlan"
  | "deleteSavingsPlan"
  | "createPortfolio"
  | "renamePortfolio"
  | "deletePortfolio";

/** One queued op, matching the shape frozen in OFFLINE_DESIGN.md §2. */
export interface QueuedMutation {
  seq: number;
  ts: string;
  userId: string;
  op: MutationOp;
  id: string;
  payload: unknown;
}

const QUEUE_PREFIX = "fintrack:queue:";
const QUEUE_VERSION = "v1";

export function mutationQueueKey(userId: string): string {
  return `${QUEUE_PREFIX}${userId}:${QUEUE_VERSION}`;
}

export class MutationQueue {
  private storage: Storage;
  private key: string;

  constructor(userId: string, storage?: Storage) {
    this.storage = storage ?? memoryStorageFallback();
    this.key = mutationQueueKey(userId);
  }

  private readAll(): QueuedMutation[] {
    try {
      const raw = this.storage.getItem(this.key);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as QueuedMutation[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private writeAll(ops: QueuedMutation[]): void {
    try {
      this.storage.setItem(this.key, JSON.stringify(ops));
    } catch (cause) {
      // §5.4: "a queue write lost to quota = a lost mutation" — surface it so
      // the caller (OfflineStore) propagates a hard error to the UI instead
      // of pretending the change was saved.
      throw new Error(
        "Couldn't save this change for offline sync: local storage is full. " +
          "Free up space (or reconnect) and try again.",
        { cause },
      );
    }
  }

  /**
   * Appends a new op with the next monotonic seq for this user. Throws (does
   * not enqueue) on a localStorage quota failure — see class docs.
   */
  append(op: MutationOp, userId: string, id: string, payload: unknown): QueuedMutation {
    const ops = this.readAll();
    const nextSeq = ops.reduce((max, o) => Math.max(max, o.seq), 0) + 1;
    const entry: QueuedMutation = {
      seq: nextSeq,
      ts: new Date().toISOString(),
      userId,
      op,
      id,
      payload,
    };
    this.writeAll([...ops, entry]);
    return entry;
  }

  /** All queued ops, oldest (lowest seq) first. Read-only — does not ack. */
  peek(): QueuedMutation[] {
    return this.readAll().sort((a, b) => a.seq - b.seq);
  }

  /** Removes the given seqs (already synced by the phase-3 drain). */
  ack(seqs: number[]): void {
    if (seqs.length === 0) return;
    const drop = new Set(seqs);
    this.writeAll(this.readAll().filter((o) => !drop.has(o.seq)));
  }

  /** Drops every queued op for this user (e.g. after a full drain). */
  clear(): void {
    try {
      this.storage.removeItem(this.key);
    } catch {
      /* best-effort */
    }
  }

  get length(): number {
    return this.readAll().length;
  }
}
