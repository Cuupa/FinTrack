"use client";

// Retirement, one page (TODO "FIRE/Rente"): what you have built yourself and
// what you are entitled to, as two tabs of the same question rather than two
// nav entries competing to answer it.
//
// The two halves keep their own flags. Either can be off or Pro-locked on its
// own, so the tab strip is built from whatever is actually enabled and each
// panel gates itself -- a locked tab stays selectable and shows its teaser,
// per the owner rule that a paywall is visible.
//
// Tab state mirrors `?tab=` exactly like /analysis: state -> URL, never back,
// so the redirects from the old /fire and /pension routes can land a bookmark
// on the half it was pointing at.

import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { FireView } from "@/components/fire/fire-view";
import { FireSkeleton } from "@/components/fire/fire-skeleton";
import { PensionView } from "@/components/pension/pension-view";
import { PensionSkeleton } from "@/components/pension/pension-skeleton";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { ProTeaser } from "@/components/billing/pro-teaser";
import { LoadError } from "@/components/ui/load-error";
import { Tabs } from "@/components/ui/tabs";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useFeature } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { PageHeaderWithTour } from "@/components/onboarding/page-tours";
import { FIRE_TOUR_STEPS, PENSION_TOUR_STEPS } from "@/lib/onboarding/tour-steps";

type TabKey = "fire" | "pension";

export default function RetirementPage() {
  // useSearchParams requires a Suspense boundary for prerendering.
  return (
    <Suspense fallback={null}>
      <RetirementPageInner />
    </Suspense>
  );
}

function RetirementPageInner() {
  const { t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { loading, loadError, reload } = usePortfolio();

  const fire = useFeature("firePlanner");
  const pension = useFeature("pension");

  const available: TabKey[] = [
    ...(fire.enabled ? (["fire"] as const) : []),
    ...(pension.enabled ? (["pension"] as const) : []),
  ];

  const requested = searchParams.get("tab");
  const initialTab = available.find((key) => key === requested) ?? available[0] ?? "fire";
  const [tab, setTab] = useState<TabKey>(initialTab);
  // Falls back if the flag behind the selected tab turned off underneath it
  // (a per-user override changing live), rather than rendering an empty panel.
  const activeTab = available.includes(tab) ? tab : (available[0] ?? "fire");

  const selectTab = (key: TabKey) => {
    setTab(key);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", key);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const active = activeTab === "fire" ? fire : pension;
  const ready = available.length > 0 && !active.locked && !loading && !loadError;

  return (
    <div className="space-y-6">
      {/* Keyed on the tab: `TourOverlay` resolves its steps once per mount, so
          a tour swapped in place would look for the other panel's targets. */}
      <PageHeaderWithTour
        key={activeTab}
        title={t("retirement.title")}
        subtitle={t(activeTab === "fire" ? "fire.subtitle" : "pension.subtitle")}
        tourId={activeTab}
        steps={activeTab === "fire" ? FIRE_TOUR_STEPS : PENSION_TOUR_STEPS}
        ready={ready}
      />

      {available.length === 0 ? (
        <FeatureUnavailable />
      ) : (
        <>
          {available.length > 1 && (
            <Tabs
              value={activeTab}
              onChange={selectTab}
              items={available.map((key) => ({
                value: key,
                label: t(key === "fire" ? "retirement.tab.fire" : "retirement.tab.pension"),
                locked: key === "fire" ? fire.locked : pension.locked,
              }))}
            />
          )}

          {loading ? (
            activeTab === "fire" ? (
              <FireSkeleton />
            ) : (
              <PensionSkeleton />
            )
          ) : loadError ? (
            <LoadError onRetry={reload} />
          ) : activeTab === "fire" ? (
            fire.locked ? (
              <ProTeaser feature="firePlanner">
                <FireView />
              </ProTeaser>
            ) : (
              <FireView />
            )
          ) : pension.locked ? (
            <ProTeaser feature="pension">
              <PensionView />
            </ProTeaser>
          ) : (
            <PensionView />
          )}
        </>
      )}
    </div>
  );
}
