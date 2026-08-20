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
  /** When the target lives on a tabbed view, the tab value to activate before
   *  the step is shown. The page threads an `onActivateTab` handler and its
   *  `availableTabs`; the step survives mount-time filtering as long as that
   *  tab exists (a flag-off tab is absent, so its steps still drop out). */
  activateTab?: string;
}

// Order mirrors the table in ONBOARDING.md "Phase 1: guided tour" exactly.
export const TOUR_STEPS: TourStep[] = [
  { key: "welcome", target: null, titleKey: "tour.welcome.title", bodyKey: "tour.welcome.body" },
  {
    key: "netWorth",
    target: "net-worth",
    titleKey: "tour.netWorth.title",
    bodyKey: "tour.netWorth.body",
  },
  {
    // Sits right after net worth so the tour tells the same story the page
    // now does: net worth, then everyday money, then investments.
    key: "areas",
    target: "areas",
    titleKey: "tour.areas.title",
    bodyKey: "tour.areas.body",
  },
  { key: "nav", target: "nav", titleKey: "tour.nav.title", bodyKey: "tour.nav.body" },
  // One step per navigation group (targets set in components/sidebar.tsx). The
  // groups carry the product's mental model, so the tour has to say what each
  // one holds -- "more to explore" alone left the user to guess. Dropped
  // automatically by filterVisibleSteps wherever the sidebar is hidden (narrow
  // viewport) or a group's routes are all flagged off.
  {
    key: "navEveryday",
    target: "nav-group-everyday",
    titleKey: "tour.nav.everyday.title",
    bodyKey: "tour.nav.everyday.body",
  },
  {
    key: "navInvest",
    target: "nav-group-invest",
    titleKey: "tour.nav.invest.title",
    bodyKey: "tour.nav.invest.body",
  },
  {
    key: "navPlan",
    target: "nav-group-plan",
    titleKey: "tour.nav.plan.title",
    bodyKey: "tour.nav.plan.body",
  },
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

/** Investments (/portfolio, app/portfolio/page.tsx). */
// Positions, savings plans and the watchlist each sit on their own tab now,
// so every step names the tab the tour must activate before spotlighting it.
export const PORTFOLIO_TOUR_STEPS: TourStep[] = [
  {
    key: "portfolioAddAsset",
    target: "add-asset",
    activateTab: "positions",
    titleKey: "tour.portfolio.addAsset.title",
    bodyKey: "tour.portfolio.addAsset.body",
  },
  {
    key: "portfolioHoldings",
    target: "holdings",
    activateTab: "positions",
    titleKey: "tour.portfolio.holdings.title",
    bodyKey: "tour.portfolio.holdings.body",
  },
  {
    key: "portfolioSavingsPlans",
    target: "savings-plans",
    activateTab: "savings",
    titleKey: "tour.portfolio.savingsPlans.title",
    bodyKey: "tour.portfolio.savingsPlans.body",
  },
  {
    key: "portfolioWatchlist",
    target: "watchlist",
    activateTab: "watchlist",
    titleKey: "tour.portfolio.watchlist.title",
    bodyKey: "tour.portfolio.watchlist.body",
  },
];

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
    key: "simulationStrategy",
    target: "withdrawal-strategy",
    titleKey: "tour.simulation.strategy.title",
    bodyKey: "tour.simulation.strategy.body",
  },
  {
    key: "simulationModel",
    target: "sim-model",
    titleKey: "tour.simulation.model.title",
    bodyKey: "tour.simulation.model.body",
  },
  {
    key: "simulationStress",
    target: "stress-scenario",
    titleKey: "tour.simulation.stress.title",
    bodyKey: "tour.simulation.stress.body",
  },
  {
    key: "simulationComparison",
    target: "withdrawal-comparison",
    titleKey: "tour.simulation.comparison.title",
    bodyKey: "tour.simulation.comparison.body",
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
// /spending merged into this page as tabs (round 28), so its tour merged too:
// accounts sit on the first tab, bookings and recurring charges on their own.
// Each step names the tab to activate; a bookings/recurring step drops when
// the `spending` flag is off (that tab is absent from `availableTabs`).
export const ACCOUNTS_TOUR_STEPS: TourStep[] = [
  {
    key: "accountsTotals",
    target: "accounts-totals",
    activateTab: "accounts",
    titleKey: "tour.accounts.totals.title",
    bodyKey: "tour.accounts.totals.body",
  },
  {
    key: "accountsForm",
    // The form moved into a modal behind this button, so the tour points at
    // the button: a target inside a closed dialog is not on screen.
    target: "add-account",
    activateTab: "accounts",
    titleKey: "tour.accounts.form.title",
    bodyKey: "tour.accounts.form.body",
  },
  {
    key: "accountsList",
    target: "accounts-list",
    activateTab: "accounts",
    titleKey: "tour.accounts.list.title",
    bodyKey: "tour.accounts.list.body",
  },
  {
    key: "spendingForm",
    target: "spending-form",
    activateTab: "bookings",
    titleKey: "tour.spending.form.title",
    bodyKey: "tour.spending.form.body",
  },
  // On a page with no detected charges (or a collapsed RecurringCard, whose
  // state persists per browser) the anchor never mounts even after its tab
  // activates; the card then centers, the same fallback a target that vanishes
  // mid-tour already uses.
  {
    key: "spendingRecurring",
    target: "recurring-suggestions",
    activateTab: "recurring",
    titleKey: "tour.contracts.suggestions.title",
    bodyKey: "tour.contracts.suggestions.body",
  },
  {
    key: "spendingTable",
    target: "spending-table",
    activateTab: "bookings",
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

/** Pension (/retirement pension tab, components/pension/pension-view.tsx). */
export const PENSION_TOUR_STEPS: TourStep[] = [
  {
    key: "pensionSummary",
    target: "pension-summary",
    titleKey: "tour.pension.summary.title",
    bodyKey: "tour.pension.summary.body",
  },
  {
    key: "pensionAssumptions",
    target: "pension-assumptions",
    titleKey: "tour.pension.assumptions.title",
    bodyKey: "tour.pension.assumptions.body",
  },
  {
    key: "pensionPoints",
    target: "pension-points",
    titleKey: "tour.pension.points.title",
    bodyKey: "tour.pension.points.body",
  },
  {
    key: "pensionContracts",
    target: "pension-contracts",
    titleKey: "tour.pension.contracts.title",
    bodyKey: "tour.pension.contracts.body",
  },
];

// Order mirrors the DOM: debt-chart is nested inside the debt-plan card.
export const DEBT_TOUR_STEPS: TourStep[] = [
  {
    key: "debtTotals",
    target: "debt-totals",
    titleKey: "tour.debt.totals.title",
    bodyKey: "tour.debt.totals.body",
  },
  {
    key: "debtPlan",
    target: "debt-plan",
    titleKey: "tour.debt.plan.title",
    bodyKey: "tour.debt.plan.body",
  },
  {
    key: "debtChart",
    target: "debt-chart",
    titleKey: "tour.debt.chart.title",
    bodyKey: "tour.debt.chart.body",
  },
  {
    key: "debtList",
    target: "debt-list",
    titleKey: "tour.debt.list.title",
    bodyKey: "tour.debt.list.body",
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
  hasTab?: (tab: string) => boolean,
): TourStep[] {
  return steps.filter((s) => {
    if (s.target === null) return true;
    // A step whose target sits on another tab is kept as long as that tab
    // exists: its anchor mounts once the tour activates the tab. Without a
    // tab predicate (a tour with no tabs) fall back to on-screen presence.
    if (s.activateTab != null && hasTab) return hasTab(s.activateTab);
    return hasTarget(s.target);
  });
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
