"use client";

// Shared layout + building blocks for the legal pages (/impressum,
// /datenschutz, /terms). These pages render long-form legal text directly in
// the component, switched on the current locale, rather than stuffing every
// sentence into the dictionary (see lib/i18n/dictionaries.ts header comment).

import type { ReactNode } from "react";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  /** Localized "Last updated" line, e.g. "Last updated: 4 July 2026". */
  updated?: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {updated && <p className="mt-1 text-sm text-zinc-500">{updated}</p>}
      </div>
      <div className="space-y-6 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        {children}
      </div>
    </div>
  );
}

export function LegalSection({
  heading,
  children,
}: {
  heading: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{heading}</h2>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

/** Visually obvious stand-in for data the operator must fill in themselves. */
export function Placeholder({ children }: { children: ReactNode }) {
  return (
    <span className="rounded bg-amber-100 px-1.5 py-0.5 font-mono text-[0.85em] font-semibold text-amber-900 ring-1 ring-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:ring-amber-800">
      {children}
    </span>
  );
}

export function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-600 dark:text-emerald-400 dark:hover:text-emerald-300"
    >
      {children}
    </a>
  );
}
