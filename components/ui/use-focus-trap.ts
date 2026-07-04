"use client";

// Shared focus trap for modal-style overlays (Modal, ConfirmDialog): while
// `open`, moves focus into the dialog and cycles Tab/Shift+Tab among its
// focusable descendants so keyboard users can't tab out into the page behind;
// on close, restores focus to whatever had it before the dialog opened. Works
// for portalled dialogs too — `containerRef` is a ref to the real DOM node,
// portal or not.

import { useEffect, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(container: HTMLElement): HTMLElement[] {
  // Some panels (e.g. the add-asset tabs) keep inactive content mounted with
  // `hidden`/`display: none` instead of unmounting it, so querySelectorAll
  // alone picks up elements the keyboard can't actually reach. getClientRects
  // is empty for anything not rendered (display:none or detached), which is
  // the same check real Tab navigation effectively honours.
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => el.getClientRects().length > 0,
  );
}

export function useFocusTrap(containerRef: RefObject<HTMLElement | null>, open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = containerRef.current;

    // Move focus into the dialog: its first focusable descendant, or the
    // panel itself (relies on the panel having tabIndex={-1} to be
    // programmatically focusable).
    const first = container ? focusableIn(container)[0] : undefined;
    (first ?? container)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !container) return;
      const items = focusableIn(container);
      if (items.length === 0) {
        // Nothing tabbable inside — keep focus pinned on the panel.
        e.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === firstEl || !container.contains(active)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else if (active === lastEl || !container.contains(active)) {
        e.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus();
    };
  }, [open, containerRef]);
}
