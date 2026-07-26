"use client";

// Browser-wide capture of the two error classes that never reached
// /admin/errors before, because nothing in the app ever threw for them:
//
//   1. FAILED REQUESTS. `GET .../plan_grants 404` and
//      `GET /api/admin/billing/grants 500` were printed by the browser into
//      its own console and nowhere else -- every caller handled the failure
//      (a `catch` that shows a message, a supabase-js result whose `error`
//      field is ignored), so no window error and no unhandled rejection ever
//      fired. Wrapping `fetch` catches all of them at one seam, whatever the
//      caller does with the result afterwards, including supabase-js's own
//      requests.
//   2. CONSOLE OUTPUT. React and a fair amount of app code report problems
//      with console.error/console.warn instead of throwing. Mirroring both
//      into the log is the difference between "the owner has to be sitting
//      in front of devtools" and "the owner can look it up afterwards".
//
// PRIVACY: only origin + pathname of a failing request is logged, never the
// query string -- a PostgREST URL carries filters like `user_id=eq.<uuid>`,
// and /datenschutz promises the error log holds no user id. Request and
// response BODIES are never touched at all.
//
// Both installers are idempotent, return an uninstall function, and never
// change what the wrapped function returns or throws.

import { reportError, type ErrorLevel } from "./report";

/** Reports about the reporter itself would loop; /api/errors is the one URL
 *  a failed request is never reported for. */
const REPORT_PATH = "/api/errors";

const MESSAGE_MAX = 400;

type PatchedFetch = typeof fetch & { __fintrackReporter?: true };
type PatchedConsole = Console["error"] & { __fintrackReporter?: true };

/** origin + pathname, query string deliberately dropped (see PRIVACY above). */
function safeUrl(raw: string): string {
  try {
    const u = new URL(raw, window.location.origin);
    return `${u.origin}${u.pathname}`;
  } catch {
    return raw.split("?")[0];
  }
}

function describeRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): { url: string; method: string } {
  if (typeof input === "string") return { url: safeUrl(input), method: init?.method ?? "GET" };
  if (input instanceof URL) return { url: safeUrl(input.href), method: init?.method ?? "GET" };
  return { url: safeUrl(input.url), method: init?.method ?? input.method ?? "GET" };
}

/**
 * Wraps window.fetch so every non-ok response and every network-level
 * failure is reported. 5xx and network failures are "error"; 4xx is "warn",
 * which keeps routine 401/403 token refreshes filterable on /admin/errors
 * without hiding them.
 */
export function installFetchReporter(): () => void {
  if (typeof window === "undefined") return () => {};
  const original = window.fetch as PatchedFetch;
  if (typeof original !== "function" || original.__fintrackReporter) return () => {};

  const patched: PatchedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const { url, method } = describeRequest(input, init);
    const own = url.endsWith(REPORT_PATH);
    let res: Response;
    try {
      res = await original(input, init);
    } catch (e) {
      if (!own) {
        reportError({
          kind: "fetch",
          level: "error",
          message: `${method} ${url} failed: ${e instanceof Error ? e.message : String(e)}`,
          stack: e instanceof Error ? (e.stack ?? null) : null,
          route: window.location.pathname,
        });
      }
      throw e;
    }
    if (!res.ok && !own) {
      const level: ErrorLevel = res.status >= 500 ? "error" : "warn";
      reportError({
        kind: "fetch",
        level,
        message: `${method} ${url} -> ${res.status}${res.statusText ? ` ${res.statusText}` : ""}`,
        route: window.location.pathname,
      });
    }
    return res;
  };
  patched.__fintrackReporter = true;
  window.fetch = patched;

  return () => {
    if ((window.fetch as PatchedFetch).__fintrackReporter) window.fetch = original;
  };
}

function formatArgs(args: unknown[]): { message: string; stack: string | null } {
  let stack: string | null = null;
  const parts = args.map((arg) => {
    if (arg instanceof Error) {
      stack ??= arg.stack ?? null;
      return arg.message;
    }
    if (typeof arg === "string") return arg;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  });
  const message = parts.join(" ");
  return { message: message.length > MESSAGE_MAX ? message.slice(0, MESSAGE_MAX) : message, stack };
}

/**
 * Mirrors console.error / console.warn into the log. The original console
 * method is always called first and with the untouched arguments, so devtools
 * output is exactly what it was.
 */
export function installConsoleReporter(): () => void {
  if (typeof console === "undefined") return () => {};
  const originalError = console.error as PatchedConsole;
  const originalWarn = console.warn as PatchedConsole;
  if (originalError.__fintrackReporter) return () => {};

  const mirror = (level: ErrorLevel, original: PatchedConsole): PatchedConsole => {
    const patched = ((...args: unknown[]) => {
      original(...args);
      const { message, stack } = formatArgs(args);
      if (!message) return;
      reportError({
        kind: "console",
        level,
        message,
        stack,
        route: typeof window === "undefined" ? null : window.location.pathname,
      });
    }) as PatchedConsole;
    patched.__fintrackReporter = true;
    return patched;
  };

  console.error = mirror("error", originalError);
  console.warn = mirror("warn", originalWarn);

  return () => {
    console.error = originalError;
    console.warn = originalWarn;
  };
}
