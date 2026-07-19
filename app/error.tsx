"use client";

// Route-segment error boundary. Renders inside the root layout, so
// providers (I18n, Auth, Portfolio, ...) are normally mounted for errors
// thrown while rendering a page. If the error instead originated inside one
// of those providers, I18nContext may not be available here either — so the
// localized content is isolated behind its own tiny error boundary
// (I18nGuard below) that falls back to inlined bilingual strings rather than
// crashing this boundary itself.

import { Component, useEffect, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/i18n-context";
import { reportError } from "@/lib/errors/report";

const FALLBACK = {
  title: "Something went wrong / Etwas ist schiefgelaufen",
  body: "An unexpected error occurred. You can try again, or head back to the dashboard. / Ein unerwarteter Fehler ist aufgetreten. Du kannst es erneut versuchen oder zur Übersicht zurückkehren.",
  tryAgain: "Try again / Erneut versuchen",
  backHome: "Back to dashboard / Zur Übersicht",
};

function ErrorBody({
  strings,
  reset,
}: {
  strings: typeof FALLBACK;
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-10 w-10 text-zinc-400"
        aria-hidden="true"
      >
        <path d="M12 9v4" />
        <path d="M12 16.5v.01" />
        <path d="M10.29 3.86l-8.19 14.2A1.5 1.5 0 0 0 3.5 20.5h17a1.5 1.5 0 0 0 1.4-2.44L13.71 3.86a1.5 1.5 0 0 0-2.42 0z" />
      </svg>
      <p className="text-lg font-medium text-zinc-700 dark:text-zinc-300">{strings.title}</p>
      <p className="max-w-md text-sm text-zinc-500">{strings.body}</p>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <Button variant="primary" onClick={reset}>
          {strings.tryAgain}
        </Button>
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-300 px-3.5 py-2 text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          {strings.backHome}
        </Link>
      </div>
    </div>
  );
}

/** Calls useI18n() unconditionally at its own top level — safe under
 * react-hooks/rules-of-hooks. If I18nContext isn't mounted, useI18n() throws
 * and the parent I18nGuard boundary below catches it. */
function LocalizedErrorBody({ reset }: { reset: () => void }) {
  const { t } = useI18n();
  const strings = {
    title: t("error.title"),
    body: t("error.body"),
    tryAgain: t("error.tryAgain"),
    backHome: t("error.backHome"),
  };
  return <ErrorBody strings={strings} reset={reset} />;
}

class I18nGuard extends Component<{ reset: () => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render(): ReactNode {
    if (this.state.failed) return <ErrorBody strings={FALLBACK} reset={this.props.reset} />;
    return <LocalizedErrorBody reset={this.props.reset} />;
  }
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    // Deliberately NOT gated behind useFeatureFlag("errorLogging") here: an
    // error reaching this boundary may have originated inside one of the
    // providers below the root layout (the same reason LocalizedErrorBody is
    // wrapped in its own I18nGuard above) — a hook call risks a crash-in-
    // crash if its context isn't mounted. reportError() is safe to call
    // unconditionally: it never throws, and POST /api/errors re-checks the
    // flag server-side, so a report made while the flag is off is simply
    // dropped there rather than stored.
    reportError({
      kind: "boundary",
      level: "error",
      message: error.message,
      stack: error.stack,
      digest: error.digest,
      route: typeof window !== "undefined" ? window.location.pathname : undefined,
    });
  }, [error]);

  return <I18nGuard reset={reset} />;
}
