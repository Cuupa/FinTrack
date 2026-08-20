"use client";

// The app's one tab strip: underlined, flush with a hairline that spans the
// full width of its container.
//
// Four surfaces had grown their own copy of the same markup (/analysis, the
// settings panel, the simulation model picker, and the retirement page) and
// they had already drifted -- two announced themselves as `role="tab"` with
// `aria-selected`, one as a plain button with `aria-pressed`, which reads to a
// screen reader as a toggle rather than as one of several views. This is the
// tablist shape, once.
//
// Not `SegmentedControl`: that one is a filled pill group for switching a
// control's units (timeframe, scale). These switch the whole view under them.

import type { ReactNode } from "react";
import { LockIcon } from "@/components/billing/pro-teaser";
import { FOCUS_RING } from "./primitives";

export type TabItem<T extends string> = {
  value: T;
  label: string;
  /** Draws a padlock after the label -- a Pro-locked tab stays selectable and
      gates its own panel, per the owner rule that a paywall is visible. */
  locked?: boolean;
};

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className = "",
  dataTour,
  actions,
}: {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Applied to the bordered container, for spacing at the call site. */
  className?: string;
  /** Spotlight target for a guided tour step. */
  dataTour?: string;
  /** Trailing content on the same rule, right-aligned. */
  actions?: ReactNode;
}) {
  return (
    <div
      data-tour={dataTour}
      className={`border-b border-subtle ${className}`}
    >
      <div className="-mb-px flex items-end gap-6">
        <div role="tablist" className="flex min-w-0 flex-1 gap-6 overflow-x-auto">
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={item.value === value}
              onClick={() => onChange(item.value)}
              className={`flex shrink-0 items-center gap-1.5 rounded-sm border-b-2 pb-2.5 text-sm font-medium transition-colors ${FOCUS_RING} ${
                item.value === value
                  ? "border-brand text-primary"
                  : "border-transparent text-tertiary hover:text-primary"
              }`}
            >
              {item.label}
              {item.locked && <LockIcon className="h-3.5 w-3.5 text-zinc-400" />}
            </button>
          ))}
        </div>
        {actions && <div className="shrink-0 pb-1.5">{actions}</div>}
      </div>
    </div>
  );
}
