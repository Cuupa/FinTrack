// Next.js instrumentation hook. `onRequestError` fires for EVERY error thrown
// on the server -- route handlers, server components, rendering -- including
// the ones Next swallows into a generic 500 page whose only trace was the
// hosting provider's function log. Those now land in public.error_logs and
// show up on /admin/errors like any client-side report, which is the whole
// point: an error the owner cannot see is an error that does not get fixed.
//
// Deliberate 5xx RESPONSES (a route returning `{ error }` with status 500
// rather than throwing) never reach this hook -- those go through
// `serverFail()` in lib/server/error-log.ts.
//
// The import is dynamic and runtime-guarded: lib/server/error-log.ts is
// `server-only` and talks to supabase-js, so it is loaded only in the Node
// runtime, never in the edge bundle that also evaluates this file.

import type { Instrumentation } from "next";

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { logServerError } = await import("@/lib/server/error-log");
    const error = err as { message?: unknown; stack?: unknown; digest?: unknown };
    const message =
      typeof error?.message === "string" && error.message
        ? error.message
        : `unhandled ${context.routeType} error`;
    await logServerError({
      // "fatal", not "error": nothing handled this one, the request died.
      level: "fatal",
      message: `${request.method} ${request.path}: ${message}`,
      stack: typeof error?.stack === "string" ? error.stack : null,
      route: request.path,
      digest: typeof error?.digest === "string" ? error.digest : null,
    });
  } catch {
    // A failing error reporter must never take down the request pipeline.
  }
};
