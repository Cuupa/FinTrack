"use client";

// Loads the instruments catalog from the DB into the in-memory cache once, and
// exposes a `version` that bumps when it arrives so price-dependent components
// recompute. Until loaded, pricing falls back to synthetic values.
//
// Offline mode (OFFLINE_DESIGN.md §2 phase 1): every successful fetch is also
// persisted to localStorage (`fintrack:catalog:v1`, with a `fetchedAt`
// timestamp exposed as `catalogAsOf`). On a cold start the in-memory cache is
// seeded from that snapshot before the network call resolves, so last-known
// prices/constituents/FX are available immediately — and stay available if
// the network call then fails outright (offline first launch).

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { apiFetch } from "@/lib/api";
import {
  setCatalog,
  setConstituents,
  setFxRates,
  type Constituent,
  type Instrument,
} from "./catalog";
import { resetPriceCache } from "../finance/prices";

const STORAGE_KEY = "fintrack:catalog:v1";

interface CatalogSnapshot {
  instruments: Instrument[];
  constituents: Constituent[];
  fxRates: Record<string, number>;
  fetchedAt: string;
}

function readSnapshot(): CatalogSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CatalogSnapshot;
  } catch {
    return null;
  }
}

function writeSnapshot(snapshot: CatalogSnapshot): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    /* ignore — quota or unavailable storage; offline seeding is best-effort */
  }
}

interface CatalogValue {
  /** Bumps from 0 once the catalog is loaded (from cache or network). */
  version: number;
  ready: boolean;
  /** When the loaded catalog was last fetched from the network, if known. */
  catalogAsOf: string | null;
}

const CatalogContext = createContext<CatalogValue>({
  version: 0,
  ready: false,
  catalogAsOf: null,
});

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  const [catalogAsOf, setCatalogAsOf] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    // Seed from the last-known snapshot first (deferred to an async
    // continuation — never a sync setState inside the effect body).
    void Promise.resolve().then(() => {
      if (!active) return;
      const snapshot = readSnapshot();
      if (!snapshot) return;
      setCatalog(snapshot.instruments);
      setConstituents(snapshot.constituents);
      setFxRates(snapshot.fxRates);
      resetPriceCache();
      setCatalogAsOf(snapshot.fetchedAt);
      setVersion((v) => v + 1);
    });

    apiFetch("/api/catalog")
      .then((res) => (res.ok ? res.json() : { instruments: [] }))
      .then(
        (json: {
          instruments?: Instrument[];
          constituents?: Constituent[];
          fxRates?: Record<string, number>;
        }) => {
          if (!active) return;
          const instruments = json.instruments ?? [];
          const constituents = json.constituents ?? [];
          const fxRates = json.fxRates ?? {};
          setCatalog(instruments);
          setConstituents(constituents);
          setFxRates(fxRates);
          resetPriceCache();
          const fetchedAt = new Date().toISOString();
          setCatalogAsOf(fetchedAt);
          setVersion((v) => v + 1);
          if (instruments.length > 0) {
            writeSnapshot({ instruments, constituents, fxRates, fetchedAt });
          }
        },
      )
      .catch(() => {
        if (active) setVersion((v) => v + 1);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <CatalogContext.Provider value={{ version, ready: version > 0, catalogAsOf }}>
      {children}
    </CatalogContext.Provider>
  );
}

export function useCatalog(): CatalogValue {
  return useContext(CatalogContext);
}
