"use client";

// Modern range slider: a rounded track with an accent-filled portion up to the
// thumb and a clean white knob. Styling lives in globals.css (.fin-slider) since
// range pseudo-elements can't be styled with utility classes. The filled width
// is driven by the --fill custom property.

import type { CSSProperties } from "react";

export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  "aria-label": ariaLabel,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (v: number) => void;
  "aria-label"?: string;
}) {
  const clamped = Math.min(max, Math.max(min, value));
  const pct = max > min ? ((clamped - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      className="fin-slider"
      value={value}
      min={min}
      max={max}
      step={step}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ "--fill": `${pct}%` } as CSSProperties}
    />
  );
}
