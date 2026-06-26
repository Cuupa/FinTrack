"use client";

// Timeframe / scale / display-mode toggles shared by the dashboard and asset
// detail charts (PRD §3.2, §4.1).

import { TIMEFRAMES, type Timeframe } from "@/lib/finance/dates";
import { SegmentedControl } from "@/components/ui/primitives";
import type { ChartMode, ChartScale } from "./performance-chart";

interface Props {
  timeframe: Timeframe;
  onTimeframe: (tf: Timeframe) => void;
  scale: ChartScale;
  onScale: (s: ChartScale) => void;
  mode: ChartMode;
  onMode: (m: ChartMode) => void;
  /** Show the Currency/Percent toggle (hidden on the asset detail chart). */
  showMode?: boolean;
}

export function ChartControls({
  timeframe,
  onTimeframe,
  scale,
  onScale,
  mode,
  onMode,
  showMode = true,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SegmentedControl
        size="sm"
        value={timeframe}
        onChange={onTimeframe}
        options={TIMEFRAMES.map((tf) => ({ label: tf, value: tf }))}
      />
      <div className="ml-auto flex flex-wrap gap-3">
        <SegmentedControl<ChartScale>
          size="sm"
          value={scale}
          onChange={onScale}
          options={[
            { label: "Linear", value: "linear" },
            { label: "Log", value: "log" },
          ]}
        />
        {showMode && (
          <SegmentedControl<ChartMode>
            size="sm"
            value={mode}
            onChange={onMode}
            options={[
              { label: "Currency", value: "currency" },
              { label: "Percent", value: "percent" },
            ]}
          />
        )}
      </div>
    </div>
  );
}
