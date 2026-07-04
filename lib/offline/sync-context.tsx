"use client";

// Phase 3 of offline mode (OFFLINE_DESIGN.md §2): reconnect sync. Wires up
// *when* to drain the mutation queue (reconnect, tab refocus, initial mount
// with pending ops) and exposes the result for `sync-pill.tsx` to render.
//
// Seam choice: the active store already lives in `PortfolioProvider` — rather
// than teach that provider anything about queues/connectivity, it just
// exposes the plain `store: DataStore` it already has (see
// `lib/portfolio/portfolio-context.tsx`). This provider narrows it to
// `OfflineStore` itself (`instanceof`), so `PortfolioProvider` stays exactly
// as mode-agnostic as before — this file is the one that learns about
// connectivity, same as `OfflineStore` and `connectivity.tsx`.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "../auth/auth-context";
import { useFeatureFlag } from "../flags/flags-context";
import { usePortfolio } from "../portfolio/portfolio-context";
import { OfflineStore } from "../store/offline-store";
import { useOnlineStatus } from "./connectivity";

export type SyncStatus = "idle" | "syncing" | "synced" | "paused";

interface SyncContextValue {
  /** Ops still queued, waiting to reach the server. */
  pending: number;
  status: SyncStatus;
  /** Cumulative ops dropped this session because their row no longer exists
   *  server-side (OFFLINE_DESIGN.md §4 rule 2) — surfaced via a sticky toast,
   *  not auto-cleared, since the user needs to notice and possibly redo it. */
  dropped: number;
  /** Dismisses the dropped-ops toast without discarding the sync state. */
  dismissDropped(): void;
}

const SyncContext = createContext<SyncContextValue>({
  pending: 0,
  status: "idle",
  dropped: 0,
  dismissDropped: () => {},
});

/** How long the "synced" state lingers before reverting to "idle" — this is
 *  what auto-hides the success pill, matching the CSV-import pill's 4s. */
const SYNCED_LINGER_MS = 4000;

export function SyncProvider({ children }: { children: ReactNode }) {
  const enabled = useFeatureFlag("offline");
  const { user } = useAuth();
  const { store, reload } = usePortfolio();
  const { online } = useOnlineStatus();
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [dropped, setDropped] = useState(0);
  const runningRef = useRef(false);
  const wasOnlineRef = useRef(online);
  const lingerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (lingerTimer.current) clearTimeout(lingerTimer.current);
    };
  }, []);

  const offlineStore = enabled && store instanceof OfflineStore ? store : null;
  const userId = user?.id ?? null;

  const runSync = useCallback(async () => {
    if (!offlineStore || !userId) return;
    if (runningRef.current) return;
    if (offlineStore.pendingCount === 0) return;
    runningRef.current = true;
    if (lingerTimer.current) {
      clearTimeout(lingerTimer.current);
      lingerTimer.current = null;
    }
    // Next 16's react-hooks/set-state-in-effect lint rule fails the build on
    // a *synchronous* setState reachable from an effect body — this function
    // is invoked as `void runSync()` from several effects below, so every
    // state update here (starting with this one) happens after a real await,
    // never before it, matching the pattern in connectivity.tsx's `probe()`.
    await Promise.resolve();
    try {
      setStatus("syncing");
      const result = await offlineStore.sync(userId);
      if (result.dropped > 0) setDropped((d) => d + result.dropped);
      if (result.status === "synced") {
        setStatus("synced");
        if (result.applied > 0 || result.dropped > 0) {
          await reload();
        }
        // Revert to "idle" after a beat — this is what auto-hides the
        // success pill (sync-pill.tsx renders purely from `status`, keeping
        // its own render free of effect-driven state).
        lingerTimer.current = setTimeout(() => setStatus("idle"), SYNCED_LINGER_MS);
      } else if (result.status === "paused") {
        setStatus("paused");
      } else {
        // "refused" (stale store/user mismatch — shouldn't happen in normal
        // operation) or "interrupted" (network blip mid-drain): stay quiet,
        // the next trigger (reconnect/focus) retries.
        setStatus("idle");
      }
    } finally {
      runningRef.current = false;
    }
  }, [offlineStore, userId, reload]);

  // Trigger (c): initial mount, if the queue already has pending ops (e.g. the
  // app was reloaded while offline mutations were still queued).
  useEffect(() => {
    void runSync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offlineStore]);

  // Trigger (a): reconnect. `useOnlineStatus` only flips `online` to `true`
  // after a real probe succeeds (browser `online` events are advisory), so
  // this transition is already a confirmed reachability signal.
  useEffect(() => {
    const was = wasOnlineRef.current;
    wasOnlineRef.current = online;
    if (online && !was) void runSync();
  }, [online, runSync]);

  // Trigger (b): tab refocus — catches the case where connectivity came back
  // while the tab was hidden/backgrounded and the `online` event was missed
  // or throttled.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void runSync();
    };
    const onFocus = () => void runSync();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [runSync]);

  // Derived, not synced via effect (Next 16 lint + simpler): `pendingCount`
  // is a cheap synchronous localStorage read, and every state change above
  // (status flips after each sync attempt) already re-renders this provider,
  // so this recomputes exactly when it needs to without an extra state slot.
  const pending = offlineStore?.pendingCount ?? 0;

  const dismissDropped = useCallback(() => setDropped(0), []);

  const value: SyncContextValue = { pending, status, dropped, dismissDropped };

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  return useContext(SyncContext);
}
