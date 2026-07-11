// Client-safe error reporter: POSTs a minimal error payload to /api/errors
// (fire-and-forget, `keepalive: true` so it survives the page unloading) so
// admins can see production errors without any third-party error-tracking
// service. No-ops when Supabase isn't configured (Guest-only deploys have no
// server-side store for it) and self-throttles so a render loop or a storm
// of window errors can never hammer the endpoint. NEVER throws — a reporting
// failure must never itself become a second error.
//
// The `errorLogging` feature flag is NOT checked here: this module has no
// access to React context (it's called from app/error.tsx, which may render
// with providers missing — see that file — and from the flag-gated
// components/error-reporter.tsx). Callers may call reportError()
// unconditionally; POST /api/errors re-checks the flag server-side and
// silently no-ops when it's off, so an unwanted call here just costs one
// dropped request, never a stored row.

import { isSupabaseConfigured } from "@/lib/supabase/client";
import { apiFetch } from "@/lib/api";

export type ErrorReportKind = "boundary" | "window" | "unhandledrejection";

export interface ErrorReportPayload {
  kind: ErrorReportKind;
  message?: string | null;
  stack?: string | null;
  route?: string | null;
  digest?: string | null;
}

const MESSAGE_MAX = 500;
const STACK_MAX = 4000;
const ROUTE_MAX = 200;
const DIGEST_MAX = 100;

const MAX_PER_WINDOW = 5;
const THROTTLE_WINDOW_MS = 60_000;
const DEDUPE_WINDOW_MS = 60_000;

// Module-level throttle/dedupe state. Reset only by a full page reload —
// that's fine, this guards a single bad session, not across sessions.
let windowStart = 0;
let windowCount = 0;
let lastKey = "";
let lastAt = 0;

export function truncate(value: string | null | undefined, max: number): string | undefined {
  if (!value) return undefined;
  return value.length > max ? value.slice(0, max) : value;
}

/** True if this report should be dropped (over the per-minute cap, or an
 *  identical message+route repeated within the dedupe window). */
function shouldThrottle(key: string, now: number): boolean {
  if (now - windowStart > THROTTLE_WINDOW_MS) {
    windowStart = now;
    windowCount = 0;
  }
  if (key === lastKey && now - lastAt < DEDUPE_WINDOW_MS) return true;
  if (windowCount >= MAX_PER_WINDOW) return true;
  windowCount += 1;
  lastKey = key;
  lastAt = now;
  return false;
}

/** Resets the module-level throttle/dedupe state. Test-only. */
export function __resetThrottleForTests(): void {
  windowStart = 0;
  windowCount = 0;
  lastKey = "";
  lastAt = 0;
}

/**
 * Reports a client-side error to the server. No-op when Supabase isn't
 * configured, `fetch` is unavailable, or the report is throttled/deduped.
 * Never throws.
 */
export function reportError(payload: ErrorReportPayload): void {
  try {
    if (!isSupabaseConfigured) return;
    if (typeof fetch !== "function") return;

    const message = truncate(payload.message, MESSAGE_MAX);
    const route = truncate(payload.route, ROUTE_MAX);
    const key = `${payload.kind}:${message ?? ""}:${route ?? ""}`;
    if (shouldThrottle(key, Date.now())) return;

    const body = JSON.stringify({
      kind: payload.kind,
      message,
      stack: truncate(payload.stack, STACK_MAX),
      route,
      digest: truncate(payload.digest, DIGEST_MAX),
    });

    // apiFetch (not a plain fetch) so a report still passes the /api gateway
    // when NEXT_PUBLIC_API_TOKEN is configured (middleware.ts requires it on
    // every /api/* route besides /api/cron/*).
    apiFetch("/api/errors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      keepalive: true,
      body,
    }).catch(() => {
      // Fire-and-forget: a failed report must never surface to the caller.
    });
  } catch {
    // Reporting must never throw, even on an unexpected failure above.
  }
}
