"use client";

// Generic centered modal overlay: dim backdrop (click to close), Escape to
// close, scrolls when the content is tall. The child supplies its own surface
// (e.g. a Card), so the modal just handles positioning and dismissal.

import { useEffect, useRef, type ReactNode } from "react";
import { useFocusTrap } from "./use-focus-trap";

export function Modal({
  open,
  onClose,
  children,
  maxWidthClass = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  maxWidthClass?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    // Lock background scroll while the modal is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  useFocusTrap(panelRef, open);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`relative z-10 my-8 flex max-h-[calc(100dvh-4rem)] w-full flex-col outline-none ${maxWidthClass}`}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          ✕
        </button>
        {/* Scrolls internally so the close button (positioned relative to
            the dialog above, not this wrapper) stays pinned in place instead
            of scrolling away with tall content. min-h-0 lets this flex child
            shrink to make room for the scrollbar instead of growing past
            max-h-[...] on the dialog. */}
        <div className="min-h-0 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
