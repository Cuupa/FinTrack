"use client";

// Root-level error boundary: catches errors thrown in app/layout.tsx itself
// (e.g. a provider failing during render), so it runs with NO providers, no
// i18n context, and no guarantee that globals.css even applied. It must
// render its own <html>/<body> (Next requirement) and stay fully
// self-contained: inline styles only, both languages shown together.

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          backgroundColor: "#fafafa",
          color: "#18181b",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "1rem",
            textAlign: "center",
            maxWidth: "28rem",
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            width={40}
            height={40}
            style={{ color: "#a1a1aa" }}
            aria-hidden="true"
          >
            <path d="M12 9v4" />
            <path d="M12 16.5v.01" />
            <path d="M10.29 3.86l-8.19 14.2A1.5 1.5 0 0 0 3.5 20.5h17a1.5 1.5 0 0 0 1.4-2.44L13.71 3.86a1.5 1.5 0 0 0-2.42 0z" />
          </svg>

          <p style={{ fontSize: "1.125rem", fontWeight: 600, margin: 0 }}>
            Something went wrong
            <br />
            Etwas ist schiefgelaufen
          </p>

          <p style={{ fontSize: "0.875rem", color: "#71717a", margin: 0 }}>
            An unexpected error occurred and the app could not continue. Please try again or
            reload the page.
            <br />
            <br />
            Ein unerwarteter Fehler ist aufgetreten, die App konnte nicht fortfahren. Bitte
            versuche es erneut oder lade die Seite neu.
          </p>

          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", justifyContent: "center" }}>
            <button
              onClick={reset}
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "0.5rem",
                padding: "0.5rem 0.875rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
                backgroundColor: "#18181b",
                color: "#ffffff",
              }}
            >
              Try again / Erneut versuchen
            </button>
            {/* Plain <a>, not next/link: this boundary replaces the root
                layout, so Next's router context isn't guaranteed to be
                mounted here. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a
              href="/"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "0.5rem",
                padding: "0.5rem 0.875rem",
                fontSize: "0.875rem",
                fontWeight: 500,
                border: "1px solid #d4d4d8",
                color: "#18181b",
                textDecoration: "none",
              }}
            >
              Back to dashboard / Zur Übersicht
            </a>
          </div>
        </div>
      </body>
    </html>
  );
}
