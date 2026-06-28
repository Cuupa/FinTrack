// Small Tailwind UI primitives shared across the app.

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { InfoTip } from "./info-tip";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      {children}
    </div>
  );
}

export function Stat({
  label,
  value,
  sub,
  valueClassName = "",
  info,
  isPrivate = false,
  size = "md",
}: {
  label: string;
  value: string;
  sub?: string;
  valueClassName?: string;
  /** Optional short explanation shown via an ⓘ tooltip next to the label. */
  info?: string;
  /** Mark the figure as an absolute amount, blurred in Incognito mode. */
  isPrivate?: boolean;
  /** "sm" tightens the value font + spacing (used to keep the hero compact). */
  size?: "sm" | "md";
}) {
  const valueSize = size === "sm" ? "text-xl" : "text-2xl";
  const labelMin = size === "sm" ? "min-h-[1.75rem]" : "min-h-[2.25rem]";
  return (
    <div>
      {/* Inline (not flex) so the ⓘ flows right after the text and wraps with it;
          min-height reserves two lines so values stay aligned when a (e.g.
          German) label wraps. */}
      <div className={`flex ${labelMin} items-start text-sm leading-snug text-zinc-500`}>
        <span>
          {label}
          {info && (
            <span className="ml-1 inline-flex translate-y-0.5 align-text-bottom">
              <InfoTip text={info} />
            </span>
          )}
        </span>
      </div>
      <div
        className={`mt-1 ${valueSize} font-semibold tabular-nums ${valueClassName}`}
        {...(isPrivate ? { "data-private": "" } : {})}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-sm text-zinc-500 tabular-nums">{sub}</div>}
    </div>
  );
}

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white",
  secondary:
    "border border-zinc-300 text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-100 dark:hover:bg-zinc-800",
  ghost: "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
  danger:
    "border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950",
};

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

/** Segmented control for toggles (timeframe, scale, display mode). */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: readonly { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-zinc-200 bg-zinc-100 p-0.5 dark:border-zinc-800 dark:bg-zinc-800/50">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          aria-pressed={opt.value === value}
          className={`rounded-md font-medium transition-colors ${pad} ${
            opt.value === value
              ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-white"
              : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
