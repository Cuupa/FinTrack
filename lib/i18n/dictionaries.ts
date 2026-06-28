// UI string dictionaries. Keys are dot-namespaced by area. `en` is the source
// of truth; other locales fall back to `en` for any missing key. Migrate strings
// to t("...") incrementally — anything not yet keyed still renders literally.

import type { Locale } from "./locale";

export type MessageKey = keyof typeof en;

export const en = {
  "nav.dashboard": "Dashboard",
  "nav.analysis": "Analysis",
  "nav.xray": "X-Ray",
  "nav.rebalance": "Rebalance",
  "nav.planning": "Planning",
  "nav.login": "Log in",
  "nav.register": "Register",
  "nav.signOut": "Sign out",

  "dashboard.title": "Dashboard",
  "dashboard.subtitle": "Your portfolio at a glance.",
  "dashboard.addAsset": "+ Add asset",
  "dashboard.export": "Export",
  "dashboard.share": "Share",

  "analysis.title": "Analysis",
  "planning.title": "Planning",
  "rebalancing.title": "Rebalancing",
  "xray.title": "Portfolio X-Ray",

  "common.scope": "Scope",
  "common.portfolioWide": "Portfolio wide",
} as const;

const de: Partial<Record<MessageKey, string>> = {
  "nav.dashboard": "Übersicht",
  "nav.analysis": "Analyse",
  "nav.xray": "Röntgen",
  "nav.rebalance": "Umschichten",
  "nav.planning": "Planung",
  "nav.login": "Anmelden",
  "nav.register": "Registrieren",
  "nav.signOut": "Abmelden",

  "dashboard.title": "Übersicht",
  "dashboard.subtitle": "Ihr Portfolio auf einen Blick.",
  "dashboard.addAsset": "+ Wert hinzufügen",
  "dashboard.export": "Exportieren",
  "dashboard.share": "Teilen",

  "analysis.title": "Analyse",
  "planning.title": "Planung",
  "rebalancing.title": "Umschichtung",
  "xray.title": "Portfolio-Röntgen",

  "common.scope": "Bereich",
  "common.portfolioWide": "Gesamtes Portfolio",
};

const DICTS: Record<Locale, Partial<Record<MessageKey, string>>> = { en, de };

/** Look up a message, falling back to English, then the key itself. */
export function translate(locale: Locale, key: MessageKey): string {
  return DICTS[locale][key] ?? en[key] ?? (key as string);
}
