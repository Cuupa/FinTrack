"use client";

// The app's dropdown, styled like the header portfolio picker: a bordered
// button that opens a popover list with a checkmark on the current value.
// Optional `footer` (rendered with a `close` callback) for extra actions such
// as "+ New portfolio".
//
// Opt-in `multiple` turns the same control into a multi-select: the popover
// stays open while values are toggled, and the button summarises the count. It
// is a mode of this component rather than a second picker so that every list in
// the app keeps one look, one keyboard behaviour and one search box.
//
// In multi mode an EMPTY selection is a legitimate state, not a broken one --
// what it means belongs to the caller (on /accounts it means every account),
// which is why the empty label is a required prop rather than a hardcoded "—".

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n/i18n-context";

export interface SelectOption {
  value: string;
  label: string;
  /**
   * Heading this option belongs under. Options carrying one render in labelled
   * sections instead of a flat list of "Group - Name" rows, which repeats the
   * group on every line and still leaves the eye to find where one ends.
   */
  group?: string;
  /** Hidden search terms (e.g. ISIN/WKN/symbol) matched by `searchable` filtering, never rendered. */
  keywords?: string[];
}

/** Above this many options a select offers a search box on its own. Below it a
 *  filter over three rows is noise. */
const SEARCH_THRESHOLD = 7;

type SelectMenuBase = {
  options: SelectOption[];
  className?: string;
  ariaLabel?: string;
  footer?: (close: () => void) => ReactNode;
  /** Forces the search box on below {@link SEARCH_THRESHOLD} options; above it
   *  the box appears on its own, so every long list is searchable. */
  searchable?: boolean;
};

type SingleSelectProps = SelectMenuBase & {
  multiple?: false;
  value: string;
  onChange: (value: string) => void;
};

type MultiSelectProps = SelectMenuBase & {
  multiple: true;
  value: string[];
  onChange: (values: string[]) => void;
  /** Button label while nothing is selected -- the caller's word for "all". */
  emptyLabel: string;
};

export function SelectMenu(props: SingleSelectProps | MultiSelectProps) {
  const { options, className = "", ariaLabel, footer } = props;
  const searchable = props.searchable || options.length > SEARCH_THRESHOLD;
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  // Where the popover floats. It is rendered into the body rather than next to
  // the trigger: inside a modal the trigger sits in an `overflow-y-auto` box,
  // so an absolutely positioned list was clipped by it, pushed the dialog's own
  // scrollbar around and scrolled away from the field it belongs to.
  const [anchor, setAnchor] = useState<{ left: number; top: number; width: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Follow the trigger while the page or any scroll container moves under it,
  // and close on nothing: a popover that silently detaches from its field is
  // worse than one that stays put.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom;
      const height = popoverRef.current?.offsetHeight ?? 0;
      // Flip above the trigger when the list would not fit under it.
      const flip = height > 0 && below < height + 16 && rect.top > below;
      setAnchor({
        left: rect.left,
        top: flip ? Math.max(8, rect.top - height - 8) : rect.bottom + 8,
        width: rect.width,
      });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, query, options.length]);

  const selectedValues = props.multiple ? props.value : [props.value];
  const isOn = (value: string) => selectedValues.includes(value);

  /** Single: replace and close. Multi: toggle and stay open, because picking a
      second value is the normal next action and a popover that closed after
      every tick would make selecting three accounts three round trips. */
  const pick = (value: string) => {
    if (props.multiple) {
      props.onChange(
        props.value.includes(value)
          ? props.value.filter((v) => v !== value)
          : [...props.value, value],
      );
      return;
    }
    props.onChange(value);
    setOpen(false);
  };

  const buttonLabel = () => {
    if (!props.multiple) return options.find((o) => o.value === props.value)?.label ?? "—";
    if (selectedValues.length === 0) return props.emptyLabel;
    if (selectedValues.length === 1) {
      return options.find((o) => o.value === selectedValues[0])?.label ?? props.emptyLabel;
    }
    return t("select.nSelected", { count: String(selectedValues.length) });
  };

  const filtered =
    searchable && query.trim()
      ? options.filter((o) => {
          const q = query.trim().toLowerCase();
          if (o.label.toLowerCase().includes(q)) return true;
          return (o.keywords ?? []).some((k) => k.trim().toLowerCase().includes(q));
        })
      : options;

  /** The filtered options in render order, split into the sections their
   *  `group` declares. Ungrouped options keep a null heading and render flat,
   *  so a list that never sets `group` looks exactly as it did. */
  const sections = (() => {
    const out: { group: string | null; options: SelectOption[] }[] = [];
    for (const o of filtered) {
      const group = o.group ?? null;
      const last = out[out.length - 1];
      if (last && last.group === group) last.options.push(o);
      else out.push({ group, options: [o] });
    }
    return out;
  })();

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
        className="inline-flex h-9 w-full items-center justify-between gap-2 rounded-md border border-zinc-300 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        <span className="truncate">{buttonLabel()}</span>
        <span className="text-[10px] text-zinc-400">▾</span>
      </button>

      {open && typeof document !== "undefined" && createPortal(
        // Wider than the trigger when the options need it: the button is
        // narrow by layout, but "Girokonto Hanseatic Bank Gemeinschaftskonto"
        // clipped to "Girokonto Hanseatic Bank Ge..." in the list is a name
        // nobody can pick between two similar accounts by. Above the modal
        // layer (z-50), because that is exactly where it is opened from.
        <div
          ref={popoverRef}
          style={{
            position: "fixed",
            left: anchor?.left ?? -9999,
            top: anchor?.top ?? -9999,
            minWidth: anchor?.width ?? undefined,
            visibility: anchor ? "visible" : "hidden",
          }}
          className="z-[60] w-max max-w-[min(36rem,90vw)] overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
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
                    if (first) pick(first.value);
                  }
                }}
                placeholder={t("select.search")}
                aria-label={t("select.search")}
                className="w-full rounded-sm border border-zinc-300 px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </div>
          )}
          {/* The way back to "everything". Without it a multi-select is a trap:
              unticking the last value by hand is the only route to the default
              state, and nothing on screen says that state exists. */}
          {props.multiple && props.value.length > 0 && (
            <div className="border-b border-zinc-100 p-1.5 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => props.onChange([])}
                className="w-full rounded-sm px-1.5 py-1 text-left text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                {props.emptyLabel}
              </button>
            </div>
          )}
          <ul
            className="max-h-60 overflow-y-auto py-1"
            role="listbox"
            aria-multiselectable={props.multiple ? true : undefined}
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-1.5 text-sm text-zinc-400">{t("select.noResults")}</li>
            ) : (
              sections.map((section, si) => (
                <li key={section.group ?? `_${si}`}>
                  {section.group && (
                    // presentation: a listbox may only contain options, and a
                    // heading is not one -- it cannot be selected.
                    <div
                      role="presentation"
                      className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wider text-zinc-400 uppercase dark:text-zinc-500"
                    >
                      {section.group}
                    </div>
                  )}
                  <ul>
                    {section.options.map((o) => {
                      const on = isOn(o.value);
                      return (
                        <li key={o.value}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={on}
                            onClick={() => pick(o.value)}
                            className={`flex w-full items-center gap-2 py-1.5 pr-3 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                              section.group ? "pl-5" : "pl-3"
                            }`}
                          >
                            {/* Decorative: the mark renders for every option and
                                is merely emptied when unselected, so without it
                                the tick would read into EVERY option's
                                accessible name -- `aria-selected` carries the
                                real state. Multi mode draws the same square as
                                the header portfolio picker; the two controls
                                used to differ on this alone. */}
                            {props.multiple ? (
                              <span
                                aria-hidden="true"
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                                  on
                                    ? "border-emerald-500 bg-emerald-500 text-white"
                                    : "border-zinc-300 dark:border-zinc-600"
                                }`}
                              >
                                {on ? "✓" : ""}
                              </span>
                            ) : (
                              <span
                                aria-hidden="true"
                                className={`flex h-4 w-4 shrink-0 items-center justify-center text-[10px] ${
                                  on ? "text-emerald-500" : "text-transparent"
                                }`}
                              >
                                ✓
                              </span>
                            )}
                            <span className="truncate">{o.label}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))
            )}
          </ul>
          {footer && (
            <div className="border-t border-zinc-100 p-1.5 dark:border-zinc-800">
              {footer(() => setOpen(false))}
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
