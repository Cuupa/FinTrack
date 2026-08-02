"use client";

// The number of things waiting on a navigation entry.
//
// Deliberately not decoration: it only ever renders a count the user can bring
// back to zero (see lib/notifications/notifications.ts), and it renders nothing
// at all when there is nothing to do. Capped at 99+ so a neglected inbox cannot
// widen the rail.
//
// Plain coloured text, never a filled pill (owner rule: no badges anywhere in
// this app). A filled amber circle read as a warning about the entry itself,
// and it cost the label the width it needed: "Konten & Buchungen" truncated to
// "Konten & Buchu…" purely to make room for a one-digit count.

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
      className={`text-[11px] font-semibold text-emerald-600 tabular-nums dark:text-emerald-400 ${
        overlay ? "absolute -top-2 -right-2 leading-none" : ""
      }`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
