"use client";

// The one place a form's buttons sit (owner rule): under the fields, right
// aligned, cancel before the action that commits. The error line rides on the
// left, so a failed save says so next to the button that failed.

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
