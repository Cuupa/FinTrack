// Pure helpers behind the guided tour (lib/onboarding/tour-steps.ts):
// step filtering (targets that vanish from the DOM, e.g. a narrow viewport
// hiding the sidebar) and tooltip placement geometry (below/above flip,
// viewport clamping). No DOM/React involved, so these are plain unit tests.

import { describe, expect, it } from "vitest";
import {
  computeTooltipPosition,
  filterVisibleSteps,
  TOUR_STEPS,
  TOOLTIP_MARGIN,
  type TourStep,
} from "../lib/onboarding/tour-steps";

describe("filterVisibleSteps", () => {
  it("keeps centered steps and drops steps whose target is missing", () => {
    const steps: TourStep[] = [
      { key: "a", target: null, titleKey: "tour.welcome.title", bodyKey: "tour.welcome.body" },
      { key: "b", target: "present", titleKey: "tour.nav.title", bodyKey: "tour.nav.body" },
      { key: "c", target: "missing", titleKey: "tour.nav.title", bodyKey: "tour.nav.body" },
    ];
    const result = filterVisibleSteps(steps, (t) => t === "present");
    expect(result.map((s) => s.key)).toEqual(["a", "b"]);
  });

  it("keeps the full real registry when every target is present", () => {
    const result = filterVisibleSteps(TOUR_STEPS, () => true);
    expect(result).toHaveLength(TOUR_STEPS.length);
  });

  it("on a narrow viewport (only welcome/done present) still keeps both centered steps", () => {
    const result = filterVisibleSteps(TOUR_STEPS, () => false);
    expect(result.map((s) => s.key)).toEqual(["welcome", "done"]);
  });
});

describe("computeTooltipPosition", () => {
  const viewport = { width: 1200, height: 800 };
  const card = { width: 320, height: 160 };

  it("centers when there is no target", () => {
    const pos = computeTooltipPosition(null, viewport, card);
    expect(pos).toEqual({
      top: (viewport.height - card.height) / 2,
      left: (viewport.width - card.width) / 2,
      placement: "center",
    });
  });

  it("places below the target when there is room", () => {
    const target = { top: 100, left: 500, width: 100, height: 40 };
    const pos = computeTooltipPosition(target, viewport, card);
    expect(pos.placement).toBe("below");
    expect(pos.top).toBe(target.top + target.height + TOOLTIP_MARGIN);
  });

  it("flips above when there is no room below", () => {
    const target = { top: 750, left: 500, width: 100, height: 40 };
    const pos = computeTooltipPosition(target, viewport, card);
    expect(pos.placement).toBe("above");
    expect(pos.top).toBe(target.top - card.height - TOOLTIP_MARGIN);
  });

  it("clamps horizontally so the card never overflows the right edge", () => {
    const target = { top: 100, left: 1150, width: 40, height: 40 };
    const pos = computeTooltipPosition(target, viewport, card);
    expect(pos.left).toBeLessThanOrEqual(viewport.width - card.width - TOOLTIP_MARGIN);
    expect(pos.left).toBeGreaterThanOrEqual(TOOLTIP_MARGIN);
  });

  it("clamps horizontally so the card never overflows the left edge", () => {
    const target = { top: 100, left: -20, width: 40, height: 40 };
    const pos = computeTooltipPosition(target, viewport, card);
    expect(pos.left).toBeGreaterThanOrEqual(TOOLTIP_MARGIN);
  });

  it("never returns a negative position even for a card larger than the viewport", () => {
    const target = { top: 10, left: 10, width: 20, height: 20 };
    const pos = computeTooltipPosition(target, { width: 300, height: 200 }, { width: 400, height: 400 });
    expect(pos.top).toBeGreaterThanOrEqual(0);
    expect(pos.left).toBeGreaterThanOrEqual(0);
  });
});
