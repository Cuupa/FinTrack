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
  "nav.simulation": "Simulation",
  "nav.login": "Log in",
  "nav.register": "Register",
  "nav.signOut": "Sign out",
  "nav.settings": "Settings",

  "settings.title": "Settings",
  "settings.name": "Name / nickname",
  "settings.language": "Language",
  "settings.currency": "Base currency",
  "settings.changePassword": "Change password",
  "settings.newPassword": "New password",
  "settings.save": "Save",
  "settings.saved": "Saved",

  "dashboard.title": "Dashboard",
  "dashboard.subtitle": "Your portfolio at a glance.",
  "dashboard.addAsset": "+ Add asset",
  "dashboard.export": "Export",
  "dashboard.share": "Share",

  "analysis.title": "Analysis",
  "simulation.title": "Simulation",
  "rebalancing.title": "Rebalancing",
  "xray.title": "Portfolio X-Ray",

  "common.scope": "Scope",
  "common.portfolioWide": "Portfolio wide",

  "stat.netWorth": "Net worth",
  "stat.change": "Change",
  "stat.unrealized": "Unrealized P&L",
  "stat.realized": "Realized P&L",
  "stat.dividends": "Dividends received",
  "stat.irr": "IRR (p.a.)",
  "stat.twr": "TWR",
  "stat.volatility": "Volatility",
  "stat.maxDrawdown": "Max drawdown",
  "stat.drawdownDuration": "Drawdown duration",
  "stat.downsideVol": "Downside vol",

  "tip.netWorth": "Total current value of all your holdings, converted to your base currency.",
  "tip.change": "Absolute change in net worth over the timeframe; the percentage is the time-weighted (contribution-adjusted) return.",
  "tip.unrealized": "Paper gain/loss on shares you still hold.",
  "tip.realized": "Locked-in gain/loss from shares you have sold.",
  "tip.dividends": "Sum of actual dividend payouts received, scaled by the shares held on each pay date.",
  "tip.irr": "Annualised, money-weighted return that accounts for the timing and size of every buy and sell.",
  "tip.twr": "True time-weighted return over the selected timeframe: the portfolio's compounded performance with deposits/withdrawals removed (comparable to a fund/benchmark).",
  "tip.volatility": "Annualised standard deviation of the portfolio's daily returns over the timeframe.",
  "tip.maxDrawdown": "Largest peak-to-trough decline over the timeframe.",
  "tip.drawdownDuration": "Longest stretch the portfolio spent below a previous peak.",
  "tip.downsideVol": "Annualised semi-deviation — volatility of only the negative days (downside risk).",

  "chart.wealth": "Wealth",
  "chart.return": "Return",
  "chart.loading": "Loading price history…",
  "empty.noHoldings": "No holdings yet",
  "empty.addFirst": "Add your first asset below to see your net worth grow.",

  "table.holdings": "Holdings",
  "table.filter": "Filter by name, symbol, ISIN, WKN…",
  "table.name": "Name",
  "table.currentPrice": "Current price",
  "table.entryPrice": "Entry price",
  "table.currentValue": "Current value",
  "table.allocation": "Allocation",
  "table.noMatch": "No holdings match your filter.",
} as const;

const de: Partial<Record<MessageKey, string>> = {
  "nav.dashboard": "Übersicht",
  "nav.analysis": "Analyse",
  "nav.xray": "X-Ray",
  "nav.rebalance": "Rebalancing",
  "nav.simulation": "Simulation",
  "nav.login": "Anmelden",
  "nav.register": "Registrieren",
  "nav.signOut": "Abmelden",
  "nav.settings": "Einstellungen",

  "settings.title": "Einstellungen",
  "settings.name": "Name / Spitzname",
  "settings.language": "Sprache",
  "settings.currency": "Basiswährung",
  "settings.changePassword": "Passwort ändern",
  "settings.newPassword": "Neues Passwort",
  "settings.save": "Speichern",
  "settings.saved": "Gespeichert",

  "dashboard.title": "Übersicht",
  "dashboard.subtitle": "Ihr Portfolio auf einen Blick.",
  "dashboard.addAsset": "+ Position hinzufügen",
  "dashboard.export": "Exportieren",
  "dashboard.share": "Teilen",

  "analysis.title": "Analyse",
  "simulation.title": "Simulation",
  "rebalancing.title": "Rebalancing",
  "xray.title": "Portfolio X-Ray",

  "common.scope": "Bereich",
  "common.portfolioWide": "Gesamtes Portfolio",

  "stat.netWorth": "Nettovermögen",
  "stat.change": "Veränderung",
  "stat.unrealized": "Nicht realisierter G/V",
  "stat.realized": "Realisierter G/V",
  "stat.dividends": "Erhaltene Dividenden",
  "stat.irr": "IZF (p.a.)",
  "stat.twr": "ZGR",
  "stat.volatility": "Volatilität",
  "stat.maxDrawdown": "Max. Drawdown",
  "stat.drawdownDuration": "Drawdown-Dauer",
  "stat.downsideVol": "Abwärtsvolatilität",

  "tip.netWorth": "Aktueller Gesamtwert all Ihrer Positionen, umgerechnet in Ihre Basiswährung.",
  "tip.change": "Absolute Veränderung des Nettovermögens im Zeitraum; der Prozentwert ist die zeitgewichtete (einzahlungsbereinigte) Rendite.",
  "tip.unrealized": "Buchgewinn/-verlust auf noch gehaltene Anteile.",
  "tip.realized": "Realisierter Gewinn/Verlust aus verkauften Anteilen.",
  "tip.dividends": "Summe der tatsächlich erhaltenen Dividenden, skaliert mit den am jeweiligen Zahltag gehaltenen Anteilen.",
  "tip.irr": "Annualisierte, geldgewichtete Rendite, die Zeitpunkt und Höhe jedes Kaufs und Verkaufs berücksichtigt.",
  "tip.twr": "Echte zeitgewichtete Rendite über den gewählten Zeitraum: die kumulierte Wertentwicklung ohne Ein-/Auszahlungen (vergleichbar mit einem Fonds/Benchmark).",
  "tip.volatility": "Annualisierte Standardabweichung der täglichen Renditen über den Zeitraum.",
  "tip.maxDrawdown": "Größter Rückgang vom Hoch zum Tief im Zeitraum.",
  "tip.drawdownDuration": "Längste Phase unterhalb eines vorherigen Hochs.",
  "tip.downsideVol": "Annualisierte Semi-Abweichung — Volatilität nur der negativen Tage (Abwärtsrisiko).",

  "chart.wealth": "Vermögen",
  "chart.return": "Rendite",
  "chart.loading": "Kursverlauf wird geladen…",
  "empty.noHoldings": "Noch keine Positionen",
  "empty.addFirst": "Fügen Sie unten Ihre erste Position hinzu, um Ihr Vermögen wachsen zu sehen.",

  "table.holdings": "Positionen",
  "table.filter": "Nach Name, Symbol, ISIN, WKN filtern…",
  "table.name": "Name",
  "table.currentPrice": "Aktueller Kurs",
  "table.entryPrice": "Einstandskurs",
  "table.currentValue": "Aktueller Wert",
  "table.allocation": "Gewichtung",
  "table.noMatch": "Keine Positionen entsprechen Ihrem Filter.",
};

const DICTS: Record<Locale, Partial<Record<MessageKey, string>>> = { en, de };

/** Look up a message, falling back to English, then the key itself. */
export function translate(locale: Locale, key: MessageKey): string {
  return DICTS[locale][key] ?? en[key] ?? (key as string);
}
