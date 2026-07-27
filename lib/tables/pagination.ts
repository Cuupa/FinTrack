// Paging for the shared table shell -- pure, no React (the hook lives next to
// the component in components/ui/table.tsx, the arithmetic lives here so it is
// unit-testable, same split as lib/tables/sort.ts).
//
// One page size for the whole app: the tables are supposed to look and behave
// identically everywhere, and a per-table size is a per-table decision nobody
// can keep consistent. Short tables simply never show the controls.

/** Rows per page, everywhere. */
export const DEFAULT_PAGE_SIZE = 25;

export interface PageSlice<T> {
  /** The rows to render for the current page. */
  rows: T[];
  /** 1-based, clamped into [1, pageCount] -- a page that no longer exists
   *  (the list shrank under the user) shows the last one instead of nothing. */
  page: number;
  pageCount: number;
  /** 1-based index of the first row shown; 0 when there are no rows at all. */
  from: number;
  /** 1-based index of the last row shown; 0 when there are no rows at all. */
  to: number;
  total: number;
  /** False while everything fits on one page: the controls stay hidden rather
   *  than rendering a dead "1 of 1". */
  hasPages: boolean;
}

/** The `page`-th slice of `rows`, with every figure the controls need. */
export function pageSlice<T>(
  rows: readonly T[],
  page: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): PageSlice<T> {
  const size = Math.max(1, Math.floor(pageSize));
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pageCount);
  const start = (current - 1) * size;
  const slice = rows.slice(start, start + size);
  return {
    rows: slice,
    page: current,
    pageCount,
    from: total === 0 ? 0 : start + 1,
    to: total === 0 ? 0 : start + slice.length,
    total,
    hasPages: total > size,
  };
}
