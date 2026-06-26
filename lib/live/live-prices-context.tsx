"use client";

// Auto-synchronising live prices + FX. Gathers a quote reference (from the DB
// catalog) for every asset a provider can price, plus the set of native
// currencies, then polls /api/quotes and /api/fx on an interval (and on
// demand). Exposes a ready-to-use ValuationContext (base + live native prices +
// FX rates) so finance code converts to the base currency uniformly. Anything
// it can't price/convert is simply absent, and consumers fall back to the
// synthetic provider / 1:1 FX.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePortfolio } from "../portfolio/portfolio-context";
import { useCatalog } from "../catalog/catalog-context";
import { assetPriceKey } from "../types";
import { nativeCurrency, quoteRefFor, type QuoteRef } from "../finance/prices";
import type { ValuationContext } from "../finance/portfolio";

export type SyncStatus = "idle" | "syncing" | "live" | "error";

interface LivePricesValue {
  valuation: ValuationContext;
  status: SyncStatus;
  lastSynced: string | null;
  /** Number of assets tracked for live quotes. */
  tracked: number;
  refresh(): void;
}

const REFRESH_MS = 60_000;

const LivePricesContext = createContext<LivePricesValue | null>(null);

interface Item extends QuoteRef {
  key: string;
}

export function LivePricesProvider({ children }: { children: ReactNode }) {
  const { data } = usePortfolio();
  const { version } = useCatalog();
  const base = data.profile.currency;

  // Resolve one quote item per asset a provider can price (depends on catalog).
  const items = useMemo<Item[]>(() => {
    const seen = new Set<string>();
    const out: Item[] = [];
    for (const asset of data.assets) {
      const ref = quoteRefFor(asset);
      if (!ref) continue;
      const key = assetPriceKey(asset);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ key, ...ref });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.assets, version]);

  // Native currencies that need an FX rate to the base.
  const currencies = useMemo<string[]>(() => {
    const set = new Set<string>();
    for (const a of data.assets) {
      const c = nativeCurrency(a, base);
      if (c && c !== base) set.add(c);
    }
    return Array.from(set);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.assets, base, version]);

  const sig = useMemo(
    () =>
      items.map((i) => `${i.key}:${i.source}:${i.id}`).sort().join("|") +
      "#" +
      currencies.slice().sort().join(","),
    [items, currencies],
  );

  const [prices, setPrices] = useState<Record<string, number>>({});
  const [fx, setFx] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  const sync = useCallback(async () => {
    if (items.length === 0 && currencies.length === 0) {
      setStatus("idle");
      return;
    }
    setStatus("syncing");
    try {
      const [quoteRes, fxRes] = await Promise.all([
        items.length > 0
          ? fetch("/api/quotes", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ base, items }),
            })
          : null,
        currencies.length > 0
          ? fetch(`/api/fx?base=${base}&symbols=${currencies.join(",")}`)
          : null,
      ]);

      let gotPrices = false;
      if (quoteRes?.ok) {
        const json = (await quoteRes.json()) as {
          prices?: Record<string, number>;
          syncedAt?: string;
        };
        const fetched = json.prices ?? {};
        if (Object.keys(fetched).length > 0) {
          setPrices((prev) => ({ ...prev, ...fetched }));
          setLastSynced(json.syncedAt ?? new Date().toISOString());
          gotPrices = true;
        }
      }
      if (fxRes?.ok) {
        const json = (await fxRes.json()) as { rates?: Record<string, number> };
        if (json.rates) setFx((prev) => ({ ...prev, ...json.rates }));
      }

      // "live" only if we actually have quotes; FX-only (or nothing) → error.
      setStatus(gotPrices || items.length === 0 ? "live" : "error");
    } catch {
      setStatus("error");
    }
  }, [base, items, currencies]);

  // Self-scheduling poll; first run deferred out of the effect body.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      if (cancelled) return;
      await sync();
      if (!cancelled) timer = setTimeout(tick, REFRESH_MS);
    };
    const first = setTimeout(tick, 0);
    return () => {
      cancelled = true;
      clearTimeout(first);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const valuation = useMemo<ValuationContext>(
    () => ({ base, live: prices, fx }),
    [base, prices, fx],
  );

  const value: LivePricesValue = {
    valuation,
    status,
    lastSynced,
    tracked: items.length,
    refresh: () => void sync(),
  };

  return (
    <LivePricesContext.Provider value={value}>{children}</LivePricesContext.Provider>
  );
}

export function useLivePrices(): LivePricesValue {
  const ctx = useContext(LivePricesContext);
  if (!ctx) throw new Error("useLivePrices must be used within LivePricesProvider");
  return ctx;
}
