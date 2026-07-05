"use client";

// Advisory connectivity signal for the offline-mode UI (banner, staleness
// badges) — see OFFLINE_DESIGN.md §2 phase 1. `navigator.onLine` and the
// `online`/`offline` browser events are only a hint (wrong behind captive
// portals, flaky VPNs, etc.), so the `online` event is confirmed with a real
// fetch via `probe()` before flipping the flag back on; the `offline` event
// is trusted immediately since the network stack itself reports it. Because
// the `online` event can't be fully trusted to fire (or to fire only once
// the server is actually reachable), the hook also self-heals: while
// `online === false` it re-probes periodically and on tab refocus, so the
// banner clears on its own instead of needing a manual reload.
//
// UI/finance code never learn about connectivity except through this hook
// and the pieces built on top of it (offline-banner, live-prices-context).

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";

export interface OnlineStatus {
  online: boolean;
  /** Re-checks reachability against /api/catalog; also updates `online`. */
  probe: () => Promise<boolean>;
}

/** How often to re-probe while offline (chained setTimeout, not setInterval —
 *  see the effect below). Stops entirely once a probe succeeds; no polling
 *  while online. */
const REPROBE_INTERVAL_MS = 10_000;

export function useOnlineStatus(): OnlineStatus {
  // Seeded `true` for SSR / first paint (no `navigator` on the server); the
  // effect below corrects it in an async continuation, never synchronously —
  // Next 16's react-hooks/set-state-in-effect lint rule fails the build on a
  // sync setState inside an effect.
  const [online, setOnline] = useState(true);

  const probe = useCallback(async (): Promise<boolean> => {
    try {
      // HEAD bypasses the service worker's cache-first handling of GET
      // /api/catalog (public/sw.js only intercepts GET requests), so this
      // always round-trips the real network instead of resolving from cache.
      const res = await apiFetch("/api/catalog", { method: "HEAD" });
      setOnline(res.ok);
      return res.ok;
    } catch {
      setOnline(false);
      return false;
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => {
      if (typeof navigator !== "undefined") setOnline(navigator.onLine);
    });

    const handleOffline = () => setOnline(false);
    const handleOnline = () => {
      void probe();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [probe]);

  // While offline, the `online` browser event is the *only* thing that
  // triggers a re-probe above — and it doesn't always fire (captive portals,
  // flaky VPNs, a server-side outage `navigator.onLine` never notices), or it
  // can fire before the server is actually reachable again, leaving `online`
  // stuck at `false` until a manual reload. So while offline this effect also
  // re-probes periodically (chained `setTimeout`, not `setInterval`, so a slow
  // probe can't stack concurrent requests) and immediately on tab
  // refocus/visibility — a phone coming back online is often woken by the
  // user opening the tab, which beats waiting for the next tick. Fully
  // inert while online: no steady-state polling.
  useEffect(() => {
    if (online) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;

    const runProbe = () => {
      if (inFlight) return;
      inFlight = true;
      void probe().finally(() => {
        inFlight = false;
      });
    };

    const tick = () => {
      timer = setTimeout(() => {
        if (cancelled) return;
        runProbe();
        tick();
      }, REPROBE_INTERVAL_MS);
    };
    tick();

    const onVisible = () => {
      if (document.visibilityState === "visible") runProbe();
    };
    const onFocus = () => runProbe();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onFocus);
    };
  }, [online, probe]);

  return { online, probe };
}
