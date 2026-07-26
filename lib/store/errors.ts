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

/**
 * The actual reason a store mutation failed, for display next to a form's own
 * "could not save" line.
 *
 * A `SupabaseStore` write rejects with a PostgrestError -- a missing column, a
 * violated check constraint, an RLS refusal -- and swallowing that into a
 * generic sentence leaves the user (and the owner) with a form that fails
 * forever and says nothing about why. Same rule the admin fetch helpers
 * already follow (`lib/admin/client.ts`): show the route's own message rather
 * than "request failed".
 *
 * Returns null when there is nothing more informative than the generic line.
 */
export function storeErrorReason(err: unknown): string | null {
  if (err == null || typeof err !== "object") return null;
  const e = err as { message?: unknown; details?: unknown; code?: unknown };
  const parts: string[] = [];
  if (typeof e.message === "string" && e.message.trim()) parts.push(e.message.trim());
  // PostgREST puts the useful specifics (which column, which constraint) in
  // `details`; `message` on its own is often just "Bad Request".
  if (typeof e.details === "string" && e.details.trim() && !parts.includes(e.details.trim())) {
    parts.push(e.details.trim());
  }
  if (parts.length === 0) return null;
  const code = typeof e.code === "string" && e.code.trim() ? ` (${e.code.trim()})` : "";
  return `${parts.join(" - ").slice(0, 300)}${code}`;
}
