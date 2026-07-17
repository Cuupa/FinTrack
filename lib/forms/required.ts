"use client";

// Shared "required field" presence gating for data-entry forms (add-asset,
// transaction, savings-plan, watchlist, login/register). Submit buttons stay
// disabled while any required field for the current mode is empty — but this
// is presence-only: whether a filled-in value is actually *valid* (a real
// number, > 0, a real date, …) is still decided at submit time, exactly as
// before. See CLAUDE.md — never set state synchronously inside an effect;
// `touch` is only ever called from event handlers.

import { useCallback, useState } from "react";

/**
 * Tracks whether the user has started interacting with a form (any required
 * field changed or blurred). Gates the "missing field" highlight so a freshly
 * opened form doesn't show amber borders before the user has done anything.
 * `reset` clears it back to untouched — for forms that stay mounted and clear
 * their own fields after a successful submit (rather than unmounting), so the
 * freshly-emptied fields don't immediately re-trigger the amber highlight.
 */
export function useFormTouched() {
  const [touched, setTouched] = useState(false);
  const touch = useCallback(() => setTouched(true), []);
  const reset = useCallback(() => setTouched(false), []);
  return { touched, touch, reset };
}

/**
 * Extra classes for a required input that is currently empty, applied only
 * once the form has been touched. Uses `!` to override the input's base
 * border color (mirrors the `!bg-*` overrides used for the transaction-form
 * buttons).
 */
export function missingFieldCls(missing: boolean, touched: boolean): string {
  return missing && touched ? " !border-amber-400 dark:!border-amber-600" : "";
}

/**
 * Label text-color variant of the same highlight, for required fields backed
 * by a control that has no styleable border of its own (e.g. the custom
 * `SelectMenu` trigger button) — matches the muted label className used
 * throughout these forms (`mb-1 block text-xs font-medium text-zinc-500`).
 */
export function missingLabelCls(missing: boolean, touched: boolean): string {
  return missing && touched
    ? "mb-1 block text-xs font-medium text-amber-600 dark:text-amber-400"
    : "mb-1 block text-xs font-medium text-zinc-500";
}
