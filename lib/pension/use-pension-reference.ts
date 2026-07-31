"use client";

// Public read of the `pension_reference` reference table (year -> aktueller
// Rentenwert + Sicherungsniveau) for the retirement projection. The rows are
// world-readable (RLS "pension reference readable", `select using (true)`), so
// this queries them directly via the browser Supabase client -- the same
// "getSupabaseClient + one query" shape as `useBasiszins`, which reads its
// sibling table for the Vorabpauschale.
//
// No Supabase configured (local dev without keys) resolves to an empty list
// without touching the network. The finance layer then has no Rentenwert to
// value points with and reports the entitlement in POINTS only, rather than
// inventing a euro figure from a hardcoded constant.

import { useEffect, useState } from "react";
import type { PensionReference } from "../finance/pension";
import { getSupabaseClient, isSupabaseConfigured } from "../supabase/client";

interface PensionReferenceRow {
  year: number;
  pension_value: number | string;
  level_pct: number | string | null;
}

export function usePensionReference(): PensionReference[] {
  const [rows, setRows] = useState<PensionReference[]>([]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;
    let active = true;
    supabase
      .from("pension_reference")
      .select("year, pension_value, level_pct")
      .then(({ data }) => {
        if (!active || !data) return;
        const out: PensionReference[] = [];
        for (const row of data as PensionReferenceRow[]) {
          if (typeof row.year !== "number") continue;
          const value = Number(row.pension_value);
          if (!Number.isFinite(value)) continue;
          const level = row.level_pct == null ? null : Number(row.level_pct);
          out.push({
            year: row.year,
            pensionValue: value,
            levelPct: level != null && Number.isFinite(level) ? level : null,
          });
        }
        out.sort((a, b) => a.year - b.year);
        setRows(out);
      });
    return () => {
      active = false;
    };
  }, []);

  return rows;
}
