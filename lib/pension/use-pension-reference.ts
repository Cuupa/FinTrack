"use client";

// Public read of the `pension_reference` reference table (year -> aktueller
// Rentenwert + Sicherungsniveau + the year's maximum Entgeltpunkte) for the
// retirement projection. The rows are world-readable (RLS "pension reference
// readable", `select using (true)`), so this queries them directly via the
// browser Supabase client -- the same "getSupabaseClient + one query" shape as
// `useBasiszins`, which reads its sibling table for the Vorabpauschale.
//
// No Supabase configured (local dev without keys) resolves to an empty list
// without touching the network. The finance layer then has no Rentenwert to
// value points with and reports the entitlement in POINTS only, rather than
// inventing a euro figure from a hardcoded constant.

import { useEffect, useState } from "react";
import type { PensionReference } from "../finance/pension";
import { reportError } from "../errors/report";
import { getSupabaseClient, isSupabaseConfigured } from "../supabase/client";
import { readOfflineSnapshot, writeOfflineSnapshot } from "../offline/snapshot";

const CACHE_KEY = "fintrack:reference:pension:v1";

interface PensionReferenceRow {
  year: number;
  pension_value: number | string;
  level_pct: number | string | null;
  max_points: number | string | null;
}

export function usePensionReference(): PensionReference[] {
  const [rows, setRows] = useState<PensionReference[]>([]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      const cached = readOfflineSnapshot<PensionReference[]>(CACHE_KEY);
      if (cached?.value) setRows(cached.value);
    });
    if (!isSupabaseConfigured) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let active = true;
    supabase
      .from("pension_reference")
      // `*`, not a column list: a database that has not run migration 0111 yet
      // would 400 on `max_points` and the whole table -- Rentenwert included --
      // would come back empty, costing the page every euro figure over a column
      // it only uses for a plausibility cap. Eight rows of reference data.
      .select("*")
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          reportError({
            kind: "fetch",
            level: "warn",
            message: `pension reference load failed: ${error.message}`,
          });
          return;
        }
        if (!data) return;
        const out: PensionReference[] = [];
        for (const row of data as PensionReferenceRow[]) {
          if (typeof row.year !== "number") continue;
          const value = Number(row.pension_value);
          if (!Number.isFinite(value)) continue;
          const level = row.level_pct == null ? null : Number(row.level_pct);
          const max = row.max_points == null ? null : Number(row.max_points);
          out.push({
            year: row.year,
            pensionValue: value,
            levelPct: level != null && Number.isFinite(level) ? level : null,
            maxPoints: max != null && Number.isFinite(max) ? max : null,
          });
        }
        out.sort((a, b) => a.year - b.year);
        setRows(out);
        writeOfflineSnapshot(CACHE_KEY, out);
      });
    return () => {
      active = false;
    };
  }, []);

  return rows;
}
