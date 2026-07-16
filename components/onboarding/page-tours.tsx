"use client";

// The four round-21 page tours (ONBOARDING.md follow-up): thin wrappers
// around the generic `TourOverlay` (./guided-tour.tsx), each keyed off its
// own slot in `profile.toursDone` (kept separate from the original dashboard
// tour's `tourDoneAt`). A page mounts its tour only once it has something to
// show — e.g. `{holdings.length > 0 && <RiskTour ... />}` — so "auto-start on
// first visit with data" falls out of ordinary conditional rendering, no
// extra "enabled" prop needed.
//
// Replay: each surface keeps a local `restartToken` counter (bumped by its
// "?" `TourReplayButton`) and passes it straight through as `restartToken`.
// Bumping it both remounts the overlay (fresh `key`, so `closed` resets) and
// sets `forceOpen`, so the tour reopens even though it's already `isDone`.

import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import {
  ASSET_TAGS_TOUR_STEPS,
  REBALANCING_TOUR_STEPS,
  RISK_TOUR_STEPS,
  SIMULATION_TOUR_STEPS,
} from "@/lib/onboarding/tour-steps";
import { TourOverlay } from "./guided-tour";

interface PageTourProps {
  /** Bumped by the paired `TourReplayButton` to force a fresh, open mount. */
  restartToken?: number;
}

export function RiskTour({ restartToken = 0 }: PageTourProps) {
  const { data, updateProfile } = usePortfolio();
  return (
    <TourOverlay
      key={restartToken}
      tourId="risk"
      steps={RISK_TOUR_STEPS}
      isDone={data.profile.toursDone.risk != null}
      markDone={() =>
        updateProfile({ toursDone: { ...data.profile.toursDone, risk: new Date().toISOString() } })
      }
      forceOpen={restartToken > 0}
    />
  );
}

export function RebalancingTour({ restartToken = 0 }: PageTourProps) {
  const { data, updateProfile } = usePortfolio();
  return (
    <TourOverlay
      key={restartToken}
      tourId="rebalancing"
      steps={REBALANCING_TOUR_STEPS}
      isDone={data.profile.toursDone.rebalancing != null}
      markDone={() =>
        updateProfile({
          toursDone: { ...data.profile.toursDone, rebalancing: new Date().toISOString() },
        })
      }
      forceOpen={restartToken > 0}
    />
  );
}

export function SimulationTour({ restartToken = 0 }: PageTourProps) {
  const { data, updateProfile } = usePortfolio();
  return (
    <TourOverlay
      key={restartToken}
      tourId="simulation"
      steps={SIMULATION_TOUR_STEPS}
      isDone={data.profile.toursDone.simulation != null}
      markDone={() =>
        updateProfile({
          toursDone: { ...data.profile.toursDone, simulation: new Date().toISOString() },
        })
      }
      forceOpen={restartToken > 0}
    />
  );
}

export function AssetTagsTour({ restartToken = 0 }: PageTourProps) {
  const { data, updateProfile } = usePortfolio();
  return (
    <TourOverlay
      key={restartToken}
      tourId="assetTags"
      steps={ASSET_TAGS_TOUR_STEPS}
      isDone={data.profile.toursDone.assetTags != null}
      markDone={() =>
        updateProfile({
          toursDone: { ...data.profile.toursDone, assetTags: new Date().toISOString() },
        })
      }
      forceOpen={restartToken > 0}
    />
  );
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
