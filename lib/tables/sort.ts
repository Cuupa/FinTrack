// Pure sorting core shared by every sortable table.
//
// 16 views each hand-rolled the same `useState({key, dir})` + toggle + inline
// comparator, which is why sort direction, null handling and the "click the
// active column again to flip it" rule all drifted apart. The React wrapper
// lives in components/ui/use-sort.ts; everything here stays pure so it can be
// unit tested without a DOM.

export type SortDir = "asc" | "desc";

export type SortState<K extends string = string> = {
  key: K;
  dir: SortDir;
};

/** Clicking a column: the active one flips direction, a new one starts
    ascending. Every hand-rolled toggle already did this — now there is one. */
export function nextSort<K extends string>(current: SortState<K>, key: K): SortState<K> {
  return current.key === key
    ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
    : { key, dir: "asc" };
}

/** A cell value a column can be sorted by. */
export type SortValue = string | number | boolean | null | undefined;

function isMissing(v: SortValue): boolean {
  return v === null || v === undefined || (typeof v === "number" && Number.isNaN(v));
}

/**
 * Ascending comparison with one fixed rule for missing values: null/undefined
 * and NaN always sort last, in BOTH directions. A blank target date belongs at
 * the bottom of the list whichever way the user sorted it, rather than jumping
 * to the top when they flip the arrow.
 */
export function compareValues(a: SortValue, b: SortValue): number {
  if (isMissing(a) || isMissing(b)) return isMissing(a) && isMissing(b) ? 0 : isMissing(a) ? 1 : -1;

  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" || typeof b === "boolean") {
    return Number(Boolean(a)) - Number(Boolean(b));
  }
  // localeCompare so "Ärger" files next to "Arger" in de, not after "Zeta".
  return String(a).localeCompare(String(b));
}

/**
 * Returns a sorted copy — never mutates the input, since rows are usually
 * derived inside a useMemo from context data that must not be reordered
 * in place.
 *
 * `value` maps a row to the cell value for the active column; the missing-last
 * rule above is applied before `dir` is honoured, so descending does not drag
 * blanks to the top.
 */
export function sortRows<T, K extends string>(
  rows: readonly T[],
  sort: SortState<K>,
  value: (row: T, key: K) => SortValue,
): T[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((x, y) => {
    const a = value(x, sort.key);
    const b = value(y, sort.key);
    // Missing values ignore `sign` on purpose: they stay last either way.
    if (isMissing(a) || isMissing(b)) {
      return isMissing(a) && isMissing(b) ? 0 : isMissing(a) ? 1 : -1;
    }
    return sign * compareValues(a, b);
  });
}

/** ARIA value for a column header, for screen readers announcing sort state. */
export function ariaSortFor<K extends string>(
  sort: SortState<K>,
  key: K,
): "ascending" | "descending" | "none" {
  if (sort.key !== key) return "none";
  return sort.dir === "asc" ? "ascending" : "descending";
}
