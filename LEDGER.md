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
| Einmalzahlungen in die PLAN-Simulation | HIGH | todo | siehe Plan unten |
| Cookie-Banner prüfen | HIGH | todo | components/legal/* |
| KPIs: Asset-Risikometriken | MEDIUM | todo | — |
| Wiederkehrende Zahlungen: Änderungsumfang abfragen | MEDIUM | todo | — |
| Analysen: Admin feature usage | MEDIUM | todo | — |
| Demo-SQL erweitern | LOW | todo | supabase/ |
| LLM: neue Daten aufnehmen | LOW | todo | lib/llm/context.ts |
| Download/Export erweitern | LOW | todo | lib/export/ |
| Monte Carlo: dynamische Entnahme + Vereinheitlichung | LOW | todo | — |
| Tooltips überarbeiten | — | todo | — |

## Plan: Einmalzahlungen im Tilgungsplan (Owner-Korrektur 2026-07-31)

Falsch gebaut: der Einmalzahlungs-Editor sitzt im Konditionen-Dialog pro
Verbindlichkeit (`DebtDetailsDialog`) und liest sich dort wie eine echte
Tilgung -- was eine Umbuchung bei Ein- & Ausgaben genauso erledigt.

Gewollt: neben der zusaetzlichen Monatsrate in der Plankarte, als reine
Was-waere-wenn-Eingabe der Verlaufssimulation. Nichts wird gebucht.

1. `components/debt/debt-view.tsx`: Editor (Datum + Betrag + Ziel-Verbindlichkeit)
   in die Plankarte neben `extraMonthly`, Liste der geplanten Einmalzahlungen
   darunter, jede loeschbar.
2. `DebtDetailsDialog`: Abschnitt Sondertilgungen raus, Dialog behaelt Zins,
   Rate, Zinsbindung. `debt.list.editDetails` zurueck auf Zins/Rate-Wortlaut
   (en/de/es), Keys `debt.repayments.*` wandern in die Plankarte.
3. Speicher bleibt `account_extra_repayments` + `setExtraRepayments` (Migration
   0105, nicht loeschen) -- Ziel-Verbindlichkeit ist die accountId.
4. `planPayoff`/`amortizationSchedule` bleiben unveraendert: `lumpSums` kann
   beides schon, debt-view fuettert sie bereits.
5. Verifizieren: Betrag eintragen -> Restschuld-Chart und "Zeit bis
   schuldenfrei" aendern sich sichtbar; e2e in `e2e/` ergaenzen.
