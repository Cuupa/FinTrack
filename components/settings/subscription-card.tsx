"use client";

// Settings "Subscription" card (MONETIZATION.md section 3 "Settings UI"),
// flag-gated by `billing` (seeded disabled until webhooks go live) and
// registered-users-only: guests can't subscribe (checkout needs an account),
// and the "create an account to upgrade" teaser funnel is Phase 3, so the
// card simply doesn't render for them.
//
// Reads `useBilling()` (lib/billing/billing-context.tsx) for the row +
// loading state, and hits the redirect-based checkout/portal routes
// directly with the caller's own session bearer token, same pattern as
// account deletion in settings-view.tsx. No Stripe.js: a successful call
// just navigates the browser to the returned hosted-page URL.
//
// Uses `useSearchParams()` to read `?billing=success|cancelled` (the
// Checkout/portal return), which requires its own Suspense boundary — kept
// local to this component rather than in components/providers.tsx, which
// mounts far above any single route.

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth/auth-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { useBilling } from "@/lib/billing/billing-context";
import { subscriptionCardState } from "@/lib/billing/subscription-view";
import { useI18n } from "@/lib/i18n/i18n-context";
import { getSupabaseClient } from "@/lib/supabase/client";
import { Button, Card } from "@/components/ui/primitives";
import { SkeletonText } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import type { MessageKey } from "@/lib/i18n/dictionaries";

type PendingAction = "monthly" | "yearly" | "portal";

const STATUS_ERROR_KEYS: Partial<Record<number, MessageKey>> = {
  403: "settings.billing.errorDisabled",
  404: "settings.billing.errorNoSubscription",
  503: "settings.billing.errorUnavailable",
};

export function SubscriptionCard() {
  const { mode } = useAuth();
  const billingEnabled = useFeatureFlag("billing");
  if (mode !== "registered" || !billingEnabled) return null;
  return (
    <Suspense fallback={<SubscriptionCardSkeleton />}>
      <SubscriptionCardContent />
    </Suspense>
  );
}

function SubscriptionCardSkeleton() {
  return (
    <Card>
      <SkeletonText className="h-5 w-40" />
      <div className="mt-4 space-y-2">
        <SkeletonText className="h-4 w-24" />
        <SkeletonText className="h-3 w-48" />
      </div>
    </Card>
  );
}

function SubscriptionCardContent() {
  const { t } = useI18n();
  const searchParams = useSearchParams();
  const billingParam = searchParams.get("billing");
  const { plan, subscription, grants, loading } = useBilling();

  const [pending, setPending] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function redirectTo(
    path: string,
    action: PendingAction,
    body?: Record<string, unknown>,
  ) {
    const supabase = getSupabaseClient();
    if (!supabase) {
      setActionError(t("settings.billing.errorGeneric"));
      return;
    }
    setPending(action);
    setActionError(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setActionError(t("settings.billing.errorGeneric"));
        return;
      }
      const res = await fetch(path, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) {
        setActionError(t(STATUS_ERROR_KEYS[res.status] ?? "settings.billing.errorGeneric"));
        return;
      }
      const data = (await res.json().catch(() => null)) as { url?: string } | null;
      if (!data?.url) {
        setActionError(t("settings.billing.errorGeneric"));
        return;
      }
      window.location.href = data.url;
    } catch {
      setActionError(t("settings.billing.errorGeneric"));
    } finally {
      setPending(null);
    }
  }

  const upgrade = (interval: "monthly" | "yearly") =>
    void redirectTo("/api/billing/checkout", interval, { interval });
  const manage = () => void redirectTo("/api/billing/portal", "portal");

  const view = subscriptionCardState(plan, subscription, grants);

  return (
    <Card>
      <h2 className="text-base font-semibold">{t("settings.billing.title")}</h2>

      {loading ? (
        <div className="mt-4 space-y-2">
          <SkeletonText className="h-4 w-24" />
          <SkeletonText className="h-3 w-48" />
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {billingParam === "success" && (
            <p className="text-sm text-emerald-600 dark:text-emerald-400">
              {t("settings.billing.checkoutSuccess")}
            </p>
          )}
          {billingParam === "cancelled" && (
            <p className="text-sm text-zinc-500">{t("settings.billing.checkoutCancelled")}</p>
          )}

          <div>
            <p className="text-sm text-zinc-500">{t("settings.billing.currentPlan")}</p>
            <p className="text-base font-medium">
              {t(view.kind === "free" ? "settings.billing.planFree" : "settings.billing.planPro")}
            </p>
            {view.kind === "renewing" && (
              <p className="mt-1 text-sm text-zinc-500">
                {t("settings.billing.renewsOn", { date: formatDate(view.date) })}
              </p>
            )}
            {view.kind === "ending" && (
              <p className="mt-1 text-sm text-zinc-500">
                {t("settings.billing.endsOn", { date: formatDate(view.date) })}
              </p>
            )}
            {view.kind === "granted" && (
              <p className="mt-1 text-sm text-zinc-500">
                {view.date
                  ? t("settings.billing.grantedUntil", { date: formatDate(view.date) })
                  : t("settings.billing.granted")}
              </p>
            )}
          </div>

          {view.kind !== "granted" && (
            <div className="flex flex-wrap items-center gap-3">
              {view.kind === "free" ? (
                <>
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
                </>
              ) : (
                <Button variant="secondary" onClick={manage} disabled={pending !== null}>
                  {pending === "portal" ? "…" : t("settings.billing.manage")}
                </Button>
              )}
            </div>
          )}

          {actionError && <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}
        </div>
      )}
    </Card>
  );
}
