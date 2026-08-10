// Persists which accounts the /accounts page is scoped to, so a refresh keeps
// the selection instead of snapping back to "every account". Browser-only and
// keyed per user, so signing in as someone else never inherits their scope; a
// selected account that no longer exists is pruned on read.

const PREFIX = "fintrack-selected-accounts:";

export function accountSelectionKey(userId: string | null): string {
  return `${PREFIX}${userId ?? "guest"}`;
}

/** Keep only ids that still exist, preserving their stored order. Pure, so the
 *  pruning rule is unit-tested without touching localStorage. */
export function pruneSelection(stored: unknown, existingIds: string[]): string[] {
  if (!Array.isArray(stored)) return [];
  const existing = new Set(existingIds);
  return stored.filter((id): id is string => typeof id === "string" && existing.has(id));
}

export function readAccountSelection(userId: string | null, existingIds: string[]): string[] {
  try {
    const raw = localStorage.getItem(accountSelectionKey(userId));
    return raw ? pruneSelection(JSON.parse(raw), existingIds) : [];
  } catch {
    return [];
  }
}

export function writeAccountSelection(userId: string | null, ids: string[]): void {
  try {
    localStorage.setItem(accountSelectionKey(userId), JSON.stringify(ids));
  } catch {
    /* ignore quota / unavailable storage: the selection is a convenience */
  }
}
