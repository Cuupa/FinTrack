"use client";

// Single-select dropdown styled like the header portfolio picker: a bordered
// button that opens a popover list with a checkmark on the current value.
// Optional `footer` (rendered with a `close` callback) for extra actions such
// as "+ New portfolio".

import { useEffect, useRef, useState, type ReactNode } from "react";

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
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
  footer?: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
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

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
          <ul className="max-h-60 overflow-y-auto py-1" role="listbox">
            {options.map((o) => {
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
            })}
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
