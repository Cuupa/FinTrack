"use client";

// Styled confirmation modal for destructive actions (replaces window.confirm).
// Controlled: render with `open` and handle onConfirm/onCancel.

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Button } from "./primitives";
import { useFocusTrap } from "./use-focus-trap";

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  useFocusTrap(panelRef, open);

  if (!open) return null;
  // Rendered through a portal to document.body: a `fixed inset-0` overlay
  // nested inside an ancestor with `backdrop-filter` (e.g. the blurred site
  // header) would otherwise be positioned relative to that ancestor instead
  // of the viewport, since backdrop-filter establishes a containing block.
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative z-10 w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-5 shadow-xl outline-none dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h2 className="text-lg font-semibold">{title}</h2>
        {message && <p className="mt-2 text-sm text-zinc-500">{message}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
