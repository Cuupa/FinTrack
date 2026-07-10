"use client";

// Shared layout + building blocks for the legal pages (/impressum,
// /datenschutz, /terms). These pages render long-form legal text directly in
// the component, switched on the current locale, rather than stuffing every
// sentence into the dictionary (see lib/i18n/dictionaries.ts header comment).

import { useEffect, useRef, type ReactNode } from "react";

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

/**
 * Renders a DB-backed value (e.g. from `useSiteConfig()`) when present. While
 * `loaded` is false (the fetch - or its cache-free first run - hasn't settled
 * yet) a missing value renders nothing, so there's no placeholder flash; once
 * `loaded` is true a still-missing value falls back to the highlighted
 * placeholder ("empty in the DB" or "no Supabase configured").
 */
export function LegalValue({
  value,
  loaded,
  placeholder,
}: {
  value?: string;
  loaded: boolean;
  placeholder: ReactNode;
}) {
  if (value) return <>{value}</>;
  if (!loaded) return null;
  return <Placeholder>{placeholder}</Placeholder>;
}

/**
 * Like `LegalValue`, but for the legal contact email: renders the address
 * onto a <canvas> client-side instead of as text, so it never appears in the
 * DOM (no mailto link, no aria-label/title/alt containing the address) and
 * can't be scraped by address-harvesting bots. Falls back to the same
 * `Placeholder` chip as `LegalValue` when the value is missing.
 *
 * The font and color are read from the canvas element's computed style so
 * the drawn text matches the surrounding legal copy in both light and dark
 * theme; this app has no `.dark` class toggle (see globals.css), theming is
 * purely `prefers-color-scheme`, so a `matchMedia` listener alone covers
 * theme switches.
 *
 * Like `LegalValue`, renders nothing while `loaded` is false and the value is
 * still missing (no placeholder flash); falls back to the `Placeholder` chip
 * once `loaded` is true and the value is still missing.
 */
export function EmailImage({
  value,
  loaded,
  placeholder,
  label = "Email address (shown as an image to prevent spam)",
}: {
  value?: string;
  loaded: boolean;
  placeholder: ReactNode;
  /** Localized, generic (non-address-revealing) label for the canvas. */
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!value) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const draw = () => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const computed = getComputedStyle(canvas);
      const fontSize = computed.fontSize;
      const font = `${computed.fontWeight} ${fontSize} ${computed.fontFamily}`;
      const color = computed.color;
      const fontSizePx = parseFloat(fontSize) || 14;

      ctx.font = font;
      const metrics = ctx.measureText(value);
      const ascent = metrics.actualBoundingBoxAscent || fontSizePx * 0.8;
      const descent = metrics.actualBoundingBoxDescent || fontSizePx * 0.2;
      const width = Math.max(1, Math.ceil(metrics.width));
      const height = Math.max(1, Math.ceil(ascent + descent));
      const dpr = window.devicePixelRatio || 1;

      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      // Shift the box up by its descent so the drawn baseline lines up with
      // the surrounding text's baseline (see class doc comment above).
      canvas.style.marginBottom = `${-descent}px`;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = font;
      ctx.fillStyle = color;
      ctx.textBaseline = "alphabetic";
      ctx.clearRect(0, 0, width, height);
      ctx.fillText(value, 0, ascent);
    };

    draw();

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => draw();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [value]);

  if (!value) {
    if (!loaded) return null;
    return <Placeholder>{placeholder}</Placeholder>;
  }

  return (
    <canvas
      ref={canvasRef}
      width={0}
      height={0}
      role="img"
      aria-label={label}
      className="inline-block align-baseline"
    />
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
