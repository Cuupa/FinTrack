"use client";

// Advisory connectivity signal for the offline-mode UI (banner, staleness
// badges) — see OFFLINE_DESIGN.md §2 phase 1. `navigator.onLine` and the
// `online`/`offline` browser events are only a hint (wrong behind captive
// portals, flaky VPNs, etc.), so the `online` event is confirmed with a real
// fetch via `probe()` before flipping the flag back on; the `offline` event
// is trusted immediately since the network stack itself reports it.
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

  return { online, probe };
}
