"use client";

// The page tours (ONBOARDING.md follow-up): thin wrappers around the generic
// `TourOverlay` (./guided-tour.tsx), each keyed off its own slot in
// `profile.toursDone` (kept separate from the original dashboard tour's
// `tourDoneAt`).
//
// `PageTour` below is that wrapper, generic over the tour id and its steps —
// the round-21 tours (risk, rebalancing, contracts, simulation, asset tags)
// were five copies of it and are now aliases. A surface mounts its tour only
// once it has something to show, so "auto-start on first visit with data"
// falls out of ordinary conditional rendering, no extra "enabled" prop
// needed. That matters more than it looks: `TourOverlay` computes its visible
// step set once per mount, so mounting it while the page is still a skeleton
// would leave the tour permanently empty.
//
// Replay: each surface keeps a local `restartToken` counter (bumped by its
// "?" `TourReplayButton`) and passes it straight through as `restartToken`.
// Bumping it both remounts the overlay (fresh `key`, so `closed` resets) and
// sets `forceOpen`, so the tour reopens even though it's already `isDone`.
// `PageHeaderWithTour` packages that pairing for a whole page, which is why
// every primary surface can carry the "?" next to its heading.

import { useState, type ReactNode } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { PageHeader } from "@/components/ui/primitives";
import {
  ASSET_TAGS_TOUR_STEPS,
  REBALANCING_TOUR_STEPS,
  RISK_TOUR_STEPS,
  SIMULATION_TOUR_STEPS,
  type TourStep,
} from "@/lib/onboarding/tour-steps";
import { TourOverlay } from "./guided-tour";

interface PageTourProps {
  /** Bumped by the paired `TourReplayButton` to force a fresh, open mount. */
  restartToken?: number;
}

/**
 * A tour persisted in `profile.toursDone[tourId]`. Every page tour is this;
 * the named wrappers below only bind an id to its step registry.
 */
export function PageTour({
  tourId,
  steps,
  restartToken = 0,
}: PageTourProps & { tourId: string; steps: readonly TourStep[] }) {
  const { data, updateProfile } = usePortfolio();
  return (
    <TourOverlay
      key={restartToken}
      tourId={tourId}
      steps={steps}
      isDone={data.profile.toursDone[tourId] != null}
      markDone={() =>
        updateProfile({
          toursDone: { ...data.profile.toursDone, [tourId]: new Date().toISOString() },
        })
      }
      forceOpen={restartToken > 0}
    />
  );
}

export function RiskTour({ restartToken = 0 }: PageTourProps) {
  return <PageTour tourId="risk" steps={RISK_TOUR_STEPS} restartToken={restartToken} />;
}

export function RebalancingTour({ restartToken = 0 }: PageTourProps) {
  return (
    <PageTour tourId="rebalancing" steps={REBALANCING_TOUR_STEPS} restartToken={restartToken} />
  );
}

export function SimulationTour({ restartToken = 0 }: PageTourProps) {
  return <PageTour tourId="simulation" steps={SIMULATION_TOUR_STEPS} restartToken={restartToken} />;
}

export function AssetTagsTour({ restartToken = 0 }: PageTourProps) {
  return <PageTour tourId="assetTags" steps={ASSET_TAGS_TOUR_STEPS} restartToken={restartToken} />;
}

/** Small ghost "?" affordance placed near a page/section heading that
 *  restarts that page's tour on demand (bumps the paired `*Tour`'s
 *  `restartToken`). No badge, matches the app's no-badge rule. */
export function TourReplayButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={t("tour.replay")}
      title={t("tour.replay")}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
    >
      ?
    </button>
  );
}

/**
 * A page heading that carries its own tour: the "?" sits right after the
 * title (`PageHeader`'s `titleAdornment` slot) and restarts the tour, exactly
 * like the dashboard's.
 *
 * `ready` is the page's own "my content is on screen" condition (loaded, not
 * errored, not locked behind the paywall). Both the tour and the "?" wait for
 * it, because a tour mounted over a skeleton finds none of its `data-tour`
 * targets and would stay empty for the rest of that mount.
 */
export function PageHeaderWithTour({
  title,
  subtitle,
  tourId,
  steps,
  ready = true,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  tourId: string;
  steps: readonly TourStep[];
  ready?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  const [restartToken, setRestartToken] = useState(0);
  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={actions}
        titleAdornment={
          ready ? <TourReplayButton onClick={() => setRestartToken((n) => n + 1)} /> : undefined
        }
      >
        {children}
      </PageHeader>
      {ready && <PageTour tourId={tourId} steps={steps} restartToken={restartToken} />}
    </>
  );
}
