// Pure builder for a per-subscription push reminder (COMPETITION.md F5). Kept
// free of I/O and server-only imports so it is unit-testable and shareable: the
// cron resolves which assets are due, then calls this per subscription with
// that subscription's own prefs to produce the localized payload (or null when
// nothing that subscription opted into is due).

import { translate } from "../i18n/dictionaries";
import type { Locale } from "../i18n/locale";

export interface PushPayload {
  title: string;
  body: string;
  /** Path to open when the notification is clicked. */
  url: string;
}

/** Join a list of asset names for a notification body ("A, B and C"), capped so
 *  a large portfolio doesn't produce an unreadable line. */
function nameList(locale: Locale, names: string[]): string {
  const MAX = 3;
  if (names.length <= MAX) return names.join(", ");
  const shown = names.slice(0, MAX).join(", ");
  return translate(locale, "push.andMore", { names: shown, count: names.length - MAX });
}

/**
 * Build the reminder for one subscription. `dividends`/`savings` are the asset
 * names due today; `wantDividends`/`wantSavings` are that subscription's prefs.
 * Returns null when nothing the subscription opted into is due.
 */
export function buildReminderPayload(
  locale: Locale,
  dividends: string[],
  savings: string[],
  wantDividends: boolean,
  wantSavings: boolean,
): PushPayload | null {
  const showDiv = wantDividends && dividends.length > 0;
  const showSav = wantSavings && savings.length > 0;
  if (!showDiv && !showSav) return null;

  const lines: string[] = [];
  if (showDiv) lines.push(translate(locale, "push.dividendBody", { assets: nameList(locale, dividends) }));
  if (showSav) lines.push(translate(locale, "push.savingsBody", { assets: nameList(locale, savings) }));

  return {
    title: translate(locale, "push.title"),
    body: lines.join(" "),
    // Dividend reminders open the dividend dashboard; a savings-only reminder
    // opens the dashboard where the savings-plan review card lives.
    url: showDiv ? "/dividends" : "/",
  };
}
