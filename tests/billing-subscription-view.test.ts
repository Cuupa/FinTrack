// Settings subscription card view-state derivation (lib/billing/subscription-view.ts).
// MONETIZATION.md section 3 "Settings UI": Free shows nothing extra, Pro
// shows the next renewal date unless the user cancelled, in which case it
// shows the "ends on" date instead.

import { describe, expect, it } from "vitest";
import { subscriptionCardState, type SubscriptionRow } from "../lib/billing/subscription-view";

const ROW: SubscriptionRow = {
  status: "active",
  plan: "pro",
  priceId: "price_123",
  currentPeriodEnd: "2026-08-19T00:00:00.000Z",
  cancelAtPeriodEnd: false,
};

describe("subscriptionCardState", () => {
  it("free plan with no row shows free", () => {
    expect(subscriptionCardState("free", null)).toEqual({ kind: "free" });
  });

  it("free plan with a stale row still shows free (plan is authoritative)", () => {
    // e.g. a past_due row past its grace window: resolvePlan already
    // downgraded to "free", the card must not show Pro from the raw row.
    expect(subscriptionCardState("free", ROW)).toEqual({ kind: "free" });
  });

  it("pro plan with no row shows free (defensive: should not happen)", () => {
    expect(subscriptionCardState("pro", null)).toEqual({ kind: "free" });
  });

  it("pro plan, not cancelled, shows the renewal date", () => {
    expect(subscriptionCardState("pro", ROW)).toEqual({
      kind: "renewing",
      date: "2026-08-19T00:00:00.000Z",
    });
  });

  it("pro plan, cancel_at_period_end, shows the ends-on date instead", () => {
    const cancelled: SubscriptionRow = { ...ROW, cancelAtPeriodEnd: true };
    expect(subscriptionCardState("pro", cancelled)).toEqual({
      kind: "ending",
      date: "2026-08-19T00:00:00.000Z",
    });
  });
});
