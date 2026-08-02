"use client";

// The one place a form's buttons sit (owner rule): UNDER the fields, right
// aligned, always the same distance from them.
//
// Before this they sat wherever each form had grown them -- inside the field
// grid as a fake column, above the fields, left aligned in one dialog and right
// aligned in the next. Every one of those buttons changes stored data, so
// hunting for it in a different corner of each form is the one place a UI may
// not surprise anyone.
//
// The error line rides along on the left: a form that failed to save must say
// so next to the button that failed, not somewhere further up the page.
//
// Order inside: secondary/cancel first, the primary action last, so the action
// that commits is nearest the edge the eye ends on.

import type { ReactNode } from "react";

export function FormActions({
  error,
  children,
}: {
  /** Shown left of the buttons; nothing renders when there is none. */
  error?: string | null;
  children: ReactNode;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      {error && <p className="mr-auto text-sm text-red-600 dark:text-red-400">{error}</p>}
      {children}
    </div>
  );
}
