// SummaryStrip (UX-Unification-Spec §7.2): the one shared surface for two to
// five headline figures at the top of a data page. One frame around the whole
// strip, never a card per metric -- a row of bordered cards was exactly the
// "pile of boxes" the redesign removes. Dividers sit BETWEEN the metrics:
// horizontal when the strip stacks on mobile, vertical when it is a row on
// desktop.
//
// A metric carries a label, a main value and an optional context line. The main
// value is neutral by default: a balance is a stock, not a judgement, so only a
// CHANGE (a delta, an overshoot) passes a semantic `valueClassName`.

import type { ReactNode } from "react";

export type SummaryMetric = {
  label: ReactNode;
  value: ReactNode;
  /** Small line under the value: a sub-total, a note, a comparison. */
  context?: ReactNode;
  /** Semantic color for a value that is a delta, not a stock. Left unset the
   *  value stays neutral (`text-primary`). */
  valueClassName?: string;
  /** Blurs the value in privacy mode, like every other figure on the page. */
  isPrivate?: boolean;
};

export function SummaryStrip({
  metrics,
  className = "",
  dataTour,
}: {
  metrics: SummaryMetric[];
  className?: string;
  dataTour?: string;
}) {
  return (
    <div
      data-tour={dataTour}
      className={`flex flex-col divide-y divide-subtle rounded-surface border border-subtle bg-surface sm:flex-row sm:divide-x sm:divide-y-0 ${className}`}
    >
      {metrics.map((m, i) => (
        <div key={i} className="min-h-[5.5rem] flex-1 px-5 py-4">
          <p className="text-xs font-medium text-tertiary">{m.label}</p>
          <p
            className={`mt-1 text-2xl font-semibold tabular-nums ${m.valueClassName ?? "text-primary"}`}
            data-private={m.isPrivate ? "" : undefined}
          >
            {m.value}
          </p>
          {m.context != null && <p className="mt-1 text-xs text-secondary">{m.context}</p>}
        </div>
      ))}
    </div>
  );
}
