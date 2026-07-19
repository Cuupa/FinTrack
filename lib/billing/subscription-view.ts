// Pure view-state derivation for the settings "Subscription" card
// (MONETIZATION.md section 3 "Settings UI"). Kept side-effect-free and
// React-free so it is directly unit-testable (repo convention: pure parts
// tested, provider/component wiring is not) — the only caller is
// components/settings/subscription-card.tsx via lib/billing/billing-context.tsx.

import type { Plan } from "./plan";

export interface SubscriptionRow {
  /** Stripe subscription status, verbatim. */
  status: string;
  /** Always "pro" today (MONETIZATION.md: one paid tier); kept as text so a
   *  future second tier needs no schema change. */
  plan: string;
  priceId: string | null;
  /** ISO datetime of the current billing period's end. */
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
}

export type SubscriptionCardState =
  | { kind: "free" }
  | { kind: "renewing"; date: string }
  | { kind: "ending"; date: string };

/**
 * What the settings card should show, from the already-resolved plan
 * (lib/billing/plan.ts `resolvePlan`) and the raw `subscriptions` row.
 * `plan` (not the row's own status) decides Free vs Pro so this stays
 * consistent with feature-flag gating everywhere else — a `past_due` row
 * past its grace window resolves to `plan: "free"` and reads as Free here
 * too, even though the row itself still exists. Within Pro,
 * `cancelAtPeriodEnd` picks the "ends on" wording over the next renewal
 * date (MONETIZATION.md lifecycle table).
 */
export function subscriptionCardState(
  plan: Plan,
  subscription: SubscriptionRow | null,
): SubscriptionCardState {
  if (plan !== "pro" || !subscription) return { kind: "free" };
  return subscription.cancelAtPeriodEnd
    ? { kind: "ending", date: subscription.currentPeriodEnd }
    : { kind: "renewing", date: subscription.currentPeriodEnd };
}
