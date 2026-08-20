// Pure helpers behind the guided tour (lib/onboarding/tour-steps.ts):
// step filtering (targets that vanish from the DOM, e.g. a narrow viewport
// hiding the sidebar) and tooltip placement geometry (below/above flip,
// viewport clamping). No DOM/React involved, so these are plain unit tests.

import { describe, expect, it } from "vitest";
import {
  ACCOUNTS_TOUR_STEPS,
  ASSET_TAGS_TOUR_STEPS,
  computeTooltipPosition,
  filterVisibleSteps,
  PORTFOLIO_TOUR_STEPS,
  REBALANCING_TOUR_STEPS,
  RISK_TOUR_STEPS,
  SIMULATION_TOUR_STEPS,
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

  it("keeps a step whose target sits on an inactive tab, as long as the tab exists", () => {
    const steps: TourStep[] = [
      // On the active tab: resolvable now.
      { key: "here", target: "on-tab-a", activateTab: "a", titleKey: "tour.nav.title", bodyKey: "tour.nav.body" },
      // On another tab: not on screen yet, but its tab is available.
      { key: "there", target: "on-tab-b", activateTab: "b", titleKey: "tour.nav.title", bodyKey: "tour.nav.body" },
    ];
    // Only tab a's anchor is in the DOM right now; both tabs exist.
    const result = filterVisibleSteps(
      steps,
      (t) => t === "on-tab-a",
      (tab) => ["a", "b"].includes(tab),
    );
    expect(result.map((s) => s.key)).toEqual(["here", "there"]);
  });

  it("drops a tab step whose tab is absent (e.g. a flag-off tab)", () => {
    const steps: TourStep[] = [
      { key: "keep", target: "on-tab-a", activateTab: "a", titleKey: "tour.nav.title", bodyKey: "tour.nav.body" },
      { key: "gone", target: "on-tab-b", activateTab: "b", titleKey: "tour.nav.title", bodyKey: "tour.nav.body" },
    ];
    // Tab b does not exist (its feature flag is off), so its step drops even
    // though a tab predicate is supplied.
    const result = filterVisibleSteps(
      steps,
      () => false,
      (tab) => tab === "a",
    );
    expect(result.map((s) => s.key)).toEqual(["keep"]);
  });

  it("without a tab predicate, a tab step falls back to on-screen presence", () => {
    const steps: TourStep[] = [
      { key: "x", target: "present", activateTab: "a", titleKey: "tour.nav.title", bodyKey: "tour.nav.body" },
      { key: "y", target: "missing", activateTab: "b", titleKey: "tour.nav.title", bodyKey: "tour.nav.body" },
    ];
    const result = filterVisibleSteps(steps, (t) => t === "present");
    expect(result.map((s) => s.key)).toEqual(["x"]);
  });

  it("the portfolio and accounts registries tag every targeted step with its tab", () => {
    for (const step of [...PORTFOLIO_TOUR_STEPS, ...ACCOUNTS_TOUR_STEPS]) {
      expect(step.activateTab).toBeTruthy();
    }
  });
});

describe("page tour registries (risk, rebalancing, simulation, assetTags)", () => {
  const registries: [string, TourStep[], number][] = [
    ["RISK_TOUR_STEPS", RISK_TOUR_STEPS, 4],
    ["REBALANCING_TOUR_STEPS", REBALANCING_TOUR_STEPS, 3],
    ["SIMULATION_TOUR_STEPS", SIMULATION_TOUR_STEPS, 7],
    ["ASSET_TAGS_TOUR_STEPS", ASSET_TAGS_TOUR_STEPS, 4],
  ];

  it.each(registries)("%s has the expected step count and unique keys", (_name, steps, count) => {
    expect(steps).toHaveLength(count);
    expect(new Set(steps.map((s) => s.key)).size).toBe(steps.length);
  });

  it.each(registries)("%s: every step has a non-empty title/body key", (_name, steps) => {
    for (const s of steps) {
      expect(s.titleKey.length).toBeGreaterThan(0);
      expect(s.bodyKey.length).toBeGreaterThan(0);
    }
  });

  it("RISK_TOUR_STEPS follows scope -> score -> metrics -> correlation", () => {
    expect(RISK_TOUR_STEPS.map((s) => s.key)).toEqual([
      "riskScope",
      "riskScore",
      "riskMetrics",
      "riskCorrelation",
    ]);
  });

  it("REBALANCING_TOUR_STEPS follows targets -> drift -> orders", () => {
    expect(REBALANCING_TOUR_STEPS.map((s) => s.key)).toEqual([
      "rebalancingTargets",
      "rebalancingDrift",
      "rebalancingOrders",
    ]);
  });

  it("SIMULATION_TOUR_STEPS follows accumulation -> withdrawal -> strategy -> model -> stress -> comparison -> chart", () => {
    expect(SIMULATION_TOUR_STEPS.map((s) => s.key)).toEqual([
      "simulationAccumulation",
      "simulationWithdrawal",
      "simulationStrategy",
      "simulationModel",
      "simulationStress",
      "simulationComparison",
      "simulationChart",
    ]);
  });

  it("ASSET_TAGS_TOUR_STEPS follows what -> add -> analysis -> local, with the last two centered", () => {
    expect(ASSET_TAGS_TOUR_STEPS.map((s) => s.key)).toEqual([
      "assetTagsWhat",
      "assetTagsAdd",
      "assetTagsAnalysis",
      "assetTagsLocal",
    ]);
    expect(ASSET_TAGS_TOUR_STEPS[2].target).toBeNull();
    expect(ASSET_TAGS_TOUR_STEPS[3].target).toBeNull();
  });

  it.each(registries)("%s: keeps every step when every target is present", (_name, steps) => {
    expect(filterVisibleSteps(steps, () => true)).toHaveLength(steps.length);
  });

  it("ASSET_TAGS_TOUR_STEPS keeps the two centered steps even with no DOM targets present", () => {
    const result = filterVisibleSteps(ASSET_TAGS_TOUR_STEPS, () => false);
    expect(result.map((s) => s.key)).toEqual(["assetTagsAnalysis", "assetTagsLocal"]);
  });

  it("RISK_TOUR_STEPS drops all steps (none centered) when no DOM targets are present", () => {
    expect(filterVisibleSteps(RISK_TOUR_STEPS, () => false)).toEqual([]);
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
