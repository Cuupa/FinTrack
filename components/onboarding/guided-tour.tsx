"use client";

// Generalized guided-tour overlay (ONBOARDING.md "Phase 1" + round-21 page
// tours): a spotlight overlay that walks a user through a page, parameterized
// by (tourId, steps, isDone, markDone). No third-party tour library: the need
// is one overlay, one measured rectangle and a tooltip card; a dependency
// would bring its own CSS/positioning system into a strict-CSP, Tailwind-only
// app for no benefit.
//
// `GuidedTour` below is the original dashboard tour: its call site
// (app/page.tsx, no props) and persistence (`profile.tourDoneAt`) are
// UNCHANGED from round 20. The four page tours (risk / rebalancing /
// simulation / assetTags, defined in ./page-tours.tsx) wrap the same
// `TourOverlay` with `profile.toursDone[tourId]` instead, and are mounted by
// their page only once it has something to show — that natural "first visit
// with data" gate replaces a separate "enabled" flag, see each call site.
//
// Render is gated on a DERIVED `open` (`(forceOpen || !isDone) && !closed`),
// never synced via effect. Finishing or skipping both call `markDone()` and
// flip the local `closed` flag in the same click handler, so the overlay
// closes even if the write rejects (`StorageFullError` is caught per the
// storage-quota convention: close silently, nothing was lost).

import { useCallback, useEffect, useRef, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useFocusTrap } from "@/components/ui/use-focus-trap";
import { Button } from "@/components/ui/primitives";
import { isStorageFullError } from "@/lib/store/errors";
import {
  computeTooltipPosition,
  filterVisibleSteps,
  TOUR_STEPS,
  type Rect,
  type TourStep,
} from "@/lib/onboarding/tour-steps";

const HIGHLIGHT_PAD = 6;
// Sensible defaults so the very first measured frame isn't wildly wrong;
// corrected by the card's own rAF measurement right after mount.
const DEFAULT_CARD_SIZE = { width: 320, height: 160 };

/** The `data-tour="name"` element to spotlight. Only visible matches count:
 *  an element hidden via `display: none` (e.g. the sidebar on a narrow
 *  viewport) has no client rects and its step must be skipped, never
 *  spotlighted as a zero-size rect. `getClientRects()` instead of
 *  `offsetParent` so sticky/fixed targets stay eligible. */
function resolveTarget(name: string): HTMLElement | null {
  const matches = document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`);
  for (const el of matches) {
    if (el.getClientRects().length > 0) return el;
  }
  return null;
}

function rectOf(el: HTMLElement): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

function sameRect(a: Rect | null, b: Rect): boolean {
  return !!a && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

export interface TourOverlayProps {
  /** Stable id for this tour. Used only for error-log context here; callers
   *  key their own persistence (`isDone`/`markDone`) off it. */
  tourId: string;
  steps: readonly TourStep[];
  /** Whether this tour was already completed or skipped (persisted). */
  isDone: boolean;
  /** Persists completion. Errors other than `StorageFullError` are logged,
   *  never thrown — the overlay always closes regardless of the outcome. */
  markDone: () => Promise<void>;
  /** Replay affordance: open the tour regardless of `isDone`. Callers force a
   *  fresh mount alongside this (e.g. bump a `key`) so `closed` also resets. */
  forceOpen?: boolean;
}

export function TourOverlay({ tourId, steps, isDone, markDone, forceOpen = false }: TourOverlayProps) {
  const { t } = useI18n();

  const [closed, setClosed] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [visibleSteps, setVisibleSteps] = useState<TourStep[]>([]);
  const [targetRect, setTargetRect] = useState<Rect | null>(null);
  const [cardSize, setCardSize] = useState(DEFAULT_CARD_SIZE);
  const [viewport, setViewport] = useState(() =>
    typeof window === "undefined"
      ? { width: 0, height: 0 }
      : { width: window.innerWidth, height: window.innerHeight },
  );

  const cardRef = useRef<HTMLDivElement>(null);

  const open = (forceOpen || !isDone) && !closed;

  // Compute the step set once per mount (a replay bumps the caller's `key`,
  // remounting this component, so a fresh computation naturally happens
  // then too). Deferred to a rAF continuation, never a synchronous setState
  // in the effect body.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      setVisibleSteps(filterVisibleSteps(steps, (name) => resolveTarget(name) !== null));
    });
    return () => cancelAnimationFrame(raf);
    // Intentionally run once per mount, not on every `open` recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = visibleSteps[stepIndex] ?? null;

  // Scroll the target into view and measure it on step change.
  useEffect(() => {
    if (!open || !step) return;
    let cancelled = false;
    const raf = requestAnimationFrame(() => {
      if (cancelled) return;
      if (!step.target) {
        setTargetRect(null);
        return;
      }
      const el = resolveTarget(step.target);
      if (!el) {
        setTargetRect(null);
        return;
      }
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      setTargetRect(rectOf(el));
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [open, step]);

  // Re-measure on resize/scroll (the target may move under a smooth scroll,
  // a resize, or content reflow above it), rAF-throttled continuations.
  useEffect(() => {
    if (!open || !step) return;
    let raf = 0;
    const remeasure = () => {
      if (step.target) {
        const el = resolveTarget(step.target);
        setTargetRect((prev) => {
          if (!el) return null;
          const r = rectOf(el);
          return sameRect(prev, r) ? prev : r;
        });
      }
      if (typeof window !== "undefined") {
        setViewport((prev) =>
          prev.width === window.innerWidth && prev.height === window.innerHeight
            ? prev
            : { width: window.innerWidth, height: window.innerHeight },
        );
      }
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(remeasure);
    };
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
    };
  }, [open, step]);

  // Measure the card's actual rendered size (its content, hence width/height,
  // varies per step and per locale) right after it paints.
  useEffect(() => {
    if (!open || !step) return;
    const raf = requestAnimationFrame(() => {
      const el = cardRef.current;
      if (!el) return;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      setCardSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    });
    return () => cancelAnimationFrame(raf);
  }, [open, step]);

  useFocusTrap(cardRef, open);

  const isLast = step != null && stepIndex === visibleSteps.length - 1;

  const next = useCallback(
    () => setStepIndex((i) => Math.min(i + 1, visibleSteps.length - 1)),
    [visibleSteps.length],
  );
  const back = useCallback(() => setStepIndex((i) => Math.max(i - 1, 0)), []);
  // Finishing and skipping are the same dismissal: close locally first (so the
  // overlay goes away even if the write rejects), then persist the marker.
  const dismiss = useCallback(() => {
    setClosed(true);
    void (async () => {
      try {
        await markDone();
      } catch (err) {
        if (!isStorageFullError(err)) {
          console.error(`Failed to persist "${tourId}" tour completion`, err);
        }
      }
    })();
  }, [markDone, tourId]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        if (isLast) dismiss();
        else next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        back();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, isLast, dismiss, next, back]);

  if (!open || !step) return null;

  const pos = computeTooltipPosition(targetRect, viewport, cardSize);

  return (
    <div className="fixed inset-0 z-50">
      {targetRect ? (
        <div
          className="pointer-events-none absolute rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] ring-2 ring-emerald-500/80 transition-all duration-200"
          style={{
            top: targetRect.top - HIGHLIGHT_PAD,
            left: targetRect.left - HIGHLIGHT_PAD,
            width: targetRect.width + HIGHLIGHT_PAD * 2,
            height: targetRect.height + HIGHLIGHT_PAD * 2,
          }}
        />
      ) : (
        <div className="pointer-events-none absolute inset-0 bg-black/55" />
      )}

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        className="fixed z-50 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-zinc-200 bg-white p-4 shadow-lg outline-none transition-all duration-200 dark:border-zinc-800 dark:bg-zinc-900"
        style={{ top: pos.top, left: pos.left }}
      >
        <h2 id="tour-title" className="text-base font-semibold">
          {t(step.titleKey)}
        </h2>
        <p id="tour-body" className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-400">
          {t(step.bodyKey)}
        </p>
        <div className="sr-only" role="status" aria-live="polite">
          {t("tour.progressAria", { current: stepIndex + 1, total: visibleSteps.length })}
        </div>

        {/* flex-wrap: the German labels are wider (Tour überspringen / Zurück /
            Weiter) and must wrap as a whole row, never mid-label. */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-1.5" aria-hidden="true">
            {visibleSteps.map((s, i) => (
              <span
                key={s.key}
                className={`h-1.5 w-1.5 rounded-full ${
                  i === stepIndex ? "bg-emerald-600 dark:bg-emerald-400" : "bg-zinc-300 dark:bg-zinc-700"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={dismiss}
              className="whitespace-nowrap text-xs text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
            >
              {t("tour.skip")}
            </button>
            {stepIndex > 0 && (
              <Button variant="secondary" size="sm" onClick={back}>
                {t("tour.back")}
              </Button>
            )}
            <Button variant="primary" size="sm" onClick={isLast ? dismiss : next}>
              {isLast ? t("tour.finish") : stepIndex === 0 ? t("tour.start") : t("tour.next")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The original dashboard tour: mounted unconditionally by app/page.tsx
 *  inside its "loaded" branch. Persistence stays on `profile.tourDoneAt`
 *  (not `toursDone`) for back-compat with existing rows. */
export function GuidedTour() {
  const { data, updateProfile } = usePortfolio();
  return (
    <TourOverlay
      tourId="dashboard"
      steps={TOUR_STEPS}
      isDone={data.profile.tourDoneAt != null}
      markDone={() => updateProfile({ tourDoneAt: new Date().toISOString() })}
    />
  );
}
