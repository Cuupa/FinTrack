// Client-side stale-while-revalidate cache for /api/history responses.
//
// WHY: the finance math in this app is cheap client CPU; the visible
// dashboard wait is the POST /api/history network round trip (spinner in the
// hero chart, "..." in risk stats). The server already caches provider
// responses in Postgres (instrument_history) - that layer removes provider
// cost, not the round trip itself. This module removes the round trip on
// repeat visits: use-history.ts reads a cached map synchronously and paints
// immediately, then still fetches in the background to refresh it. Stale
// paint is safe because past price history is immutable (only today's tail
// point can move) and a revalidation always follows.
//
// Privacy note: the cache key (sig) is derived from the held instruments'
// price keys (ISIN/WKN/symbol), so a signed-out browser must not keep another
// user's cache around - callers clear it on sign-out via clearHistoryCache().
//
// Pure module, no React. Storage is injectable (defaults to
// window.localStorage) so tests can pass an in-memory Storage stub, matching
// the pattern in lib/store/local-store.ts.

import type { FxHistoryMap, HistoryMap } from "./history";

const PREFIX = "fintrack:histcache:v1:";
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_ENTRIES = 24;

/** Cached payload for a signature: real price history plus the historical FX
 *  series needed to convert it. `fx` is optional on read so a v1 entry
 *  written before FX history existed still parses (defaults to `{}`); no
 *  version bump needed since the always-on background revalidation
 *  (use-history.ts) replaces it with a real `fx` moments later regardless. */
interface HistoryCacheEntry {
  sig: string;
  histories: HistoryMap;
  fx?: FxHistoryMap;
  at: number;
}

export interface HistoryCacheData {
  histories: HistoryMap;
  fx: FxHistoryMap;
}

export interface HistoryCacheOptions {
  /** Storage to use; defaults to window.localStorage. */
  storage?: Storage;
  /** Injectable clock for tests; defaults to Date.now(). */
  now?: number;
}

function resolveStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isQuotaExceededError(err: unknown): boolean {
  if (!(err instanceof DOMException)) return false;
  return err.name === "QuotaExceededError" || err.code === 22;
}

/** All storage keys under our prefix, in storage-native order. */
function prefixedKeys(storage: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (k && k.startsWith(PREFIX)) keys.push(k);
  }
  return keys;
}

/** Trim cached entries down to `cap`, evicting the oldest (by `at`) first. */
function enforceCap(storage: Storage, cap: number): void {
  const keys = prefixedKeys(storage);
  if (keys.length <= cap) return;
  const withAge = keys.map((key) => {
    let at = 0;
    try {
      const raw = storage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as { at?: unknown };
        if (typeof parsed.at === "number") at = parsed.at;
      }
    } catch {
      // Malformed entry - treat as oldest so it gets evicted first.
    }
    return { key, at };
  });
  withAge.sort((a, b) => a.at - b.at);
  const excess = withAge.length - cap;
  for (const { key } of withAge.slice(0, excess)) {
    storage.removeItem(key);
  }
}

/**
 * Read a cached history+fx payload for `sig`. Returns null when there is no
 * entry, the entry is malformed, or it is older than the 7-day TTL (an
 * expired entry is evicted as a side effect of the read).
 */
export function readHistoryCache(sig: string, opts?: HistoryCacheOptions): HistoryCacheData | null {
  const storage = resolveStorage(opts?.storage);
  if (!storage) return null;
  const key = PREFIX + sig;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<HistoryCacheEntry> | null;
    if (
      !parsed ||
      typeof parsed.at !== "number" ||
      typeof parsed.sig !== "string" ||
      !parsed.histories ||
      typeof parsed.histories !== "object"
    ) {
      return null;
    }
    const now = opts?.now ?? Date.now();
    if (now - parsed.at > TTL_MS) {
      storage.removeItem(key);
      return null;
    }
    return { histories: parsed.histories, fx: parsed.fx ?? {} };
  } catch {
    return null;
  }
}

/**
 * Write a history+fx payload for `sig`, LRU-capped at 24 entries (one
 * localStorage key per sig). On QuotaExceededError, evict the oldest entries
 * and retry once; if that still fails, give up silently - the cache is best
 * effort.
 */
export function writeHistoryCache(
  sig: string,
  data: HistoryCacheData,
  opts?: HistoryCacheOptions,
): void {
  const storage = resolveStorage(opts?.storage);
  if (!storage) return;
  const now = opts?.now ?? Date.now();
  const key = PREFIX + sig;
  let serialized: string;
  try {
    serialized = JSON.stringify({
      sig,
      histories: data.histories,
      fx: data.fx,
      at: now,
    } satisfies HistoryCacheEntry);
  } catch {
    return;
  }
  try {
    storage.setItem(key, serialized);
  } catch (err) {
    if (!isQuotaExceededError(err)) return;
    try {
      // Free up space by dropping the oldest entries, then retry once.
      enforceCap(storage, Math.max(MAX_ENTRIES - 1, 0));
      storage.setItem(key, serialized);
    } catch {
      return; // give up silently - the cache is best effort
    }
  }
  try {
    enforceCap(storage, MAX_ENTRIES);
  } catch {
    // best effort
  }
}

/** Remove every cache entry (all sigs). Called on sign-out. */
export function clearHistoryCache(storage?: Storage): void {
  const s = resolveStorage(storage);
  if (!s) return;
  try {
    for (const key of prefixedKeys(s)) s.removeItem(key);
  } catch {
    // best effort
  }
}
