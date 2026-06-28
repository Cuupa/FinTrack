// Active-locale plumbing shared between the React i18n context and the pure
// formatting helpers (which can't read context). The provider mirrors its state
// here so Intl-based formatters in lib/format.ts conform to the chosen locale.

export type Locale = "en" | "de";

export const LOCALES: { code: Locale; label: string }[] = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
];

// BCP-47 tags passed to Intl. Separate from our internal Locale codes so we can
// add region nuances later without touching call sites.
const INTL_TAG: Record<Locale, string> = { en: "en-US", de: "de-DE" };

let active: Locale = "en";

export function setActiveLocale(locale: Locale): void {
  active = locale;
}

export function getActiveLocale(): Locale {
  return active;
}

/** BCP-47 tag for the active locale, for Intl.* formatters. */
export function intlLocale(): string {
  return INTL_TAG[active];
}
