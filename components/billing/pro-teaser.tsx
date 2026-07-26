"use client";

// Shown in place of — or on top of — a locked feature's content
// (MONETIZATION.md Phase 3). A feature is "locked" when its flag is enabled
// but `feature_flags.required_plan = 'pro'` and the signed-in user's plan is
// free (`useFeature`, lib/flags/flags-context.tsx) -- distinct from a flag
// that is off outright, which stays hidden via `FeatureUnavailable` /
// `useFeatureFlag`. As of this component landing every flag is still seeded
// 'free' (Phase 2 dark launch), so this never actually renders in prod until
// the owner re-tiers a flag to 'pro' on /admin/flags.
//
// Two modes:
//  - With `children` (the real feature UI): render it blurred + inert as a
//    preview behind a centered paywall message, so the user sees what Pro
//    unlocks rather than a blank card.
//  - Without children: the standalone centered empty-state card (mirrors
//    `FeatureUnavailable`'s shape) — kept for surfaces that can't cheaply
//    render a real preview.
//
// The upgrade link only renders when the `billing` flag itself is on: with
// billing off, checkout is impossible, so the message explains the feature is
// Pro without a dead-end call to action. Links to /pricing (MONETIZATION.md:
// "Locked teasers deep-link here"), the marketing plan comparison shipped in
// Phase 3 -- not directly to checkout, since the visitor may be a guest or
// want to compare plans first.

import type { ReactNode } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/primitives";
import { useFeatureFlag, type FeatureFlag } from "@/lib/flags/flags-context";
import { useI18n } from "@/lib/i18n/i18n-context";

/** The padlock, shared with the navigation so a locked entry and its teaser
    read as the same thing. Stroke-only, inherits the surrounding color. */
export function LockIcon({ className = "h-8 w-8 text-zinc-400" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="9" rx="1.5" />
      <path d="M8 11V7.5a4 4 0 0 1 8 0V11" />
    </svg>
  );
}

function LockPitch() {
  const { t } = useI18n();
  const billingEnabled = useFeatureFlag("billing");
  return (
    <div className="flex flex-col items-center gap-2 text-center text-zinc-500">
      <LockIcon />
      <p className="font-medium text-zinc-700 dark:text-zinc-300">{t("common.proFeature")}</p>
      <p className="max-w-xs text-sm">{t("common.proFeatureHint")}</p>
      {billingEnabled && (
        <Link
          href="/pricing"
          className="mt-2 inline-flex items-center justify-center gap-2 rounded-md bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {t("common.proFeatureUpgrade")}
        </Link>
      )}
    </div>
  );
}

/**
 * A Pro-locked entry inside a dropdown menu. A blurred preview makes no sense
 * for a single menu row, so the row stays listed with a padlock and links to
 * /pricing — visible, self-explanatory, and never silently missing. With the
 * `billing` flag off there is nowhere to upgrade, so it renders inert.
 */
export function ProMenuItem({ label, className = "" }: { label: string; className?: string }) {
  const { t } = useI18n();
  const billingEnabled = useFeatureFlag("billing");
  const base = `flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-zinc-500 ${className}`;
  const body = (
    <>
      <span className="flex-1 truncate">{label}</span>
      <LockIcon className="h-4 w-4 shrink-0 text-zinc-400" />
    </>
  );
  if (!billingEnabled) {
    return (
      <div className={base} title={t("common.proFeature")}>
        {body}
      </div>
    );
  }
  return (
    <Link
      href="/pricing"
      className={`${base} hover:bg-zinc-100 dark:hover:bg-zinc-800`}
      title={t("common.proFeature")}
    >
      {body}
    </Link>
  );
}

/**
 * Conditional wrapper: renders `children` untouched, or blurred behind the
 * paywall when `locked`. Sub-surfaces (a tab panel, one section of a form,
 * one card inside a page) gate this way instead of repeating the ternary —
 * the duplication that let several surfaces silently HIDE a Pro feature
 * instead of teasing it.
 */
export function ProGate({
  locked,
  feature,
  children,
  className,
}: {
  locked: boolean;
  feature: FeatureFlag;
  children: ReactNode;
  className?: string;
}) {
  if (!locked) return <>{children}</>;
  return (
    <ProTeaser feature={feature} className={className}>
      {children}
    </ProTeaser>
  );
}

export function ProTeaser({
  feature,
  children,
  className = "",
}: {
  /** The locked flag; not shown today (copy is generic) but keeps the
   *  surface addressable for a future per-feature pitch and for tests. */
  feature: FeatureFlag;
  /** The real feature UI to preview blurred behind the paywall message. */
  children?: ReactNode;
  className?: string;
}) {
  // Preview mode: real content blurred + inert underneath the paywall message.
  if (children) {
    return (
      <div className={`relative ${className}`} data-locked-feature={feature}>
        {/* The preview is clipped to roughly a screenful: a locked full page
            is often far taller than the viewport, and letting it run at full
            height would park the paywall message a thousand pixels below the
            fold with nothing but blur visible on arrival. */}
        <div
          className="pointer-events-none max-h-[70vh] select-none overflow-hidden blur-[5px] opacity-60"
          aria-hidden="true"
          inert
        >
          {children}
        </div>
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div className="max-w-sm rounded-xl border border-zinc-200 bg-white/85 px-6 py-8 shadow-lg backdrop-blur-sm dark:border-zinc-800 dark:bg-zinc-900/85">
            <LockPitch />
          </div>
        </div>
      </div>
    );
  }

  // Standalone empty-state card (back-compat).
  return (
    <Card className={className} data-locked-feature={feature}>
      <div className="flex h-64 flex-col items-center justify-center">
        <LockPitch />
      </div>
    </Card>
  );
}
