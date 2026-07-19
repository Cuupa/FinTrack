"use client";

// Marketing pricing page (MONETIZATION.md Phase 3): a Free vs Pro plan
// comparison, entirely gated behind the `billing` flag (dark-launched, off
// in prod) via useFeatureFlag -- same FeatureUnavailable degrade as any
// other flag-gated route (a direct visit while billing is off shows the
// standard "not available" placeholder rather than a half-built page).
//
// Display prices come from the owner-editable `billing_config` row
// (lib/billing/use-billing-config.ts, config-in-DB, never hardcoded), with
// skeleton placeholders while loading; when a price is missing the column
// simply omits it rather than inventing a number. The CTA reuses the same
// redirect-based checkout call as the settings Subscription card
// (lib/billing/checkout-client.ts): registered users go straight to
// Checkout, guests get a link to /login, an already-Pro user gets a link to
// manage their subscription instead of a second checkout, and the buy
// button disappears entirely (comparison-only) when the owner's selling
// toggle (`billing_config.enabled`, independent of the `billing` flag
// itself) is off. `<ProTeaser>` links its upgrade CTA here instead of
// /settings#subscription now that this page exists (MONETIZATION.md:
// "Locked teasers deep-link here").

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/auth-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { usePlan } from "@/lib/billing/use-plan";
import { useBillingConfig } from "@/lib/billing/use-billing-config";
import { redirectToBilling, type BillingRedirectErrorKind } from "@/lib/billing/checkout-client";
import { useI18n } from "@/lib/i18n/i18n-context";
import { Button, Card } from "@/components/ui/primitives";
import { Skeleton, SkeletonText } from "@/components/ui/skeleton";
import { FeatureUnavailable } from "@/components/feature-unavailable";
import type { MessageKey } from "@/lib/i18n/dictionaries";

const FREE_FEATURES: readonly MessageKey[] = [
  "pricing.free.feature1",
  "pricing.free.feature2",
  "pricing.free.feature3",
];

const PRO_FEATURES: readonly MessageKey[] = [
  "pricing.pro.feature1",
  "pricing.pro.feature2",
  "pricing.pro.feature3",
  "pricing.pro.feature4",
  "pricing.pro.feature5",
  "pricing.pro.feature6",
];

const ERROR_KIND_KEYS: Record<BillingRedirectErrorKind, MessageKey> = {
  generic: "settings.billing.errorGeneric",
  disabled: "settings.billing.errorDisabled",
  noSubscription: "settings.billing.errorNoSubscription",
  unavailable: "settings.billing.errorUnavailable",
};

function FeatureList({ keys }: { keys: readonly MessageKey[] }) {
  const { t } = useI18n();
  return (
    <ul className="mt-4 space-y-2 text-sm text-zinc-600 dark:text-zinc-300">
      {keys.map((key) => (
        <li key={key} className="flex items-start gap-2">
          <span aria-hidden="true" className="text-emerald-600 dark:text-emerald-400">
            &#10003;
          </span>
          <span>{t(key)}</span>
        </li>
      ))}
    </ul>
  );
}

export default function PricingPage() {
  const { t } = useI18n();
  const billingEnabled = useFeatureFlag("billing");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t("pricing.title")}</h1>
        <p className="text-sm text-zinc-500">{t("pricing.subtitle")}</p>
      </div>
      {billingEnabled ? <PricingPlans /> : <FeatureUnavailable />}
    </div>
  );
}

function PricingPlans() {
  const { t } = useI18n();
  const { mode } = useAuth();
  const plan = usePlan();
  const { config, loading } = useBillingConfig();

  const [pending, setPending] = useState<"monthly" | "yearly" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sellingEnabled = config?.enabled === true;
  const hasDisplayPrice = Boolean(config?.priceMonthlyDisplay || config?.priceYearlyDisplay);

  async function upgrade(interval: "monthly" | "yearly") {
    setPending(interval);
    setError(null);
    const errorKind = await redirectToBilling("/api/billing/checkout", { interval });
    if (errorKind) setError(t(ERROR_KIND_KEYS[errorKind]));
    setPending(null);
  }

  return (
    <div className="grid max-w-3xl gap-6 sm:grid-cols-2">
      <Card>
        <h2 className="text-lg font-semibold">{t("pricing.free.name")}</h2>
        <p className="mt-1 text-sm text-zinc-500">{t("pricing.free.tagline")}</p>
        <FeatureList keys={FREE_FEATURES} />
      </Card>

      <Card>
        <h2 className="text-lg font-semibold">{t("pricing.pro.name")}</h2>
        <p className="mt-1 text-sm text-zinc-500">{t("pricing.pro.tagline")}</p>

        <div className="mt-3 min-h-[2.5rem]">
          {loading ? (
            <div className="space-y-1.5">
              <SkeletonText className="h-6 w-28" />
              <SkeletonText className="h-4 w-24" />
            </div>
          ) : hasDisplayPrice ? (
            <div className="space-y-0.5">
              {config?.priceMonthlyDisplay && (
                <p className="text-xl font-semibold">
                  {t("pricing.pro.perMonth", { price: config.priceMonthlyDisplay })}
                </p>
              )}
              {config?.priceYearlyDisplay && (
                <p className="text-sm text-zinc-500">
                  {t("pricing.pro.perYear", { price: config.priceYearlyDisplay })}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-zinc-500">{t("pricing.pro.pricesPending")}</p>
          )}
        </div>

        <FeatureList keys={PRO_FEATURES} />

        <div className="mt-5">
          {loading ? (
            <Skeleton className="h-10 w-full max-w-xs" />
          ) : plan === "pro" ? (
            <div className="space-y-2">
              <p className="text-sm text-zinc-500">{t("pricing.pro.alreadyPro")}</p>
              <Link href="/settings#subscription">
                <Button variant="secondary">{t("settings.billing.manage")}</Button>
              </Link>
            </div>
          ) : !sellingEnabled ? (
            <p className="text-sm text-zinc-500">{t("pricing.pro.notAvailable")}</p>
          ) : mode === "registered" ? (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="primary"
                onClick={() => upgrade("monthly")}
                disabled={pending !== null}
              >
                {pending === "monthly" ? "…" : t("settings.billing.upgradeMonthly")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => upgrade("yearly")}
                disabled={pending !== null}
              >
                {pending === "yearly" ? "…" : t("settings.billing.upgradeYearly")}
              </Button>
            </div>
          ) : (
            <Link href="/login">
              <Button variant="primary">{t("pricing.guestCta")}</Button>
            </Link>
          )}
        </div>

        {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}
      </Card>
    </div>
  );
}
