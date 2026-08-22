"use client";

// Dual-mode parameter control: a slider by default, with the exact value
// wired to a coupled numeric field -- drag the track or type a precise
// figure, both edit the same state. Extracted out of the simulation panel
// (its original, only user) so the withdrawal-plan panel can share it
// instead of growing a third slider+field copy.

import { useState } from "react";
import { formatInputDecimal, parseDecimal, stripLeadingZero } from "@/lib/format";
import { Slider } from "@/components/ui/slider";
import { useI18n } from "@/lib/i18n/i18n-context";

export function SliderField({
  label,
  value,
  onChange,
  suffix,
  min = 0,
  max = 100,
  step = 1,
  digits = 0,
  lockable = false,
  locked = false,
  onToggleLock,
  isPrivate = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  digits?: number;
  /** Show a lock toggle (e.g. Initial capital, auto-set from net worth). */
  lockable?: boolean;
  locked?: boolean;
  onToggleLock?: () => void;
  /** Blur the shown figure in Incognito mode (absolute money only). */
  isPrivate?: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => formatInputDecimal(value, digits));
  const [dirty, setDirty] = useState(false);
  const display = formatInputDecimal(value, digits);

  function handleManualChange(raw: string) {
    const localized = stripLeadingZero(raw);
    setDraft(localized);
    setDirty(true);
    const parsed = parseDecimal(localized);
    if (Number.isFinite(parsed)) onChange(parsed);
  }

  const lockBtn = lockable ? (
    <button
      type="button"
      onClick={onToggleLock}
      title={locked ? t("sim.capitalLocked") : t("sim.capitalUnlocked")}
      aria-label={locked ? t("sim.capitalLocked") : t("sim.capitalUnlocked")}
      className="text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
        <rect x="5" y="11" width="14" height="10" rx="2" />
        {locked ? <path d="M8 11V7a4 4 0 0 1 8 0v4" /> : <path d="M8 11V7a4 4 0 0 1 7.5-2" />}
      </svg>
    </button>
  ) : null;

  if (lockable && locked) {
    return (
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <label className="text-sm font-medium">{label}</label>
          {lockBtn}
        </div>
        <div
          className="mt-1 text-sm font-semibold tabular-nums opacity-70"
          data-private={isPrivate || undefined}
        >
          {display}
          {suffix ? <span className="ml-1 text-xs font-normal text-zinc-400">{suffix}</span> : null}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label className="text-sm font-medium">{label}</label>
        {lockBtn}
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="flex-1">
          <Slider min={min} max={max} step={step} value={value} onChange={onChange} aria-label={label} />
        </div>
        <div className="flex w-28 shrink-0 items-center gap-1">
          <input
            type="text"
            inputMode="decimal"
            step={step}
            min={min}
            max={max}
            value={dirty ? draft : display}
            onChange={(e) => handleManualChange(e.target.value)}
            onBlur={() => setDirty(false)}
            aria-label={label}
            data-private={isPrivate || undefined}
            className="w-full min-w-0 rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-right text-sm font-medium tabular-nums outline-none transition-colors focus:border-zinc-900 dark:border-zinc-700 dark:focus:border-zinc-300 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          />
          {suffix ? <span className="shrink-0 text-xs text-zinc-400">{suffix}</span> : null}
        </div>
      </div>
    </div>
  );
}
