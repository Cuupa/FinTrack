"use client";

// React wrapper around the pure sort core (lib/tables/sort.ts). Replaces the
// per-view `useState<{key, dir}>` + toggle that 16 tables each declared.

import { useCallback, useMemo, useState } from "react";
import { nextSort, sortRows, type SortDir, type SortState, type SortValue } from "@/lib/tables/sort";

export type UseSort<K extends string> = {
  sort: SortState<K>;
  /** Click handler for a column header: flips the active column, else
      switches to the clicked one ascending. */
  toggle: (key: K) => void;
  /** Sorts a row list by the active column. Call inside the useMemo that
      derives the rows so the copy is not rebuilt on unrelated renders. */
  apply: <T>(rows: readonly T[], value: (row: T, key: K) => SortValue) => T[];
};

export function useSort<K extends string>(initialKey: K, initialDir: SortDir = "asc"): UseSort<K> {
  const [sort, setSort] = useState<SortState<K>>({ key: initialKey, dir: initialDir });

  const toggle = useCallback((key: K) => setSort((s) => nextSort(s, key)), []);

  const apply = useCallback(
    <T,>(rows: readonly T[], value: (row: T, key: K) => SortValue) => sortRows(rows, sort, value),
    [sort],
  );

  return useMemo(() => ({ sort, toggle, apply }), [sort, toggle, apply]);
}
