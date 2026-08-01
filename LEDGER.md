# LEDGER

Mandatory claim file (CLAUDE.md). Claim a task here BEFORE delegating to a
subworker; commit only the paths you claimed. Finished rounds get one line —
die Begruendung hinter einer Aenderung gehoert in DOCUMENTATION.md oder in den
Commit, nicht hierher.

## Offen fuer den Owner: Migrationen

Diese Migrationen sind geschrieben, aber noch nicht gegen die Live-Datenbank
gelaufen. Bis dahin quittiert die betroffene Tabelle einen 400/500:

| Migration | Wirkung ohne sie |
| --- | --- |
| 0108 + 0109 | `/admin/usage` laeuft auf 500 |
| 0111 | Rentenpunkte-Deckel greift nicht (`max_points` fehlt) |
| 0112 | Datenreparatur: verlorene Umbuchungsziele bleiben `null` |
| 0113 | `contracts`/`planned_cashflows` quittieren `month_end` mit 400 |
| 0114 | Die Retry-Queue der Kurs-Cron bleibt aus (Sync laeuft normal weiter) |
| 0115 | Nur die Flag-Beschreibung in `/admin/flags` bleibt alt |

0112 traegt oben eine reine Lese-Abfrage, mit der sich der Umfang vorher
ansehen laesst.

## Aktive Claims

| Task | Prio | Status | Paths |
| --- | --- | --- | --- |
| — | — | — | — |

## Offen (TODO.md)

| Task | Prio | Warum noch offen |
| --- | --- | --- |
| Monte Carlo: dynamische Entnahme, Stresszenarien, FIRE/Simulation vereinheitlichen | LOW | groesster Brocken, eigene Runde |

## Erledigt

### Runde 2026-08-01 (dritter Teil)

| Task | Commit / Umfang |
| --- | --- |
| FIRE + Rente unter einem Navipunkt | `/retirement` mit Tab-Strip, `/fire` + `/pension` leiten weiter, `routeFeatureState` fuer Mehrfach-Flags, `e2e/retirement.spec.ts` |
| Tab-Strip einmal statt viermal | `components/ui/tabs.tsx`, uebernommen von /analysis, Settings und dem Simulations-Modell |
| Kontenauswahl ist ein Multiselect | `SelectMenu` bekommt `multiple`, leere Auswahl = alle Konten, `e2e/accounts-unified.spec.ts` erweitert |
| LLM-Kontext kennt den Rest der App | Buchungen, Budgets, Wiederkehrendes, Ziele, Rente, FIRE, Watchlist, Tags — je hinter dem eigenen Flag; `/datenschutz` nachgezogen |
| Export umfasst alles | Ein Abschnitt je Entitaet, leere fallen weg; `parseFinTrack` begrenzt Abschnitte; JSON traegt den API-Key nicht mehr; `hasExportableData` statt "nur Depot"; `tests/export.test.ts` |
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
