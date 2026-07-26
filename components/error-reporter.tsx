"use client";

// Best-effort browser-side error capture: listens for uncaught errors and
// unhandled promise rejections anywhere in the app and reports them via
// lib/errors/report.ts. Renders nothing. Mounted once in
// components/providers.tsx, inside FeatureFlagsProvider so useFeatureFlag is
// available here (unlike app/error.tsx, which skips the hook — see that
// file's comment — because it may render before providers are mounted).
// Listeners attach only while the `errorLogging` flag is enabled; toggling
// it off (or it resolving disabled) detaches them via the effect cleanup.
//
// The two window listeners only ever see errors nobody handled. Failed
// requests and console output are handled — by the caller's catch, by React —
// and so stayed invisible outside devtools; lib/errors/instrument.ts patches
// fetch and console to close exactly that gap, installed here so it shares
// this component's flag gating and cleanup.

import { useEffect } from "react";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { reportError } from "@/lib/errors/report";
import { installConsoleReporter, installFetchReporter } from "@/lib/errors/instrument";

function messageAndStack(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) return { message: reason.message, stack: reason.stack };
  if (typeof reason === "string") return { message: reason };
  try {
    return { message: JSON.stringify(reason) };
  } catch {
    return { message: String(reason) };
  }
}

export function ErrorReporter() {
  const enabled = useFeatureFlag("errorLogging");

  useEffect(() => {
    if (!enabled) return;

    const onError = (event: ErrorEvent) => {
      reportError({
        kind: "window",
        level: "error",
        message: event.message || event.error?.message || "window error",
        stack: event.error?.stack ?? null,
        route: window.location.pathname,
      });
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const { message, stack } = messageAndStack(event.reason);
      reportError({
        kind: "unhandledrejection",
        level: "error",
        message,
        stack: stack ?? null,
        route: window.location.pathname,
      });
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    const uninstallFetch = installFetchReporter();
    const uninstallConsole = installConsoleReporter();
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
      uninstallFetch();
      uninstallConsole();
    };
  }, [enabled]);

  return null;
}
