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
  {
    // Sits right after the holdings so the tour tells the same story the page
    // now does: net worth, then everyday money, then investments.
    key: "areas",
    target: "areas",
    titleKey: "tour.areas.title",
    bodyKey: "tour.areas.body",
  },
  { key: "nav", target: "nav", titleKey: "tour.nav.title", bodyKey: "tour.nav.body" },
  {
    key: "themeToggle",
    target: "theme-toggle",
    titleKey: "tour.themeToggle.title",
    bodyKey: "tour.themeToggle.body",
  },
  {
    key: "privacy",
    target: "privacy-toggle",
    titleKey: "tour.privacy.title",
    bodyKey: "tour.privacy.body",
  },
  { key: "done", target: null, titleKey: "tour.done.title", bodyKey: "tour.done.body" },
];

// Page tours (round 21, ONBOARDING.md follow-up): the same spotlight
// mechanism as TOUR_STEPS above, one small registry per complicated view.
// Each is mounted by its page only once that page has something to show (see
// the call sites in components/onboarding/page-tours.tsx) — that natural
// "first visit with data" gate does the auto-start-once-with-data job, no
// extra flag needed here. Completion is tracked per tourId in
// `profile.toursDone`, separate from the dashboard tour's `tourDoneAt`.

/** Analysis -> Risk tab (components/analysis/risk-view.tsx). */
export const RISK_TOUR_STEPS: TourStep[] = [
  {
    key: "riskScope",
    target: "risk-scope",
    titleKey: "tour.risk.scope.title",
    bodyKey: "tour.risk.scope.body",
  },
  {
    key: "riskScore",
    target: "risk-kpis",
    titleKey: "tour.risk.score.title",
    bodyKey: "tour.risk.score.body",
  },
  {
    key: "riskMetrics",
    target: "risk-kpis",
    titleKey: "tour.risk.metrics.title",
    bodyKey: "tour.risk.metrics.body",
  },
  {
    key: "riskCorrelation",
    target: "risk-correlation",
    titleKey: "tour.risk.correlation.title",
    bodyKey: "tour.risk.correlation.body",
  },
];

/** Rebalancing (components/rebalancing/rebalancing-view.tsx). */
export const REBALANCING_TOUR_STEPS: TourStep[] = [
  {
    key: "rebalancingTargets",
    target: "rebalance-target-pct",
    titleKey: "tour.rebalancing.targets.title",
    bodyKey: "tour.rebalancing.targets.body",
  },
  {
    key: "rebalancingDrift",
    target: "rebalance-table",
    titleKey: "tour.rebalancing.drift.title",
    bodyKey: "tour.rebalancing.drift.body",
  },
  {
    key: "rebalancingOrders",
    target: "rebalance-orders",
    titleKey: "tour.rebalancing.orders.title",
    bodyKey: "tour.rebalancing.orders.body",
  },
];

/** Contracts register (components/contracts/contracts-view.tsx). Covers the
 *  three things that surface there and nowhere else: what kind of commitment
 *  a row is, whether it posts bookings, and where detected charges come from. */
export const CONTRACTS_TOUR_STEPS: TourStep[] = [
  {
    key: "contractsKind",
    target: "contract-kind",
    titleKey: "tour.contracts.kind.title",
    bodyKey: "tour.contracts.kind.body",
  },
  {
    key: "contractsBooking",
    target: "contract-account",
    titleKey: "tour.contracts.booking.title",
    bodyKey: "tour.contracts.booking.body",
  },
  {
    key: "contractsSuggestions",
    target: "contract-suggestions",
    titleKey: "tour.contracts.suggestions.title",
    bodyKey: "tour.contracts.suggestions.body",
  },
];

/** Monte Carlo simulation (components/simulation/monte-carlo-panel.tsx). */
export const SIMULATION_TOUR_STEPS: TourStep[] = [
  {
    key: "simulationAccumulation",
    target: "sim-accumulation",
    titleKey: "tour.simulation.accumulation.title",
    bodyKey: "tour.simulation.accumulation.body",
  },
  {
    key: "simulationWithdrawal",
    target: "sim-withdrawal",
    titleKey: "tour.simulation.withdrawal.title",
    bodyKey: "tour.simulation.withdrawal.body",
  },
  {
    key: "simulationModel",
    target: "sim-model",
    titleKey: "tour.simulation.model.title",
    bodyKey: "tour.simulation.model.body",
  },
  {
    key: "simulationChart",
    target: "sim-chart",
    titleKey: "tour.simulation.chart.title",
    bodyKey: "tour.simulation.chart.body",
  },
];

/** Asset detail tags section (components/assets/asset-tags.tsx). */
export const ASSET_TAGS_TOUR_STEPS: TourStep[] = [
  {
    key: "assetTagsWhat",
    target: "asset-tags",
    titleKey: "tour.assetTags.what.title",
    bodyKey: "tour.assetTags.what.body",
  },
  {
    key: "assetTagsAdd",
    target: "asset-tags-add",
    titleKey: "tour.assetTags.add.title",
    bodyKey: "tour.assetTags.add.body",
  },
  {
    key: "assetTagsAnalysis",
    target: null,
    titleKey: "tour.assetTags.analysis.title",
    bodyKey: "tour.assetTags.analysis.body",
  },
  {
    key: "assetTagsLocal",
    target: null,
    titleKey: "tour.assetTags.local.title",
    bodyKey: "tour.assetTags.local.body",
  },
];

// Round-24 page tours: every primary surface carries one, so the "?" next
// to its heading always has something to replay. Same shape as the tours
// above; the targets are the `data-tour` anchors on each view's cards.

/** Accounts & liabilities (/accounts, components/accounts/accounts-view.tsx). */
export const ACCOUNTS_TOUR_STEPS: TourStep[] = [
  {
    key: "accountsTotals",
    target: "accounts-totals",
    titleKey: "tour.accounts.totals.title",
    bodyKey: "tour.accounts.totals.body",
  },
  {
    key: "accountsForm",
    target: "accounts-form",
    titleKey: "tour.accounts.form.title",
    bodyKey: "tour.accounts.form.body",
  },
  {
    key: "accountsList",
    target: "accounts-list",
    titleKey: "tour.accounts.list.title",
    bodyKey: "tour.accounts.list.body",
  },
];

/** Spending ledger (/spending, components/spending/spending-view.tsx). */
export const SPENDING_TOUR_STEPS: TourStep[] = [
  {
    key: "spendingTotals",
    target: "spending-totals",
    titleKey: "tour.spending.totals.title",
    bodyKey: "tour.spending.totals.body",
  },
  {
    key: "spendingForm",
    target: "spending-form",
    titleKey: "tour.spending.form.title",
    bodyKey: "tour.spending.form.body",
  },
  {
    key: "spendingTable",
    target: "spending-table",
    titleKey: "tour.spending.table.title",
    bodyKey: "tour.spending.table.body",
  },
];

/** Goals (/goals, components/goals/goals-view.tsx). */
export const GOALS_TOUR_STEPS: TourStep[] = [
  {
    key: "goalsForm",
    target: "goals-form",
    titleKey: "tour.goals.form.title",
    bodyKey: "tour.goals.form.body",
  },
  {
    key: "goalsList",
    target: "goals-list",
    titleKey: "tour.goals.list.title",
    bodyKey: "tour.goals.list.body",
  },
];

/** Debt payoff (/debt, components/debt/debt-view.tsx). */
export const DEBT_TOUR_STEPS: TourStep[] = [
  {
    key: "debtTotals",
    target: "debt-totals",
    titleKey: "tour.debt.totals.title",
    bodyKey: "tour.debt.totals.body",
  },
  {
    key: "debtList",
    target: "debt-list",
    titleKey: "tour.debt.list.title",
    bodyKey: "tour.debt.list.body",
  },
  {
    key: "debtPlan",
    target: "debt-plan",
    titleKey: "tour.debt.plan.title",
    bodyKey: "tour.debt.plan.body",
  },
];

/** Financial health (/health, components/health/health-view.tsx). */
export const HEALTH_TOUR_STEPS: TourStep[] = [
  {
    key: "healthGauges",
    target: "health-gauges",
    titleKey: "tour.health.gauges.title",
    bodyKey: "tour.health.gauges.body",
  },
  {
    key: "healthSources",
    target: null,
    titleKey: "tour.health.sources.title",
    bodyKey: "tour.health.sources.body",
  },
];

/** FIRE planner (/fire, components/fire/fire-view.tsx). */
export const FIRE_TOUR_STEPS: TourStep[] = [
  {
    key: "fireInputs",
    target: "fire-inputs",
    titleKey: "tour.fire.inputs.title",
    bodyKey: "tour.fire.inputs.body",
  },
  {
    key: "fireTargets",
    target: "fire-targets",
    titleKey: "tour.fire.targets.title",
    bodyKey: "tour.fire.targets.body",
  },
  {
    key: "fireSimulation",
    target: "fire-simulation",
    titleKey: "tour.fire.simulation.title",
    bodyKey: "tour.fire.simulation.body",
  },
];

/** Household sharing (/household, components/household/household-view.tsx). */
export const HOUSEHOLD_TOUR_STEPS: TourStep[] = [
  {
    key: "householdCreate",
    target: "household-create",
    titleKey: "tour.household.create.title",
    bodyKey: "tour.household.create.body",
  },
  {
    key: "householdMembers",
    target: "household-members",
    titleKey: "tour.household.members.title",
    bodyKey: "tour.household.members.body",
  },
  {
    key: "householdInvite",
    target: "household-invite",
    titleKey: "tour.household.invite.title",
    bodyKey: "tour.household.invite.body",
  },
];

/** Dividends (/dividends, components/dividends/dividends-view.tsx). */
export const DIVIDENDS_TOUR_STEPS: TourStep[] = [
  {
    key: "dividendsKpis",
    target: "dividends-kpis",
    titleKey: "tour.dividends.kpis.title",
    bodyKey: "tour.dividends.kpis.body",
  },
  {
    key: "dividendsIncome",
    target: "dividends-income",
    titleKey: "tour.dividends.income.title",
    bodyKey: "tour.dividends.income.body",
  },
  {
    key: "dividendsUpcoming",
    target: "dividends-upcoming",
    titleKey: "tour.dividends.upcoming.title",
    bodyKey: "tour.dividends.upcoming.body",
  },
];

/** ETF look-through (/xray, components/xray/xray-view.tsx). */
export const XRAY_TOUR_STEPS: TourStep[] = [
  {
    key: "xrayTable",
    target: "xray-table",
    titleKey: "tour.xray.table.title",
    bodyKey: "tour.xray.table.body",
  },
  {
    key: "xrayLimits",
    target: null,
    titleKey: "tour.xray.limits.title",
    bodyKey: "tour.xray.limits.body",
  },
];

/** Analysis (/analysis) -- the tab bar, not any single tab; the risk tab keeps its own tour. */
export const ANALYSIS_TOUR_STEPS: TourStep[] = [
  {
    key: "analysisTabs",
    target: "analysis-tabs",
    titleKey: "tour.analysis.tabs.title",
    bodyKey: "tour.analysis.tabs.body",
  },
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
