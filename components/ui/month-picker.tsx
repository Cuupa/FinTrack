"use client";

// The page-level month filter for /cashflow and /accounts.
//
// It replaces the per-card picker the budgets card used to own: one page, one
// answer to "which month am I looking at". `null` means every month, which is
// how both pages behave with no selection -- a filter you cannot clear would
// hide the totals the pages exist to show.
//
// The centre label opens a popover with a month grid and a year view, so
// jumping to "January 2010" is two clicks, not two dozen on the arrows. The
// trigger keeps a fixed width and clearing lives inside the popover ("Alle
// Monate"), so the row never shifts as the label changes between a month and
// "every month".

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { shiftMonth, today } from "@/lib/finance/dates";
import { useI18n } from "@/lib/i18n/i18n-context";

const YEARS_PER_PAGE = 12;

function monthValue(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

export function MonthPicker({
  value,
  onChange,
}: {
  /** `YYYY-MM`, or null for every month. */
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const { t, locale } = useI18n();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"months" | "years">("months");
  const currentYear = Number(today().slice(0, 4));
  const selectedYear = value ? Number(value.slice(0, 4)) : null;
  const selectedMonth = value ? Number(value.slice(5, 7)) - 1 : null;
  const [viewYear, setViewYear] = useState(selectedYear ?? currentYear);

  const ref = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      // Right-align the popover under the trigger: the picker sits at the right
      // end of the page header, so a left-anchored panel would overflow.
      const width = popoverRef.current?.offsetWidth ?? 240;
      setAnchor({ left: Math.max(8, rect.right - width), top: rect.bottom + 8 });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, mode]);

  // From "all months" the arrows start at the current month, so the first click
  // lands somewhere the user recognises rather than at an epoch.
  const step = (delta: number) => onChange(shiftMonth(value ?? today().slice(0, 7), delta));

  const label = value
    ? new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(
        new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, 1)),
      )
    : t("common.allMonths");

  const monthNames = Array.from({ length: 12 }, (_, m) =>
    new Intl.DateTimeFormat(locale, { month: "short" }).format(new Date(Date.UTC(2000, m, 1))),
  );

  const yearsPageStart = viewYear - (((viewYear % YEARS_PER_PAGE) + YEARS_PER_PAGE) % YEARS_PER_PAGE);

  function openPopover() {
    setViewYear(selectedYear ?? currentYear);
    setMode("months");
    setOpen(true);
  }

  const arrowCls =
    "grid h-8 w-8 place-items-center rounded-md text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800";
  const cellCls =
    "rounded-md px-2 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800";
  const selectedCellCls = "bg-zinc-900 text-white hover:bg-zinc-900 dark:bg-white dark:text-zinc-900 dark:hover:bg-white";

  return (
    <div className="relative flex items-center gap-0.5 text-sm" ref={ref}>
      <button type="button" aria-label="‹" className={arrowCls} onClick={() => step(-1)}>
        ‹
      </button>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : openPopover())}
        className="h-8 w-32 rounded-md text-center font-medium hover:bg-zinc-100 dark:hover:bg-zinc-800"
      >
        {label}
      </button>
      <button type="button" aria-label="›" className={arrowCls} onClick={() => step(1)}>
        ›
      </button>

      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: "fixed",
              left: anchor?.left ?? -9999,
              top: anchor?.top ?? -9999,
              visibility: anchor ? "visible" : "hidden",
            }}
            className="z-[60] w-64 rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
          >
            {/* Header: step the year, or open the year grid to jump decades. */}
            <div className="mb-1 flex items-center justify-between">
              <button
                type="button"
                aria-label="‹"
                className={arrowCls}
                onClick={() => (mode === "months" ? setViewYear((y) => y - 1) : setViewYear((y) => y - YEARS_PER_PAGE))}
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setMode((m) => (m === "months" ? "years" : "months"))}
                className="rounded-md px-2 py-1 text-sm font-semibold hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                {mode === "months"
                  ? viewYear
                  : `${yearsPageStart} – ${yearsPageStart + YEARS_PER_PAGE - 1}`}
              </button>
              <button
                type="button"
                aria-label="›"
                className={arrowCls}
                onClick={() => (mode === "months" ? setViewYear((y) => y + 1) : setViewYear((y) => y + YEARS_PER_PAGE))}
              >
                ›
              </button>
            </div>

            {mode === "months" ? (
              <div className="grid grid-cols-3 gap-1">
                {monthNames.map((name, m) => {
                  const isSelected = selectedYear === viewYear && selectedMonth === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={isSelected}
                      className={`${cellCls} ${isSelected ? selectedCellCls : ""}`}
                      onClick={() => {
                        onChange(monthValue(viewYear, m));
                        setOpen(false);
                      }}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1">
                {Array.from({ length: YEARS_PER_PAGE }, (_, i) => yearsPageStart + i).map((y) => (
                  <button
                    key={y}
                    type="button"
                    aria-pressed={selectedYear === y}
                    className={`${cellCls} ${selectedYear === y ? selectedCellCls : ""}`}
                    onClick={() => {
                      setViewYear(y);
                      setMode("months");
                    }}
                  >
                    {y}
                  </button>
                ))}
              </div>
            )}

            {/* Clearing lives here, not as an "×" next to the trigger, so the
                trigger's width never changes and the row never shifts. */}
            <button
              type="button"
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
              className={`mt-2 w-full rounded-md border border-zinc-200 px-2 py-1.5 text-sm hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800 ${
                value === null ? "font-semibold" : "text-zinc-500"
              }`}
            >
              {t("common.allMonths")}
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}

/** True when `date` (a `YYYY-MM-DD` string) falls in `month`, or when there is
 *  no month filter at all. Kept here so every surface filters identically. */
export function inMonth(date: string, month: string | null): boolean {
  return month === null || date.slice(0, 7) === month;
}
