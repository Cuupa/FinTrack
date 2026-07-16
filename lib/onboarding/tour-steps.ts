// Pure step registry + geometry helpers for the guided tour
// (components/onboarding/guided-tour.tsx). Kept dependency-free (no DOM, no
// React) so both are covered by fast unit tests; the component owns all
// DOM measurement and just calls into these.

import type { MessageKey } from "@/lib/i18n/dictionaries";

export interface TourStep {
  key: string;
  /** `data-tour` attribute value to spotlight, or null for a centered card
   *  (welcome/done) that has no page target. */
  target: string | null;
  titleKey: MessageKey;
  bodyKey: MessageKey;
}

// Order mirrors the table in ONBOARDING.md "Phase 1: guided tour" exactly.
export const TOUR_STEPS: TourStep[] = [
  { key: "welcome", target: null, titleKey: "tour.welcome.title", bodyKey: "tour.welcome.body" },
  {
    key: "addAsset",
    target: "add-asset",
    titleKey: "tour.addAsset.title",
    bodyKey: "tour.addAsset.body",
  },
  {
    key: "netWorth",
    target: "net-worth",
    titleKey: "tour.netWorth.title",
    bodyKey: "tour.netWorth.body",
  },
  {
    key: "holdings",
    target: "holdings",
    titleKey: "tour.holdings.title",
    bodyKey: "tour.holdings.body",
  },
  { key: "nav", target: "nav", titleKey: "tour.nav.title", bodyKey: "tour.nav.body" },
  {
    key: "themeToggle",
    target: "theme-toggle",
    titleKey: "tour.themeToggle.title",
    bodyKey: "tour.themeToggle.body",
  },
  { key: "done", target: null, titleKey: "tour.done.title", bodyKey: "tour.done.body" },
];

/**
 * Drops steps whose target isn't present in the DOM for this run (a feature
 * flag off, or a narrow viewport hiding the sidebar); centered steps
 * (`target === null`) always survive. `hasTarget` is injected so this stays
 * pure and testable without touching `document`.
 */
export function filterVisibleSteps(
  steps: readonly TourStep[],
  hasTarget: (target: string) => boolean,
): TourStep[] {
  return steps.filter((s) => s.target === null || hasTarget(s.target));
}

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface TooltipPosition {
  top: number;
  left: number;
  placement: "above" | "below" | "center";
}

/** Gap kept between the tooltip card and the target rect / viewport edges. */
export const TOOLTIP_MARGIN = 12;

/**
 * Positions the tooltip card below the target rect, flipping above when
 * there isn't room, and clamping horizontally (and, in the degenerate case
 * of a card taller than the viewport, vertically) so it never renders off
 * screen. A `null` target (centered steps, or a step whose target vanished
 * mid-tour) always centers the card in the viewport.
 */
export function computeTooltipPosition(
  target: Rect | null,
  viewport: { width: number; height: number },
  card: { width: number; height: number },
): TooltipPosition {
  const maxLeft = Math.max(TOOLTIP_MARGIN, viewport.width - card.width - TOOLTIP_MARGIN);
  const maxTop = Math.max(TOOLTIP_MARGIN, viewport.height - card.height - TOOLTIP_MARGIN);

  if (!target) {
    return {
      top: Math.max(TOOLTIP_MARGIN, (viewport.height - card.height) / 2),
      left: Math.max(TOOLTIP_MARGIN, (viewport.width - card.width) / 2),
      placement: "center",
    };
  }

  const spaceBelow = viewport.height - (target.top + target.height);
  const spaceAbove = target.top;
  const placeBelow = spaceBelow >= card.height + TOOLTIP_MARGIN || spaceBelow >= spaceAbove;

  const top = placeBelow
    ? Math.min(target.top + target.height + TOOLTIP_MARGIN, maxTop)
    : Math.max(TOOLTIP_MARGIN, target.top - card.height - TOOLTIP_MARGIN);

  const idealLeft = target.left + target.width / 2 - card.width / 2;
  const left = Math.min(Math.max(idealLeft, TOOLTIP_MARGIN), maxLeft);

  return {
    top: Math.max(TOOLTIP_MARGIN, top),
    left: Math.max(TOOLTIP_MARGIN, left),
    placement: placeBelow ? "below" : "above",
  };
}
