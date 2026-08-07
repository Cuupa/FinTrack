"use client";

// The one row-action vocabulary. Editing a row looked different in every
// table: outlined "Edit"/"Delete" buttons in the spending ledger, quiet text
// buttons plus an "x" in the savings plans, icons in the transaction log. Same
// action, three visual weights, so the loudest one read as the important one.
//
// Everything that acts on a single row uses these: a pencil edits, an x
// deletes, the bars/triangle pause and resume. Each carries the same word it
// used to spell out, as its accessible name and its tooltip -- the label is
// gone from the screen, never from the semantics.
//
// Anything that is NOT a row action (a page-level "Add", a form submit) stays
// a Button.

import type { ReactNode } from "react";

const BASE = "rounded px-1.5 py-1 transition-colors disabled:opacity-40";
const QUIET = `${BASE} text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200`;
const DANGER = `${BASE} text-zinc-400 hover:text-red-500`;

/** Right-aligned action group for a table row's last cell. */
export function RowActions({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-0.5">{children}</div>;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="inline h-3.5 w-3.5"
    >
      {children}
    </svg>
  );
}

interface ActionProps {
  /** Shown as the tooltip AND the accessible name: the word the button used
   *  to spell out, so nothing is lost by dropping to an icon. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export function EditAction({ label, onClick, disabled }: ActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={QUIET}
      aria-label={label}
      title={label}
    >
      <Icon>
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
      </Icon>
    </button>
  );
}

export function DeleteAction({ label, onClick, disabled }: ActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={DANGER}
      aria-label={label}
      title={label}
    >
      <Icon>
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </Icon>
    </button>
  );
}

/**
 * Promotes a one-off row into a recurring entry. A circular arrow, because
 * that is what "it comes back" looks like everywhere else.
 *
 * An icon like the rest even though it CREATES something rather than editing
 * this row: a labelled button parked between two icons was the one style
 * break left in the ledger, and "same action, three visual weights" is
 * exactly what this file exists to stop.
 */
export function RecurringAction({ label, onClick, disabled }: ActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={QUIET}
      aria-label={label}
      title={label}
    >
      <Icon>
        <path d="M21 12a9 9 0 1 1-2.64-6.36" />
        <path d="M21 3v6h-6" />
      </Icon>
    </button>
  );
}

/** Opens the dated record behind a row (a policy's values, a balance history)
 *  -- a second pencil for it would read as a second way to edit the same row. */
export function HistoryAction({ label, onClick, disabled }: ActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={QUIET}
      aria-label={label}
      title={label}
    >
      <Icon>
        <path d="M8 6h13" />
        <path d="M8 12h13" />
        <path d="M8 18h13" />
        <path d="M3 6h.01" />
        <path d="M3 12h.01" />
        <path d="M3 18h.01" />
      </Icon>
    </button>
  );
}

/**
 * Passes over a due occurrence for good: it is neither booked nor left waiting.
 * The skip-forward glyph, because an x here would read as "delete the entry"
 * and the entry itself survives — only this one occurrence is closed.
 */
export function SkipAction({ label, onClick, disabled }: ActionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={QUIET}
      aria-label={label}
      title={label}
    >
      <Icon>
        <path d="M5 4l10 8-10 8V4z" fill="currentColor" stroke="none" />
        <path d="M19 5v14" />
      </Icon>
    </button>
  );
}

/** Pause when running, resume when paused -- one button, `paused` picks the
 *  glyph, the caller picks the word. */
export function PauseAction({
  label,
  paused,
  onClick,
  disabled,
}: ActionProps & { paused: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={QUIET}
      aria-label={label}
      title={label}
    >
      <Icon>
        {paused ? (
          <path d="M6 4l14 8-14 8V4z" fill="currentColor" stroke="none" />
        ) : (
          <>
            <path d="M9 5v14" />
            <path d="M15 5v14" />
          </>
        )}
      </Icon>
    </button>
  );
}
