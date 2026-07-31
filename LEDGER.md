# LEDGER

Mandatory claim file (CLAUDE.md). Claim a task here BEFORE delegating to a
subworker; commit only the paths you claimed.

## Session 2026-07-31 — working TODO.md

| Task | Prio | Status | Paths |
| --- | --- | --- | --- |
| Tour: navigation groups | HIGH | done (211aa11) | — |
| Verbindlichkeiten: Sondertilgungen | HIGH | done (abe1457) | — |
| Rente: Rentenpunkte, Rentenniveau, Rentenversicherungen | MEDIUM | done | lib/finance/pension.ts, lib/pension/, components/pension/, app/pension/, migration 0106, tests/pension.test.ts, e2e/pension.spec.ts |
| CLAUDE.md aufräumen | HIGHEST | done | CLAUDE.md 1025->682, MONETIZATION.md recreated, DOCUMENTATION.md +300 |
| Asset-Preise: A2PKXG falsch in UI | HIGH | fix shipped (pinned listings); awaiting user's asset-row currency | lib/server/quote-policy.ts, app/api/cron/sync/prices, migration 0107 |
| Verträge entfernen (in wiederkehrende Zahlungen aufgegangen) | HIGH | done (2a17c49) | /contracts weg, add+suggestions+delete in recurring-card, e2e/recurring.spec.ts |
| Sondertilgung nicht auffindbar | HIGH | done (2124eda) | Feature war da, Button hieß nur "Zinssatz & Zahlung" |
| Einmalzahlungen in die PLAN-Simulation | HIGH | done | components/debt/debt-repayments.tsx (neu), debt-view, debt-details-dialog, dictionaries, e2e/debt.spec.ts |
| Cookie-Banner prüfen | HIGH | done (2c856b1) | keins nötig, alles technisch notwendig |
| KPIs: Asset-Risikometriken | MEDIUM | done | components/assets/asset-risk-card.tsx, components/analysis/metric-card.tsx (geteilt), Dashboard-Dublette "Woraus es besteht" entfernt |
| Chart-Datumslabels folgten der Browser-Locale | — | done (f0af0e0) | performance-chart, trades/dividends/forecast |
| Wiederkehrende Zahlungen: Änderungsumfang abfragen | MEDIUM | done (33e246f) | app/recurring/[kind]/[id], recurring-card (Inline-Edit + Zurück), e2e/recurring.spec.ts; nebenbei Crash bei Eintrag ohne Buchungskonto gefixt |
| Verbindlichkeiten: Verlauf ab Kreditbeginn + Zeitfilter | HIGH | done (668ac5d) | debt-view, debt-chart, e2e/debt.spec.ts; "Ursprüngliche Summe" + "Bisher getilgt" |
| Analysen: Admin feature usage | MEDIUM | done (0bd639f), Migration 0108 muss noch laufen | app/admin/usage, app/api/admin/usage, migration 0108, /datenschutz |
| Vereinheitlichung: Zeilen-Aktionen | HIGH | done (4506d27) | components/ui/row-actions.tsx + 8 Tabellen; E2E-Suite repariert (add-asset auf /portfolio, planned.spec) |
| /admin/usage 500 (transactions.user_id) | HIGH | done (69edff6) | Migration 0109 muss laufen |
| Kurse fehlen (IE00BMVB5N38) | HIGH | Ursache gefunden + Fix (0e5fae2) | Cron verschluckte Yahoo-Fehler und übersprang onvista; jetzt geloggt. Nach Deploy: /admin/prices -> Revalidieren |
| Ziele-Karte zählte 4, zeigte 3 | MEDIUM | done (0e5fae2) | area-cards: "+N weitere" |
| Demo-SQL erweitern | LOW | todo | supabase/ |
| LLM: neue Daten aufnehmen | LOW | todo | lib/llm/context.ts |
| Download/Export erweitern | LOW | todo | lib/export/ |
| Monte Carlo: dynamische Entnahme + Vereinheitlichung | LOW | todo | — |
| Tooltips überarbeiten | — | todo | — |

## Erledigt: Einmalzahlungen im Tilgungsplan (Owner-Korrektur 2026-07-31)

Der Editor sass im Konditionen-Dialog pro Verbindlichkeit und las sich dort wie
eine echte Tilgung. Jetzt steht er als Was-waere-wenn-Eingabe in der Plankarte
neben der zusaetzlichen Monatsrate (`DebtRepaymentsPlanner`, Ziel-Verbindlichkeit
per SelectMenu). Gebucht wird nichts; Speicher unveraendert
(`account_extra_repayments`, Migration 0105). Verifiziert in DE + EN: eine
Sondertilgung von 25.000 EUR verkuerzt den Plan sichtbar (58 Monate,
44.582,41 EUR Zinsen gespart), `e2e/debt.spec.ts` pinnt es.
