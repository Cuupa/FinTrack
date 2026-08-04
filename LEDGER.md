# LEDGER

Mandatory claim file (CLAUDE.md). Claim a task here BEFORE delegating to a
subworker; commit only the paths you claimed. Finished rounds get one line —
die Begruendung hinter einer Aenderung gehoert in DOCUMENTATION.md oder in den
Commit, nicht hierher.

## Offen fuer den Owner: Migrationen

Diese Migrationen sind geschrieben, aber noch nicht gegen die Live-Datenbank
gelaufen. Bis dahin quittiert die betroffene Tabelle einen 400/500.

**Diese Liste ist eine Notiz, kein Befund.** 0111 stand hier noch drin,
obwohl sie laengst gelaufen war — und eine Fehlersuche darauf zu stuetzen
fuehrt zur falschen Diagnose. Erst gegen die Live-DB pruefen, dann schliessen.

| Migration | Wirkung ohne sie |
| --- | --- |
| 0108 + 0109 | `/admin/usage` laeuft auf 500 |
| 0112 | Datenreparatur: verlorene Umbuchungsziele bleiben `null` |
| 0113 | `contracts`/`planned_cashflows` quittieren `month_end` mit 400 |
| 0114 | Die Retry-Queue der Kurs-Cron bleibt aus (Sync laeuft normal weiter) |
| 0115 | Nur die Flag-Beschreibung in `/admin/flags` bleibt alt |
| 0116 | Sparplan-Verrechnungskonto und Ausgabeaufschlag quittieren 400 |
| 0120 | Vertragsstände lassen sich nicht speichern (Rendite bleibt getippt) |
| 0121 | Verrechnungskonto am Vertrag quittiert 400, Beiträge buchen nicht |
| 0122 | Wiederholte Bestätigung einer Vertragsrate kann sie doppelt anlegen (die App bucht ohne 0122 weiter, nur eben in zwei Schritten) |
| 0123 | Wiederholte Bestätigung einer Sparplan-Ausführung kauft dieselben Anteile ein zweites Mal (ohne 0123 fehlt der Ausführung nur die Kennung, gebucht wird weiter) |

0112 traegt oben eine reine Lese-Abfrage, mit der sich der Umfang vorher
ansehen laesst.

## Aktive Claims

| Task | Prio | Status | Paths |
| --- | --- | --- | --- |
| — | — | — | — |

## Offen (TODO.md)

| Task | Prio | Warum noch offen |
| --- | --- | --- |

## Erledigt

### Runde 2026-08-04

| Task | Commit / Umfang |
| --- | --- |
| LLM-Chat laesst Seitenscrollen beim Oeffnen zu | `components/llm/chat-panel.tsx`, `tests/llm-chat-panel.test.ts` |
| Monte-Carlo beruecksichtigt die PensionBridge | `lib/finance/monte-carlo.ts`, `lib/simulation/use-monte-carlo.ts`, Simulation/FIRE-Link, `tests/withdrawal.test.ts` |
| Buchung hinzufuegen oeffnet ein Modal | `components/spending/spending-view.tsx` |
| Monatsende als Toggle | `components/spending/spending-view.tsx`, `components/spending/planned-form.tsx`, `components/spending/recurring-form.tsx` |
| Tag-Gruppen-Anlage hinter Plus | `components/assets/tag-groups-manager.tsx` |
| Dezimaltrennzeichen in FIRE/Simulation geprueft | Bereits `parseDecimal` in den freien Eingabefeldern; kein Code-Change noetig |

### Runde 2026-08-02 (dritter Teil)

| Task | Commit / Umfang |
| --- | --- |
| Vertragsrendite wird gemessen | f505792 — `pension_contract_values` (0120) am vollen Store-Seam, `contractReturn` (XIRR, min. ein halbes Jahr Abstand), `resolveContract`; getippte Rendite gewinnt weiter |
| Beitrag läuft vom Konto | b121b12 — Verrechnungskonto + Review-Liste am Vertrag, `pension_contract_id` (0121) zählt die Buchung als Umbuchung, Zähler in der Navigation |
| Vertragsrate ist wiederholsicher | 0122 — bucht Zeile und Fortschrittsdatum atomar, jede Spalte der Buchung liegt am Funktionsaufruf an, `isMissingFunctionError` fällt auf die zwei Schreibvorgänge zurück solange 0122 fehlt, der Cursor zieht auch nach, wenn die Zeile schon steht; Guest- und Supabase-Store bleiben beim Löschen und beim Retry gleich |
| Sparplan-Ausführung ist wiederholsicher | 0123 — `transactions.savings_plan_id` als reine Kennung, Store erkennt den schon gebuchten Kauf und zieht `lastRunDate` mit, Cursor läuft nie rückwärts; die Karte sammelt die Fortschrittsdaten nicht mehr bis zum Schleifenende |
| Eine Fußzeile für Formulare | c8cc952 — `FormActions`, sieben handgeschriebene Kopien ersetzt, Abbrechen vor der Hauptaktion |
| Langer Name im Dropdown | Voller Text als `title` an Trigger und Option |

**Offen aus dieser Runde**: die Monte-Carlo-Läufe rechnen die Rente weiterhin
nicht ein (nur die deterministischen FIRE-Ziele tun das).

### Runde 2026-08-02 (zweiter Teil)

| Task | Commit / Umfang |
| --- | --- |
| Eine Simulation statt zwei | f0a1696 + 4a9561b — erst ein Ruhestand-Modus, dann auf Ansage ganz weg: Jahre bis FIRE gehen als ANLAGEHORIZONT in die bestehende Simulation (`?years=&withdrawal=`), FIRE verlinkt nur noch |
| Entnahme und Stress ernst gemeint | Entnahmen inflationsindexiert (die 4%-Regel ist real, nicht nominal), Stress ab Lauf-Anker also auch ohne Entnahmephase, Inflationsschock, VPW als fünfte Strategie, `tests/withdrawal.test.ts` erweitert |
| Rentenfaktor + Dynamik | 7b498e8 — Migration 0119, `projectContract` (Kapital -> Rente), Beitragsdynamik, angenommene Rendite; getippte Monatsrente nur noch als Fallback |
| Verbindlichkeiten am Konto | 7b498e8 — Zins/Rate/Zinsbindung/Folgezins in `AccountEditDialog`, `DebtDetailsDialog` gelöscht, /debt visualisiert nur |
| Dropdown im Modal | f7d1cc8 — Popover per Portal an den Body, fest positioniert über der Modal-Ebene |
| Zähler in Pillenform | f7d1cc8 — Rand statt Füllung, Pille statt Kreis |

**Beides inzwischen erledigt** (dritter Teil oben): Vertragsrendite aus
mehreren Ständen, Vertragsbeiträge als Buchung von einem Konto.

### Runde 2026-08-02

| Task | Commit / Umfang |
| --- | --- |
| Rentenprognose war um ~5x zu hoch | Median statt Mittelwert (`typicalAnnualPoints`), Ausreisserzeile wird benannt, Seite zeigt ihre eigene Rechnung |
| Loeschen sieht aus wie ueberall | `RowActions`/`DeleteAction` in beiden Renten-Tabellen |
| FIRE rechnet die Rente ein | `PensionBridge` + `fireNumberWithPension`, Fixpunkt aus Ziel und Datum, Schalter + Zeile "was die Rente bringt". **Offen: die Monte-Carlo-Laeufe beruecksichtigen die Rente noch nicht** |

### Runde 2026-08-01 (dritter Teil)

| Task | Commit / Umfang |
| --- | --- |
| FIRE + Rente unter einem Navipunkt | `/retirement` mit Tab-Strip, `/fire` + `/pension` leiten weiter, `routeFeatureState` fuer Mehrfach-Flags, `e2e/retirement.spec.ts` |
| Tab-Strip einmal statt viermal | `components/ui/tabs.tsx`, uebernommen von /analysis, Settings und dem Simulations-Modell |
| Kontenauswahl ist ein Multiselect | `SelectMenu` bekommt `multiple`, leere Auswahl = alle Konten, `e2e/accounts-unified.spec.ts` erweitert |
| LLM-Kontext kennt den Rest der App | Buchungen, Budgets, Wiederkehrendes, Ziele, Rente, FIRE, Watchlist, Tags — je hinter dem eigenen Flag; `/datenschutz` nachgezogen |
| Export umfasst alles | Ein Abschnitt je Entitaet, leere fallen weg; `parseFinTrack` begrenzt Abschnitte; JSON traegt den API-Key nicht mehr; `hasExportableData` statt "nur Depot"; `tests/export.test.ts` |
| Monte Carlo: Entnahmestrategien, Stress, ein Runner | `lib/finance/withdrawal.ts` (4 Strategien + Sequenzstress), Vergleich ueber identische Pfade, `useMonteCarloRun` fuer /simulation UND FIRE, `WithdrawalStrategyPanel`/`WithdrawalComparison`, `tests/withdrawal.test.ts` |
| Demo-Account ist nicht mehr nur ein Depot | `demo_user.sql`: Konten inkl. Kredit, 18 Monate Buchungen, Budgets, Vertraege, Planung, Ziele, Sparplaene, Watchlist, Tags, Rente. **Noch nicht ausgefuehrt** (lokal kein Postgres, kein Docker-Daemon) |

### Runde 2026-08-01 (zweiter Teil)

| Task | Commit / Umfang |
| --- | --- |
| Rendite-Modus nennt das Depot; Fehler in `windowChange` | 4124195 — Notiz + Depot-Label auf `/`, negative Basis war keine Basis |
| Kurs-Sync: Retry-Queue statt haengender Zeilen | 7587b00 — `lib/server/price-retry.ts`, Migration 0114, Spalte in /admin/prices |
| Split hinter `splitDetection`, Teilen-Schalter, InfoTip-Aria | d925460 — Migration 0115 |

### Runde 2026-08-01

| Task | Commit / Umfang |
| --- | --- |
| Konten und Buchungen sind eine Seite | 69816b9 — `AccountsHero`, /spending → Redirect, `e2e/accounts-unified.spec.ts` |
| Monatsletzter als Rhythmus | 03b876d — `monthEnd`-Flag, Migration 0113, `tests/month-end.test.ts` |
| Umbuchungsziele repariert | 7815236 + d81886a — `makeRecurring` verlor `targetAccountId`, Migration 0112 |
| Einnahmen sind keine gespiegelten Ausgaben | e370d4d — Zahler statt Empfaenger, kein Umbuchen, `PlannedCashflow` statt Contract |
| Tabellen-Shell Batch 2 + 3 | 3eac048 + 0733724 — 8 nutzerseitige + 7 /admin-Tabellen auf `Table`/`useSort` |
| Mobile-Nav bleibt unten | `min-h-dvh` statt Prozent-Kette (nicht reproduziert, kein WebKit lokal) |
| Rentenpunkte: Gesamtstand + Deckel | `totalPoints`, `pension_reference.max_points`, Migration 0111 |
| Sondertilgung ist live, /debt entschlackt | Store-Seam raus, Migration 0110, Graph + Regler in eine Karte |

### Runde 2026-07-31

| Task | Commit / Umfang |
| --- | --- |
| Tabellen-Shell Batch 1 | goals, dividends, asset-table, rebalancing, risk; `Th after` fuer InfoTips |
| Zeilen-Aktionen vereinheitlicht | 4506d27 — `components/ui/row-actions.tsx` + 8 Tabellen |
| Tooltips ohne Ortsangaben | 17 Keys x 3 Sprachen entlokalisiert |
| KPIs der Uebersicht | Sparquote + Abgedeckte Monate auf `/`, Depot-Satz bleibt auf /portfolio |
| Konto-Buchungen (5 Punkte) | Umbuchen in der Maske, Zukunftsdatum, `PlannedCard` tot → raus |
| Vertraege in wiederkehrende Zahlungen aufgegangen | 2a17c49 — /contracts weg |
| Verbindlichkeiten: Sondertilgung, Verlauf, Einmalzahlungen | abe1457, 2124eda, 668ac5d |
| Rente (Punkte, Niveau, Versicherungen) | Migration 0106, `lib/finance/pension.ts` |
| Asset-Preise: gepinnte Listings | Migration 0107, `lib/server/quote-policy.ts` |
| Kurse fehlten (IE00BMVB5N38) | 0e5fae2 — Cron verschluckte Yahoo-Fehler, uebersprang onvista |
| Resilience: kaputte Tabelle killt die App nicht mehr | 3e9c085 — `degraded` + Banner |
| Admin feature usage | 0bd639f — /admin/usage, Migration 0108/0109 |
| Cookie-Banner geprueft | 2c856b1 — keins noetig, alles technisch notwendig |
| CLAUDE.md aufgeraeumt | 1025 → 682 Zeilen, MONETIZATION.md + DOCUMENTATION.md |

### Runde 2026-08-02

| Task | Commit / Umfang |
| --- | --- |
| Konto-Eintrag ans Sidebar-Ende | `Sidebar` bekommt einen eigenen Footer, Header behaelt das Avatar nur unter `md` |
| Handlungsbedarf in der Navigation | `lib/notifications/` (rein + Hook), Zaehler auf Sidebar und MobileNav |
| Sparplan mit Verrechnungskonto | Migration 0116, `savingsPlanId` zaehlt als Umbuchung, nicht als Ausgabe |
| Ausgabeaufschlag bei managed Fonds | `lib/finance/front-load.ts`, Kauf zum Ausgabepreis, Aufschlag als Gebuehr |
