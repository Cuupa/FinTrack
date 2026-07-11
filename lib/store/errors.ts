// Tagged error for a Guest Mode (`LocalStore`) write that failed because the
// browser's localStorage quota (~5MB) was exceeded, e.g. a large CSV import.
// `LocalStore.write()` (local-store.ts) catches the native `QuotaExceededError`
// and rethrows this instead, so callers (forms awaiting a mutation) can show a
// clear message rather than crash on an uncaught DOMException or silently lose
// the change. Detection matches on the native error's `name`/`code`, never on
// message text, which is inconsistent across browsers/locales, and this
// class's own `name` is likewise the stable tag `isStorageFullError` checks,
// not the message.

const NATIVE_QUOTA_ERROR_NAMES = new Set(["QuotaExceededError", "NS_ERROR_DOM_QUOTA_REACHED"]);
const NATIVE_QUOTA_ERROR_CODES = new Set([22, 1014]);

/** True for the native DOMException browsers throw when a storage write
 *  exceeds quota (naming/codes differ across browsers, hence the set). */
export function isNativeQuotaError(err: unknown): boolean {
  if (!(err instanceof DOMException)) return false;
  return NATIVE_QUOTA_ERROR_NAMES.has(err.name) || NATIVE_QUOTA_ERROR_CODES.has(err.code);
}

/**
 * Thrown by `LocalStore` in place of the native quota error. localStorage
 * still holds whatever it had before the failed write (the caller's
 * in-memory change was NOT persisted), so this must propagate to the
 * mutation's caller rather than be swallowed.
 */
export class StorageFullError extends Error {
  constructor(message = "Storage is full") {
    super(message);
    this.name = "StorageFullError";
  }
}

/** True for a `StorageFullError` (matched by its stable `name`, not message text). */
export function isStorageFullError(err: unknown): boolean {
  return err instanceof Error && err.name === "StorageFullError";
}
