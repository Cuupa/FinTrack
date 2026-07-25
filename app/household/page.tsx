"use client";

import { HouseholdView } from "@/components/household/household-view";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import { Card } from "@/components/ui/primitives";
import { useAuth } from "@/lib/auth/auth-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";

export default function HouseholdPage() {
  const { t } = useI18n();
  const { mode } = useAuth();
  const enabled = useFeatureFlag("household");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("household.title")}</h1>
        <p className="text-sm text-zinc-500">{t("household.subtitle")}</p>
      </div>
      {!enabled ? (
        <FeatureUnavailable />
      ) : mode !== "registered" ? (
        <Card>
          <p className="text-sm text-zinc-500">{t("household.registeredOnly")}</p>
        </Card>
      ) : (
        <HouseholdView />
      )}
    </div>
  );
}
