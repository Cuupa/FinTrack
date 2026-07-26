"use client";

// The shared table shell. Every table in the app is hand-rolled today, which
// is why header padding forks six ways, the uppercase/tracking treatment forks
// three ways, and several tables silently lost the row-hover highlight or the
// sortable headers the project requires.
//
// These components own exactly that: the frame, the header treatment, the
// hover highlight, and the a11y wiring for sorting (aria-sort plus a real
// button, so a column can be sorted from the keyboard — the hand-rolled
// `<th onClick>` headers could not be). Cell content stays at the call site.

import type {
  HTMLAttributes,
  ReactNode,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";
import { ariaSortFor, type SortState } from "@/lib/tables/sort";

type Align = "left" | "right" | "center";

const ALIGN: Record<Align, string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

/** Horizontal scroll container + the table itself: a wide table scrolls
    inside its card instead of pushing the page sideways on mobile. */
export function Table({
  children,
  className = "",
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-sm" aria-label={ariaLabel}>
        {children}
      </table>
    </div>
  );
}

/** Renders its own header row, so call sites pass <Th> children directly. */
export function Thead({ children }: { children: ReactNode }) {
  return (
    <thead>
      <tr className="border-b border-zinc-200 text-left text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800">
        {children}
      </tr>
    </thead>
  );
}

export function Tbody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

/**
 * A body row. The hover highlight is on by default and not opt-in: losing it
 * is exactly the regression this shell exists to prevent.
 *
 * `selected` marks a row as active (e.g. an expanded detail row) with a
 * standing tint rather than the transient hover one.
 */
export function Tr({
  children,
  selected = false,
  className = "",
  ...rest
}: {
  children: ReactNode;
  selected?: boolean;
  className?: string;
} & HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={`border-b border-zinc-100 last:border-0 dark:border-zinc-800/60 ${
        selected ? "bg-zinc-100 dark:bg-zinc-800/50" : "hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
      } ${className}`}
      {...rest}
    >
      {children}
    </tr>
  );
}

/**
 * A header cell. Pass `sort` + `sortKey` + `onSort` to make it sortable;
 * without them it renders a plain, non-interactive header (for an actions
 * column, say). A sortable header is a real <button> inside the <th> so it
 * is reachable by Tab and activated by Enter/Space for free.
 */
export function Th<K extends string>({
  children,
  align = "left",
  sort,
  sortKey,
  onSort,
  className = "",
  ...rest
}: {
  children?: ReactNode;
  align?: Align;
  sort?: SortState<K>;
  sortKey?: K;
  onSort?: (key: K) => void;
  className?: string;
} & Omit<ThHTMLAttributes<HTMLTableCellElement>, "onSort">) {
  const sortable = sort !== undefined && sortKey !== undefined && onSort !== undefined;
  const base = `px-3 py-2 font-medium ${ALIGN[align]} ${className}`;

  if (!sortable) {
    return (
      <th scope="col" className={base} {...rest}>
        {children}
      </th>
    );
  }

  const active = sort.key === sortKey;
  return (
    <th scope="col" aria-sort={ariaSortFor(sort, sortKey)} className={base} {...rest}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex select-none items-center gap-1 uppercase tracking-wide transition-colors hover:text-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 dark:hover:text-zinc-200 dark:focus-visible:outline-emerald-400 ${
          align === "right" ? "flex-row-reverse" : ""
        } ${active ? "text-zinc-800 dark:text-zinc-200" : ""}`}
      >
        <span>{children}</span>
        {/* aria-hidden: aria-sort on the <th> already announces the state, so
            the arrow is decoration and must not be read out twice. Kept in the
            layout when inactive (invisible, not hidden) so the header text
            does not shift sideways as the user sorts. */}
        <span aria-hidden="true" className={active ? "" : "invisible"}>
          {active && sort.dir === "desc" ? "▼" : "▲"}
        </span>
      </button>
    </th>
  );
}

export function Td({
  children,
  align = "left",
  className = "",
  ...rest
}: {
  children?: ReactNode;
  align?: Align;
  className?: string;
} & TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`px-3 py-2 ${ALIGN[align]} ${className}`} {...rest}>
      {children}
    </td>
  );
}
