// Shared placeholder for initial-load states: a rounded, subtly pulsing
// block sized entirely via `className`. Static (no pulse) under
// prefers-reduced-motion via Tailwind's motion-reduce: variant.

import type { HTMLAttributes } from "react";

export function Skeleton({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-zinc-200 motion-reduce:animate-none dark:bg-zinc-800 ${className}`}
      {...props}
    />
  );
}

/** A single placeholder text line. `className` overrides height/width (defaults
    to one line at full width) — kept separate from `Skeleton` only because
    text-line placeholders are common enough at call sites to want a shorthand. */
export function SkeletonText({ className = "h-4 w-full" }: { className?: string }) {
  return <Skeleton className={className} />;
}
