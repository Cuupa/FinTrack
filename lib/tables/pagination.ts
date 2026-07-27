// Paging arithmetic for the shared table shell -- pure, no React (the hook
// lives with the component in components/ui/table.tsx), same split as
// lib/tables/sort.ts. One page size app-wide, so every table behaves alike.

/** Rows per page, everywhere. */
export const DEFAULT_PAGE_SIZE = 25;

export interface PageSlice<T> {
  /** The rows to render for the current page. */
  rows: T[];
  /** 1-based, clamped into [1, pageCount] so a shrinking list never leaves an
   *  empty table behind. */
  page: number;
  pageCount: number;
  /** 1-based index of the first row shown; 0 when there are no rows at all. */
  from: number;
  /** 1-based index of the last row shown; 0 when there are no rows at all. */
  to: number;
  total: number;
  /** False while everything fits on one page (controls stay hidden). */
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
