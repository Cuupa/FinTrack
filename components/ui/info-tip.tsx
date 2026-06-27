"use client";

// Small "ⓘ" affordance with a short explanatory tooltip (hover or focus).
// Used to explain metrics in-place.

export function InfoTip({ text, className = "" }: { text: string; className?: string }) {
  return (
    <span className={`group relative inline-flex align-middle ${className}`}>
      <button
        type="button"
        aria-label="What is this?"
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-zinc-300 text-[10px] font-semibold leading-none text-zinc-400 transition-colors hover:border-zinc-500 hover:text-zinc-600 dark:border-zinc-600 dark:text-zinc-500 dark:hover:border-zinc-400 dark:hover:text-zinc-300"
      >
        i
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 hidden w-56 -translate-x-1/2 rounded-lg border border-zinc-200 bg-white p-2.5 text-left text-xs font-normal leading-snug text-zinc-600 shadow-lg group-hover:block group-focus-within:block dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
      >
        {text}
      </span>
    </span>
  );
}
