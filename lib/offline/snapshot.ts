/** Small last-known-value cache for public/reference data used by offline pages. */
export interface OfflineSnapshot<T> {
  value: T;
  savedAt: string;
}

export function readOfflineSnapshot<T>(key: string): OfflineSnapshot<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OfflineSnapshot<T>;
    if (!parsed || typeof parsed.savedAt !== "string" || !("value" in parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeOfflineSnapshot<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      key,
      JSON.stringify({ value, savedAt: new Date().toISOString() } satisfies OfflineSnapshot<T>),
    );
  } catch {
    // A full or restricted localStorage must never make the online path fail.
  }
}
