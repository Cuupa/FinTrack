// Client-side stale-while-revalidate cache for the public operator identity
// (site_config rows: legal_name/legal_street/legal_city/legal_email) shown on
// the legal pages (/impressum, /datenschutz). Same spirit as
// lib/history/history-cache.ts: these values rarely change, so painting the
// last-known values immediately (no loading flash) is safe, and the caller
// still fetches in the background to revalidate.
//
// Pure module, no React. Storage is injectable (defaults to
// window.localStorage) so tests can pass an in-memory Storage stub, matching
// the pattern in lib/history/history-cache.ts.

export type SiteConfigKey = "legal_name" | "legal_street" | "legal_city" | "legal_email";

export type SiteConfigMap = Partial<Record<SiteConfigKey, string>>;

const STORAGE_KEY = "fintrack-site-config";

const KEYS: readonly SiteConfigKey[] = [
  "legal_name",
  "legal_street",
  "legal_city",
  "legal_email",
];

/** The known `site_config` keys, exported for callers that need to validate
 *  or enumerate them (the admin site-config editor and its API route) rather
 *  than duplicating this list. */
export const SITE_CONFIG_KEYS: readonly SiteConfigKey[] = KEYS;

export interface SiteConfigCacheOptions {
  /** Storage to use; defaults to window.localStorage. */
  storage?: Storage;
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

/**
 * Read the cached config map. Returns null when there is no entry, the entry
 * is malformed JSON, or it isn't a plain object - callers degrade to the
 * fetch path silently in all of those cases.
 */
export function readSiteConfigCache(opts?: SiteConfigCacheOptions): SiteConfigMap | null {
  const storage = resolveStorage(opts?.storage);
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const map: SiteConfigMap = {};
    for (const key of KEYS) {
      const value = (parsed as Record<string, unknown>)[key];
      if (typeof value === "string" && value) map[key] = value;
    }
    return map;
  } catch {
    return null;
  }
}

/** Write the config map. Best effort - a full localStorage (quota error) or a
 *  JSON failure just skips the write silently, same as the read path. */
export function writeSiteConfigCache(config: SiteConfigMap, opts?: SiteConfigCacheOptions): void {
  const storage = resolveStorage(opts?.storage);
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // best effort
  }
}

/** Shallow equality over the known keys - used to skip redundant writes and
 *  re-renders when a revalidation returns the same values as already cached. */
export function siteConfigEquals(a: SiteConfigMap, b: SiteConfigMap): boolean {
  return KEYS.every((key) => a[key] === b[key]);
}

const EMPTY_CONFIG: SiteConfigMap = {};

export interface SiteConfigStore {
  /** Stable object reference for React's useSyncExternalStore - only changes
   *  identity when update() actually applies a differing payload. */
  getSnapshot(): SiteConfigMap;
  /** Always the same empty object - there is no localStorage on the server. */
  getServerSnapshot(): SiteConfigMap;
  subscribe(listener: () => void): () => void;
  /** Writes through to storage and notifies subscribers, but only when
   *  `next` actually differs from what's cached - a revalidation that
   *  returns the same values is a no-op (no write, no re-render). */
  update(next: SiteConfigMap): void;
}

/**
 * Creates a small store suitable for `useSyncExternalStore`. The client
 * snapshot is the localStorage mirror, read lazily on first access and kept
 * as a single stable object reference thereafter, so repeated getSnapshot
 * calls don't create a new object each time (which would make
 * useSyncExternalStore re-render in a loop).
 *
 * Exposed as a factory (rather than only the shared singleton below) so
 * tests can create an isolated store over an in-memory Storage stub instead
 * of sharing state with other tests or requiring a real browser environment.
 */
export function createSiteConfigStore(opts?: SiteConfigCacheOptions): SiteConfigStore {
  let snapshot: SiteConfigMap | null = null;
  const listeners = new Set<() => void>();

  function getSnapshot(): SiteConfigMap {
    if (snapshot === null) snapshot = readSiteConfigCache(opts) ?? EMPTY_CONFIG;
    return snapshot;
  }

  function getServerSnapshot(): SiteConfigMap {
    return EMPTY_CONFIG;
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function update(next: SiteConfigMap): void {
    const current = getSnapshot();
    if (siteConfigEquals(current, next)) return;
    snapshot = next;
    writeSiteConfigCache(next, opts);
    for (const listener of listeners) listener();
  }

  return { getSnapshot, getServerSnapshot, subscribe, update };
}

/** The single store instance shared by every useSiteConfig() call, backed by
 *  window.localStorage. */
export const siteConfigStore = createSiteConfigStore();
