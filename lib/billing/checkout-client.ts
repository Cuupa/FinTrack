"use client";

// Shared client-side helper for the redirect-based billing routes
// (MONETIZATION.md section 3): posts the caller's own session bearer token
// to a `/api/billing/*` route and navigates the browser to the returned
// hosted-page URL on success. Extracted (Phase 3) so
// components/settings/subscription-card.tsx and app/pricing/page.tsx share
// one implementation of "no Stripe.js, redirect-based" instead of
// duplicating the fetch/error-mapping logic.

import { getSupabaseClient } from "../supabase/client";

export type BillingRedirectErrorKind = "generic" | "disabled" | "noSubscription" | "unavailable";

const STATUS_ERROR_KINDS: Partial<Record<number, BillingRedirectErrorKind>> = {
  403: "disabled",
  404: "noSubscription",
  503: "unavailable",
};

/**
 * POSTs `body` to `path` with the signed-in user's session bearer token and
 * navigates to the returned `{ url }` on success. Returns an error kind on
 * failure (the caller maps it to a localized message), or null on success
 * (the browser is about to navigate away, so there's nothing further to do).
 */
export async function redirectToBilling(
  path: string,
  body?: Record<string, unknown>,
): Promise<BillingRedirectErrorKind | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return "generic";
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) return "generic";
    const res = await fetch(path, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body ?? {}),
    });
    if (!res.ok) return STATUS_ERROR_KINDS[res.status] ?? "generic";
    const data = (await res.json().catch(() => null)) as { url?: string } | null;
    if (!data?.url) return "generic";
    window.location.href = data.url;
    return null;
  } catch {
    return "generic";
  }
}
