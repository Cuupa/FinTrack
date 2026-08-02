"use client";

// The number of things waiting on a navigation entry.
//
// Deliberately not decoration: it only ever renders a count the user can bring
// back to zero (see lib/notifications/notifications.ts), and it renders nothing
// at all when there is nothing to do. Capped at 99+ so a neglected inbox cannot
// widen the rail.
//
// Coloured text inside a ring of the same colour, never a filled pill (owner
// rule: no badges anywhere in this app). A filled amber circle read as a
// warning about the entry itself, and it cost the label the width it needed:
// "Konten & Buchungen" truncated to "Konten & Buchu…" purely to make room for
// a one-digit count. The outline gives the number an edge without the weight
// of a filled badge.

import { useI18n } from "@/lib/i18n/i18n-context";

export function NotificationCount({
  count,
  /** Sits at the top-right corner of a nav icon (collapsed rail, tab bar)
   *  instead of inline after a label. */
  overlay = false,
}: {
  count: number;
  overlay?: boolean;
}) {
  const { t } = useI18n();
  if (count <= 0) return null;
  return (
    <span
      role="status"
      aria-label={t("notif.pending", { count })}
      className={`inline-flex h-5 items-center justify-center rounded-full border border-emerald-600 px-2 text-[11px] font-semibold leading-none text-emerald-600 tabular-nums dark:border-emerald-400 dark:text-emerald-400 ${
        overlay ? "absolute -top-2.5 -right-2.5" : ""
      }`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
