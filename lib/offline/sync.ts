// Phase 3 of offline mode (OFFLINE_DESIGN.md §2 / §4): reconnect sync. `drain`
// replays a user's queued mutations (`lib/store/mutation-queue.ts`) against
// the real store, in order, applying the last-write-wins rules frozen in §4:
//
//   - create  → insert-with-id; a unique-violation means another replay (or
//               the original online attempt) already got it there — treat as
//               already-synced, not a failure.
//   - update  → update; if the row is gone server-side, a cross-device delete
//               has already won — drop the op instead of resurrecting it.
//   - delete  → delete; already-absent is a no-op (idempotent).
//   - anything else (auth failure, network blip, unexpected error) stops the
//     drain immediately so the remaining ops stay queued for the next
//     attempt — never dropped, never partially retried out of order.
//
// This module is pure: it only knows about `DataStore` + `MutationQueue`, no
// React, no Supabase types. `OfflineStore.sync()` (lib/store/offline-store.ts)
// is the thin, stateful wrapper that owns *which* queue/inner/mirror to use.

import type { LlmConfig, PortfolioData, Profile } from "../types";
import { RowNotFoundError } from "../store/types";
import type {
  AccountInput,
  AssetInput,
  DataStore,
  PortfolioPatch,
  SavingsPlanInput,
  TransactionInput,
  WatchlistInput,
} from "../store/types";
import type { MutationQueue, QueuedMutation } from "../store/mutation-queue";

export type DrainStatus =
  /** Every op that could be applied was; queue may still be non-empty only
   *  if it was already empty going in (nothing to do). */
  | "synced"
  /** Stopped on an auth failure (expired/invalid session) — §5.2: keep the
   *  queue, the caller should prompt re-login. */
  | "paused"
  /** Stopped on some other error (network blip, unexpected app error) —
   *  queue is kept for a later retry, no re-login implied. */
  | "interrupted"
  /** The signed-in user doesn't own this queue — refused outright, queue
   *  untouched (§5.2's cross-account guard). */
  | "refused";

export interface DrainResult {
  /** Ops that were applied (including unique-violation treated as already-synced). */
  applied: number;
  /** Ops dropped because their target row no longer exists (§4 rule 2). */
  dropped: number;
  status: DrainStatus;
  /**
   * Freshly reloaded server data, present only when `status === "synced"` and
   * at least one op was processed. `OfflineStore.sync()` writes this into its
   * mirror so the offline cache reflects the same reconciliation `load()`
   * would have produced — one round trip instead of two.
   */
  data?: PortfolioData;
}

/** Postgres unique_violation. */
const PG_UNIQUE_VIOLATION = "23505";
/** PostgREST's code for a JWT that failed verification (expired/invalid). */
const PGRST_JWT_INVALID = "PGRST301";
/** Postgres insufficient_privilege — also how an RLS policy denial surfaces. */
const PG_INSUFFICIENT_PRIVILEGE = "42501";

type ErrorKind = "unique" | "notFound" | "auth" | "other";

function classify(err: unknown): ErrorKind {
  if (err instanceof RowNotFoundError) return "notFound";
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (code === PG_UNIQUE_VIOLATION) return "unique";
    if (code === PGRST_JWT_INVALID || code === PG_INSUFFICIENT_PRIVILEGE) return "auth";
    const status = (err as { status?: unknown }).status;
    if (status === 401 || status === 403) return "auth";
  }
  if (err instanceof Error && /jwt|token.*expired|not authenticated|unauthorized|invalid.*session/i.test(err.message)) {
    return "auth";
  }
  return "other";
}

async function applyOp(inner: DataStore, op: QueuedMutation): Promise<void> {
  switch (op.op) {
    case "saveProfile":
      await inner.saveProfile(op.payload as Profile);
      return;
    case "addAsset":
      await inner.addAsset(op.payload as AssetInput, op.id);
      return;
    case "updateAsset":
      await inner.updateAsset(op.id, op.payload as Partial<AssetInput>);
      return;
    case "deleteAsset":
      await inner.deleteAsset(op.id);
      return;
    case "addTransaction":
      await inner.addTransaction(op.payload as TransactionInput, op.id);
      return;
    case "updateTransaction":
      await inner.updateTransaction(op.id, op.payload as Partial<TransactionInput>);
      return;
    case "deleteTransaction":
      await inner.deleteTransaction(op.id);
      return;
    case "addWatchlistItem":
      await inner.addWatchlistItem(op.payload as WatchlistInput, op.id);
      return;
    case "removeWatchlistItem":
      await inner.removeWatchlistItem(op.id);
      return;
    case "updateWatchlistItem":
      await inner.updateWatchlistItem(op.id, op.payload as Partial<WatchlistInput>);
      return;
    case "addSavingsPlan":
      await inner.addSavingsPlan(op.payload as SavingsPlanInput, op.id);
      return;
    case "updateSavingsPlan":
      await inner.updateSavingsPlan(op.id, op.payload as Partial<SavingsPlanInput>);
      return;
    case "deleteSavingsPlan":
      await inner.deleteSavingsPlan(op.id);
      return;
    case "addTagGroup": {
      const { name } = op.payload as { name: string };
      await inner.addTagGroup(name, op.id);
      return;
    }
    case "renameTagGroup": {
      const { name } = op.payload as { name: string };
      await inner.renameTagGroup(op.id, name);
      return;
    }
    case "deleteTagGroup":
      await inner.deleteTagGroup(op.id);
      return;
    case "setAssetTags": {
      const { assetId, groupId, values } = op.payload as {
        assetId: string;
        groupId: string;
        values: string[];
      };
      await inner.setAssetTags(assetId, groupId, values);
      return;
    }
    case "setAssetValuations": {
      const { assetId, points } = op.payload as {
        assetId: string;
        points: { date: string; value: number }[];
      };
      await inner.setAssetValuations(assetId, points);
      return;
    }
    case "addAccount":
      await inner.addAccount(op.payload as AccountInput, op.id);
      return;
    case "updateAccount":
      await inner.updateAccount(op.id, op.payload as Partial<AccountInput>);
      return;
    case "deleteAccount":
      await inner.deleteAccount(op.id);
      return;
    case "setAccountBalances": {
      const { accountId, points } = op.payload as {
        accountId: string;
        points: { date: string; balance: number }[];
      };
      await inner.setAccountBalances(accountId, points);
      return;
    }
    case "saveLlmConfig":
      await inner.saveLlmConfig(op.payload as LlmConfig | null);
      return;
    case "createPortfolio": {
      const { name } = op.payload as { name: string };
      await inner.createPortfolio(name, op.id);
      return;
    }
    case "renamePortfolio": {
      const { name } = op.payload as { name: string };
      await inner.renamePortfolio(op.id, name);
      return;
    }
    case "updatePortfolio":
      await inner.updatePortfolio(op.id, op.payload as PortfolioPatch);
      return;
    case "deletePortfolio":
      await inner.deletePortfolio(op.id);
      return;
  }
}

/**
 * Replays `queue`'s ops (oldest seq first) against `inner`, acking each op
 * that's applied or resolved (unique-violation / row-missing) so a partial
 * failure never re-plays already-synced work. Refuses outright if the queue
 * doesn't belong to `currentUserId` (§5.2).
 */
export async function drain(
  queue: MutationQueue,
  inner: DataStore,
  currentUserId: string,
): Promise<DrainResult> {
  const ops = queue.peek();
  if (ops.length === 0) {
    return { applied: 0, dropped: 0, status: "synced" };
  }
  if (ops[0].userId !== currentUserId) {
    return { applied: 0, dropped: 0, status: "refused" };
  }

  let applied = 0;
  let dropped = 0;

  for (const op of ops) {
    try {
      await applyOp(inner, op);
      queue.ack([op.seq]);
      applied++;
    } catch (err) {
      const kind = classify(err);
      if (kind === "unique") {
        // Already synced by a previous attempt — idempotent retry, not a failure.
        queue.ack([op.seq]);
        applied++;
        continue;
      }
      if (kind === "notFound") {
        // A cross-device delete already won (§4 rule 2) — drop, don't retry.
        queue.ack([op.seq]);
        dropped++;
        continue;
      }
      if (kind === "auth") {
        return { applied, dropped, status: "paused" };
      }
      // Unclassified (network blip, unexpected app error): stop here, leave
      // this op and everything after it queued for the next attempt.
      return { applied, dropped, status: "interrupted" };
    }
  }

  let data: PortfolioData | undefined;
  try {
    data = await inner.load();
  } catch {
    // Best-effort reconcile — a network drop right after the last ack still
    // counts as a full drain; the caller's own mirror stays stale until the
    // next successful load(), which is fine (it already reflects every op
    // applied above via the optimistic write-through).
  }
  return { applied, dropped, status: "synced", data };
}
