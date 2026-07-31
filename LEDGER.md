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
| Konto-Buchungen (5 Punkte) | HIGH | done | spending-view (Umbuchung + Zukunftsdatum), recurring-card (Add-Button weg), planned-form.tsx (aus planned-card extrahiert), select-menu a11y, e2e/recurring.spec.ts neu |
| PlannedCard toter Code | — | done | Flag `plannedCashflow` ist NICHT stale: forecast-card + LLM-Kontext gaten weiter darauf |
| KPIs: Übersicht war "nur Depot" | MEDIUM | done | net-worth-hero (Sparquote + Abgedeckte Monate statt G/V-Paar, nur auf /), e2e/dashboard-kpis.spec.ts |
| Demo-SQL erweitern | LOW | todo | supabase/ |
| LLM: neue Daten aufnehmen | LOW | todo | lib/llm/context.ts |
| Download/Export erweitern | LOW | todo | lib/export/ |
| Monte Carlo: dynamische Entnahme + Vereinheitlichung | LOW | todo | — |
| Tooltips überarbeiten | MEDIUM | done | 17 Keys x 3 Sprachen entlokalisiert, shared-portfolio-view übersetzt |
| Sondertilgung: LIVE statt persistiert | HIGH | done | debt-repayments (controlled), debt-view, Store-Seam raus, Migration 0110, e2e/debt.spec.ts |
| /debt-Layout entschlackt | HIGH | done | Graph + Regler in eine Karte oben, Tilgungsreihenfolge in die Tabelle, 6->4 Kennzahlen |

## Erledigt: Tooltips zeigen nicht mehr auf andere Elemente (2026-07-31)

17 Keys sagten dem Nutzer, wo er hinschauen soll: "Add one above", "Set target
weights below.", "Adjust the parameters on the left", "Full breakdown listed
below." Ortsangaben sind auf dem Handy schlicht falsch (links wird oben), und
sie beschreiben, was der Nutzer ohnehin sieht. Alle drei Sprachen entlokalisiert
und dabei gekuerzt.

Nicht angefasst: "above 1 amplifies its swings", "ended above this value",
"Pairs above 0.8" - das ist Mathematik, keine Wegbeschreibung.

`shared-portfolio-view.tsx` hatte zwei fest verdrahtete englische InfoTips,
obwohl die Datei `useI18n` schon nutzt - einer davon ("Click a column to sort.")
genau das gemeldete Muster, und dazu ueberfluessig, weil jede Tabelle sortierbar
ist. Jetzt `shared.allocationTip` / `shared.holdingsTip` in en/de/es.

1082 Unit-Tests (inkl. es-Key-Paritaet), 46 E2E gruen.

## Erledigt: Sondertilgung ist live, /debt entschlackt (2026-07-31)

**Live statt gespeichert (Owner-Regel).** 0105 hatte Sondertilgungen eine
Tabelle gegeben, also schrieb jede Eingabe eine Zeile - eine Simulation sah aus
wie eine Zusage. Der Hebel direkt darueber (zusaetzliche Monatsrate) war immer
schon reines React-State. Jetzt beide gleich: `lumpSums` liegt in `DebtView`,
`DebtRepaymentsPlanner` ist controlled (`value`/`onChange`), mehrere
Sondertilgungen stapeln sich in der Liste, ein Reload vergisst alles.

Der ganze Store-Seam ist raus: `ExtraRepayment`, `PortfolioData.extraRepayments`,
`setExtraRepayments` in DataStore/Local/Supabase/Offline, Queue-Op, Sync-Case,
Context. Migration 0110 droppt `account_extra_repayments` und nimmt es vorher
aus `admin_feature_usage()` (sonst 500). 0105 bleibt liegen. Tote Keys entfernt
(`debt.repayments.error`, `admin.usage.feature.extraRepayments`).

**Layout.** Der Graph stand hinter zwei Karten, und "Zeit bis schuldenfrei" plus
"Zinsen" standen doppelt auf der Seite. Neu: Kennzahlen (6 -> 4, "urspruenglich"
und "getilgt" als Unterzeile), dann Tilgungsplan MIT Graph in einer Karte
(Regler direkt ueber der Kurve, die sie bewegen), dann die Tabelle - die
Tilgungsreihenfolge ist jetzt eine Spalte darin statt einer eigenen Karte,
Zinsbindung ruecht unter den Zinssatz. Graph beginnt bei y=815 statt hinter der
Tabelle. Ausschweifende Intro-Texte gekuerzt (Owner-Regel: kurz und praezise).

Verifiziert DE 1080p: 26 Jahre 6 Monate -> 19 Jahre 8 Monate, Zinsen
146.667,48 -> 94.169,98, Ersparnis-Zeile 52.497,49 = die Differenz. 1082
Unit-Tests, 46 E2E gruen.

## Erledigt: KPIs der Übersicht (2026-07-31)

Vier der sechs Hero-Kennzahlen waren reine Depot-Zahlen (nicht realisiert,
realisiert, Dividenden, IZF) - auf einer Seite, die auch für Konten, Schulden
und Ausgaben geradesteht. Auf `/` weichen jetzt das G/V-Paar der
Alltagsgeld-Paarung **Sparquote** + **Abgedeckte Monate**; `/portfolio`
(`investmentsOnly`) behält den Depot-Satz unverändert, dort SIND die Zahlen
das Thema.

Kein neuer Rechenweg und kein einziger neuer Dictionary-Key: `/health` hatte
`computeFinancialHealth` schon als reine, getestete Funktion, und deren
Doc-Kommentar zeigt sogar auf genau die Nettovermögens-Zahl des Heroes. Labels
und Hints kommen aus `health.gauge.*`, also dieselben Worte wie auf /health.
Gegatet über `useFeatureFlag("finHealth")` plus Null-Prüfung (ohne Daten steht
dort "Noch nicht genug Daten", keine erfundene Null).

Verifiziert DE im Browser (Sparquote +60,00 % aus 3.000 ein / 1.200 aus,
Abgedeckte Monate 2,3 aus 2.750 liquide / 1.200) und EN über
`e2e/dashboard-kpis.spec.ts`, das beide Seiten gegeneinander pinnt.
1082 Unit-Tests, 45 E2E gruen.

## Erledigt: Konto-Buchungen (2026-07-31)

Alle fuenf Punkte aus dem TODO-Block:

1. **Umbuchen direkt in der Maske.** Das Feld gab es nur im Bearbeiten-Dialog,
   also musste man erst falsch speichern und dann korrigieren. Jetzt steht
   "Umbuchung auf" mit demselben Wortschatz und derselben Hint-Zeile in der
   Erfassungsmaske, im Bearbeiten-Dialog und im Detail-Formular.
2. **Zukunftsdatum.** `max={today()}` ist weg. Der Bearbeiten-Dialog hat das
   Datum nie begrenzt, die Sperre hiess also nur "erst falsch speichern".
3. **Umbuchen auf einen Kredit** faellt aus (1): die Liste enthaelt jedes
   andere Konto, Verbindlichkeiten eingeschlossen. Verifiziert: 250 EUR auf
   den Autokredit gebucht, Kredit -10.000 -> -9.750, Giro 3.000 -> 2.750.
4. **Der doppelte Add-Knopf ist weg.** Die Karte hatte einen eigenen
   "Wiederkehrende Zahlung hinzufuegen"-Button, obwohl ihr eigener Leerzustand
   schon auf den Schalter oben zeigte. Vertraege entstehen weiterhin ueber
   "Als wiederkehrend anlegen" an einer Buchung.
5. **"Empfaenger" bleibt "Empfaenger"** bis ins Detail-Formular (hiess dort
   "Bezeichnung"). Dabei auch die Ausgabe/Einnahme-Wahl dort auf den
   gemeinsamen `SegmentedControl` gezogen.

Nebenbei: `PlannedCard` war toter Code und ist raus; `PlannedForm` lebt jetzt
in `components/spending/planned-form.tsx`. Das Flag `plannedCashflow` ist
**nicht** stale, `forecast-card.tsx` und der LLM-Kontext gaten weiter darauf.
Ausserdem trug im `SelectMenu` jede Option das Haekchen im Accessible Name
(nur transparent geschaltet) - jetzt `aria-hidden`.

Verifiziert in DE (Browser, 1080p) und EN (E2E-Suite): 1082 Unit-Tests,
44 E2E gruen, `e2e/recurring.spec.ts` auf die neuen Wege umgeschrieben.

## Erledigt: Einmalzahlungen im Tilgungsplan (Owner-Korrektur 2026-07-31)

Der Editor sass im Konditionen-Dialog pro Verbindlichkeit und las sich dort wie
eine echte Tilgung. Jetzt steht er als Was-waere-wenn-Eingabe in der Plankarte
neben der zusaetzlichen Monatsrate (`DebtRepaymentsPlanner`, Ziel-Verbindlichkeit
per SelectMenu). Gebucht wird nichts; Speicher unveraendert
(`account_extra_repayments`, Migration 0105). Verifiziert in DE + EN: eine
Sondertilgung von 25.000 EUR verkuerzt den Plan sichtbar (58 Monate,
44.582,41 EUR Zinsen gespart), `e2e/debt.spec.ts` pinnt es.
