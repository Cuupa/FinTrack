"use client";

// The number of things waiting on a navigation entry.
//
// Deliberately not decoration: it only ever renders a count the user can bring
// back to zero (see lib/notifications/notifications.ts), and it renders nothing
// at all when there is nothing to do. Capped at 99+ so a neglected inbox cannot
// widen the rail.

import { useI18n } from "@/lib/i18n/i18n-context";

export function NotificationCount({
  count,
  /** Overlays the top-right corner of a nav icon (collapsed rail, tab bar)
   *  instead of sitting inline after a label. */
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
      className={`inline-flex items-center justify-center rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold text-white tabular-nums dark:bg-amber-400 dark:text-zinc-900 ${
        overlay ? "absolute -top-1 -right-1.5 min-w-[1.05rem]" : "min-w-[1.25rem] py-0.5"
      }`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
