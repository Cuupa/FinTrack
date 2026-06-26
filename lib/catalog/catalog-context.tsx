"use client";

// Loads the instruments catalog from the DB into the in-memory cache once, and
// exposes a `version` that bumps when it arrives so price-dependent components
// recompute. Until loaded, pricing falls back to synthetic values.

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  setCatalog,
  setConstituents,
  type Constituent,
  type Instrument,
} from "./catalog";
import { resetPriceCache } from "../finance/prices";

interface CatalogValue {
  /** Bumps from 0 once the catalog is loaded. */
  version: number;
  ready: boolean;
}

const CatalogContext = createContext<CatalogValue>({ version: 0, ready: false });

export function CatalogProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    fetch("/api/catalog")
      .then((res) => (res.ok ? res.json() : { instruments: [] }))
      .then((json: { instruments?: Instrument[]; constituents?: Constituent[] }) => {
        if (!active) return;
        setCatalog(json.instruments ?? []);
        setConstituents(json.constituents ?? []);
        resetPriceCache();
        setVersion((v) => v + 1);
      })
      .catch(() => {
        if (active) setVersion((v) => v + 1);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <CatalogContext.Provider value={{ version, ready: version > 0 }}>
      {children}
    </CatalogContext.Provider>
  );
}

export function useCatalog(): CatalogValue {
  return useContext(CatalogContext);
}
