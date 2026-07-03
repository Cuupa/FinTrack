"use client";

// Small "ⓘ" affordance with a short explanatory tooltip (hover or focus).
// Used to explain metrics in-place.

import { useState, type FocusEvent, type MouseEvent } from "react";

// Bubble width (matches Tailwind w-56) and the minimum gap kept from the
// viewport edges when clamping the fixed-position overlay bubble.
const BUBBLE_W = 224;
const EDGE_MARGIN = 8;
// Vertical gap between trigger and bubble (matches the default variant's mb-1.5).
const GAP = 6;

export function InfoTip({
  text,
  className = "",
  overlay = false,
}: {
  text: string;
  className?: string;
  /**
   * Render the bubble with `position: fixed` at viewport coordinates instead
   * of absolutely inside the trigger. Opt into this when the trigger sits
   * inside an overflow container (e.g. a scrollable table) that would clip
   * the default absolutely-positioned bubble. Coordinates are measured on
   * mouse-enter/focus and clamped to the viewport.
   */
  overlay?: boolean;
}) {
  // Overlay mode only: bubble anchor in viewport coordinates (null = hidden).
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = (e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    if (!overlay) return;
    const r = e.currentTarget.getBoundingClientRect();
    const half = BUBBLE_W / 2;
    // Center on the trigger, clamped so the bubble never leaves the viewport.
    const left = Math.min(
      Math.max(r.left + r.width / 2, half + EDGE_MARGIN),
      window.innerWidth - half - EDGE_MARGIN,
    );
    setPos({ top: r.top - GAP, left });
  };
  const hide = () => {
    if (overlay) setPos(null);
  };

  return (
    <span
      className={`group relative inline-flex align-middle ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <button
        type="button"
        aria-label="What is this?"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-zinc-300 text-[10px] font-semibold leading-none text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-600 dark:border-zinc-600 dark:text-zinc-500 dark:hover:border-zinc-400 dark:hover:text-zinc-300"
      >
        i
      </button>
      {overlay ? (
        pos && (
          <span
            role="tooltip"
            className="pointer-events-none fixed z-30 w-56 -translate-x-1/2 -translate-y-full rounded-lg border border-zinc-200 bg-white p-2.5 text-left text-xs font-normal normal-case leading-snug text-zinc-600 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
            style={{ top: pos.top, left: pos.left }}
          >
            {text}
          </span>
        )
      ) : (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 hidden w-56 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white p-2.5 text-left text-xs font-normal leading-snug text-zinc-600 shadow-lg group-hover:block group-focus-within:block dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
        >
          {text}
        </span>
      )}
    </span>
  );
}
