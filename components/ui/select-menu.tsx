"use client";

// Single-select dropdown styled like the header portfolio picker: a bordered
// button that opens a popover list with a checkmark on the current value.
// Optional `footer` (rendered with a `close` callback) for extra actions such
// as "+ New portfolio".

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n/i18n-context";

export interface SelectOption {
  value: string;
  label: string;
}

export function SelectMenu({
  value,
  options,
  onChange,
  className = "",
  ariaLabel,
  footer,
  searchable = false,
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
  footer?: (close: () => void) => ReactNode;
  searchable?: boolean;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const filtered =
    searchable && query.trim()
      ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()))
      : options;

  function toggleOpen() {
    setOpen((v) => {
      const next = !v;
      if (next) setQuery("");
      return next;
    });
  }

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={toggleOpen}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="inline-flex h-9 w-full items-center justify-between gap-2 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <span className="truncate">{selected?.label ?? "—"}</span>
        <span className="text-[10px] text-zinc-400">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-2 w-full min-w-[10rem] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          {searchable && (
            <div className="border-b border-zinc-100 p-1.5 dark:border-zinc-800">
              <input
                type="text"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setOpen(false);
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const first = filtered[0];
                    if (first) {
                      onChange(first.value);
                      setOpen(false);
                    }
                  }
                }}
                placeholder={t("select.search")}
                aria-label={t("select.search")}
                className="w-full rounded-md border border-zinc-300 px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
          )}
          <ul className="max-h-60 overflow-y-auto py-1" role="listbox">
            {filtered.length === 0 ? (
              <li className="px-3 py-1.5 text-sm text-zinc-400">{t("select.noResults")}</li>
            ) : (
              filtered.map((o) => {
                const on = o.value === value;
                return (
                  <li key={o.value}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={on}
                      onClick={() => {
                        onChange(o.value);
                        setOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      <span
                        className={`flex h-4 w-4 shrink-0 items-center justify-center text-[10px] ${
                          on ? "text-emerald-500" : "text-transparent"
                        }`}
                      >
                        ✓
                      </span>
                      <span className="truncate">{o.label}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          {footer && (
            <div className="border-t border-zinc-100 p-1.5 dark:border-zinc-800">
              {footer(() => setOpen(false))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
