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
| Resilience: eine kaputte Tabelle killt die App | HIGH | done (3e9c085) | supabase-store `degraded`, components/portfolio/degraded-banner.tsx |
| Rente: 17 Punkte -> 20k/Monat | HIGH | done, Migration 0111 muss laufen | lib/finance/pension.ts, lib/types.ts, lib/store/supabase-store.ts, lib/pension/, components/pension/, dictionaries, migration 0111, tests/pension.test.ts, e2e/pension.spec.ts |
| Tabellen-Shell Batch 1 | HIGH | done | goals-view, dividends-view, asset-table, rebalancing-view, risk-view, ui/table.tsx (`after`) |
| Demo-SQL erweitern | LOW | todo | supabase/ |
| LLM: neue Daten aufnehmen | LOW | todo | lib/llm/context.ts |
| Download/Export erweitern | LOW | todo | lib/export/ |
| Monte Carlo: dynamische Entnahme + Vereinheitlichung | LOW | todo | — |
| Tooltips überarbeiten | MEDIUM | done | 17 Keys x 3 Sprachen entlokalisiert, shared-portfolio-view übersetzt |
| Vereinheitlichung: Tabellen-Shell | HIGH | teilweise (3 von 22) | debt-view, spending-view, accounts-view auf Table/Thead/Th/Tr/Td + useSort |
| Tabellen-Shell Batch 2 (nutzerseitig) | HIGH | done | debt-repayments, recurring/[kind]/[id], account-balances-dialog, valuation-section, recurring-card, savings-plans-card, asset-detail, shared-portfolio-view, e2e/table-shell.spec.ts |
| Tabellen-Shell Batch 3 (/admin) | HIGH | done (nicht browser-verifiziert, /admin braucht Supabase) | app/admin/{billing,flags,usage,audit,errors,prices} |
| Ein-/Ausgaben: 4 gemeldete Punkte | HIGH | done | spending-view, ui/row-actions (RecurringAction), dictionaries, e2e/income.spec.ts |
| Ein-/Ausgaben: Ledger-Spalte + Ziel-Spalte | HIGH | done | recurring-card, dictionaries; dabei Umbuchungsziel-Bug gefunden, Migration 0112 |
| Monatsletzter als Rhythmus | MEDIUM | done, Migration 0113 muss laufen | dates.ts, planned.ts, contract-bookings.ts, types, supabase-store, spending-view, recurring-form, planned-form, migration 0113 + schema.sql, tests/month-end.test.ts |
| Sondertilgung: LIVE statt persistiert | HIGH | done | debt-repayments (controlled), debt-view, Store-Seam raus, Migration 0110, e2e/debt.spec.ts |
| /debt-Layout entschlackt | HIGH | done | Graph + Regler in eine Karte oben, Tilgungsreihenfolge in die Tabelle, 6->4 Kennzahlen |

## Erledigt: Monatsletzter als Rhythmus (2026-08-01)

Gemeldet: "Es waere noch cool wenn durch einen Mechanismus der Monatsletzter
gewaehlt werden koennte."

Der vorhandene Tag-Clamp in `addMonthsToDate` kann das nicht ausdruecken. Er
laeuft vom Startdatum los und kuerzt nur dort, wo der Zielmonat kuerzer ist -
ein Eintrag mit Anker auf dem 28. bleibt also fuer immer auf dem 28. Wer am
31. startet, bekommt zufaellig Monatsende; wer im Februar anfaengt, nie.

Deshalb ein **gespeichertes Flag** (`monthEnd`) statt einer Herleitung aus dem
Startdatum: ein Start am 30. ist zwischen "der 30." und "der letzte Tag" echt
mehrdeutig, und Raten waere hier gleichbedeutend damit, eine Zahlung zu
verschieben, um die niemand gebeten hat.

- Rein: `lastDayOfMonth` (dates.ts), `plannedOccurrenceAt` und
  `bookingOccurrenceAt` schnappen darauf ein. WEEKLY und ONCE bleiben aussen
  vor - "letzter Tag des Monats, woechentlich" ist kein Rhythmus, und eine
  Einmalzahlung ist ein Datum, das der Nutzer selbst gesetzt hat.
- Store-Seam: `Contract.monthEnd` + `PlannedCashflow.monthEnd`, Migration 0113
  **und** schema.sql (die planned-Spalte muss NACH ihrem `create table`
  stehen, sonst baut eine frische Datenbank nicht). Default `false`, also
  verschiebt der Deploy keinen einzigen bestehenden Eintrag.
- UI: eine Checkbox unter dem Rhythmus in der Erfassungsmaske, im
  Vertragsformular und im Planformular - nur dort, wo der Rhythmus
  monatsbasiert ist. Beim Speichern wird sie fuer einen unpassenden Rhythmus
  ausdruecklich auf `false` gesetzt, damit kein unsichtbares Flag zurueckbleibt.

Verifiziert auf Deutsch bei 1080p: Start 15.01.2026, monatlich, Haken gesetzt
-> faellig 31.01., 28.02., 31.03., 30.04., 31.05., 30.06., 31.07., naechste
31.08. Neu `tests/month-end.test.ts` (11 Tests, inkl. Schaltjahr) plus ein
E2E-Test. 1103 Unit-Tests, 57 E2E gruen, Build sauber.

**Offen fuer den Owner: Migration 0113 muss laufen.** Vorher kassiert
`contracts`/`planned_cashflows` bei `month_end` einen 400.

## Erledigt: Einnahmen sind keine gespiegelten Ausgaben (2026-08-01)

Vier gemeldete Punkte, alle in `spending-view` plus ein neues Row-Action-Icon.

1. **Die Maske aendert sich jetzt beim Umschalten.** Vorher war sie fuer
   Ausgabe und Einnahme zeichengleich.
2. **"Empfaenger" wird bei Einnahmen zu "Zahler"** (`spending.form.payerLabel`,
   Platzhalter "z. B. Arbeitgeber", en/de/es). Geld raus hat einen Empfaenger,
   Geld rein eine Quelle - den Arbeitgeber beim Gehalt "Empfaenger" zu nennen
   war schlicht verkehrt herum.
3. **"Umbuchung auf" faellt bei Einnahmen weg.** Das Feld beschreibt Geld, das
   DIESES Konto Richtung eines anderen eigenen verlaesst; bei einer Einnahme
   kommt es an, die Frage hatte also keine Antwort. Ein vor dem Umschalten
   gesetzter Wert wird geleert, sonst wuerde aus einem unsichtbaren Feld
   heraus gebucht. Dieselbe Umbuchung wird als Ausgabe auf dem Konto erfasst,
   das sie tatsaechlich verlaesst.
4. **"Als wiederkehrend anlegen" gibt es jetzt auch bei Einnahmen.** Es fehlte
   dort mit Grund: ein `Contract` ist eine Zahlungs-Verpflichtung (unsigniert,
   immer als Geld raus dargestellt), ein Gehalt darin haette wie eine
   Dauerlast gelesen. Loesung ist nicht, die Regel zu beugen, sondern die
   passende Entitaet zu nehmen: Einnahmen werden zu einem `PlannedCashflow`
   (signiert), Ausgaben bleiben ein Contract. Die Karte fuehrt beide ohnehin
   zusammen, der Nutzer sieht den Unterschied nie. Angeboten wird es jetzt
   fuer jede Zeile, die noch an keinem wiederkehrenden Eintrag haengt.
5. **Der Stilbruch ist weg.** Die Aktion war ein beschrifteter Textbutton
   zwischen zwei Icons - jetzt `RecurringAction`, ein Kreispfeil, mit dem
   bisherigen Wort als Accessible Name und Tooltip. Titel und Text der
   Rueckfrage sind neutral formuliert ("Eintrag" statt "Zahlung"), weil sie
   jetzt auch fuer Einnahmen erscheinen.

Verifiziert im Browser auf Deutsch bei 1080p (Zahler + kein Umbuchen bei
Einnahme, Empfaenger + Umbuchen bei Ausgabe, drei Icons auf beiden
Ledger-Zeilen, Ziel-Spalte mit Verbraucht / Hauskredit / Gutschrift, null
Konsolenmeldungen). Neu `e2e/income.spec.ts` (4 Tests). 1092 Unit-Tests,
56 E2E gruen.

Nachgereicht, zwei weitere gemeldete Punkte:

6. **Die Ledger-Spalte heisst "Empfaenger / Zahler"** (en "Payee / payer", es
   "Beneficiario / pagador"). Die Tabelle mischt beide Richtungen, also nennt
   die Ueberschrift beide - genau wie ein Kontoauszug es tut. Ein Gehalt unter
   "Empfaenger" war dort so verkehrt herum wie in der Maske.
7. **Die Wiederkehrend-Karte hat eine Spalte "Ziel"** (sortierbar wie der
   Rest): der Name des eigenen Kontos, auf das umgebucht wird, sonst
   "Verbraucht" bei Ausgaben und "Gutschrift" bei Einnahmen. Vorher stand dort
   nur das Konto, VON dem gebucht wird - eine Kreditrate, die eine Schuld
   tilgt, und ein Abo, das weg ist, lasen sich identisch.

**Dabei einen echten Fehler gefunden**, den erst diese Spalte sichtbar gemacht
hat: `makeRecurring` setzte `targetAccountId`/`transferAccountId` hart auf
`null`. Eine Buchung mit Umbuchungsziel verlor es also beim Anlegen als
wiederkehrend - aus der Kreditrate wurde stillschweigend eine verbrauchte
Ausgabe, die die Schuld ab dem Monat nicht mehr tilgte. Wird jetzt
uebernommen, `e2e/income.spec.ts` pinnt es.

**Produktionsdaten muessen bereinigt werden: Migration 0112.** Der Fix wirkt
nur auf NEUE Eintraege; alles, was vor dem Fix ueber "Als wiederkehrend
anlegen" aus einer Umbuchung entstanden ist, hat `target_account_id` bis heute
auf `null`. 0112 holt das Ziel aus der Buchung zurueck, die den Eintrag
gesaet hat (die einzige verknuepfte Zeile, die selbst noch ein Ziel traegt),
und markiert die davon erzeugten Buchungen nach. Nur eindeutige Faelle werden
angefasst (`having count(distinct ...) = 1`), Schritt 2 nur fuer die in
Schritt 1 reparierten Vertraege - ein Vertrag, der sein Ziel schon hatte, ist
kein Indiz fuer diesen Bug. Reine Datenreparatur, `schema.sql` bleibt bewusst
unberuehrt (eine frische Datenbank hat diese Zeilen nicht).

Folge, bevor sie ueberrascht: Ausgaben-Summen der Vergangenheit SINKEN, weil
Umbuchungen weder Einnahme noch Ausgabe sind. Das ist der korrigierte Stand,
nicht ein neuer Fehler. Die Datei traegt oben eine reine Lese-Abfrage, mit der
sich der Umfang vorher ansehen laesst.

Syntaktisch geprueft (pglast, SQL + PL/pgSQL-Rumpf; alle Migrationen parsen).
**Nicht gegen eine echte Datenbank ausgefuehrt** - lokal laeuft kein Postgres
(nur der psql-Client, kein Docker-Daemon), und ohne Supabase-Keys gibt es
keine Testinstanz. Vor dem Anwenden also die Lese-Abfrage.

**Nicht angefasst, bewusst:** der Bearbeiten-Dialog zeigt "Umbuchung auf" auch
bei Einnahmen weiter an. Dort kann eine BESTEHENDE Zeile den Wert schon
tragen, und ein Feld auszublenden, das etwas enthaelt, verwirft still
Nutzerdaten.

## Erledigt: Tabellen-Shell, Batch 3 - /admin (2026-08-01)

Die letzten sieben Tabellen: billing, flags (zwei), usage, audit, errors,
prices. Vier weitere lokale Header-Komponenten sind weg (`GrantTh`, `SortTh`
und zweimal ein `Th`, das den geteilten sogar namensgleich verdeckte), dazu
vier `compare`-Funktionen, die zu reinen `sortValue`-Funktionen werden.

Die Audit-Tabelle war die einzige in der App **ganz ohne** Sortierung und
**ohne** Hover-Hervorhebung - jetzt beides, sortierbar nach Zeitpunkt, Akteur,
Aktion und Ziel. Die beiden JSON-Spalten bleiben bewusst unsortierbar.

Zwei Verhaltensaenderungen, beide absichtlich und im Code kommentiert: eine
Pro-Freigabe ohne Ablaufdatum und eine Instrumentenzeile ohne Kurs bzw. ohne
Sync-Zeitpunkt standen bisher per `Infinity` bzw. `-1` mal ganz oben, mal ganz
unten. Jetzt gilt fuer sie dieselbe Regel wie ueberall sonst (`sortRows`):
fehlende Werte stehen in **beiden** Richtungen hinten. "Laeuft nie ab" ist kein
Datum, und "nie synchronisiert" ist kein Kurs.

Aufgeklappte Detailzeilen (audit, errors) nutzen jetzt `Tr selected` statt
eines eigenen `bg-zinc-50`.

**Nicht im Browser verifiziert**: /admin verlangt eine Supabase-Admin-Session,
lokal laeuft nur der Gast-Modus, und die Routen leiten dort auf die Uebersicht
um (geprueft: sechsmal Redirect, null Konsolenmeldungen). Abgesichert ist es
ueber Typecheck, Lint und einen sauberen Produktions-Build; das Markup ist
derselbe Shell wie auf den nutzerseitigen Seiten, die verifiziert sind.

## Erledigt: Tabellen-Shell, Batch 2 (2026-08-01)

Der Ledger nannte drei offene Dateien, gezaehlt waren es acht nutzerseitige
plus sechs unter /admin. Batch 2 nimmt die acht: debt-repayments,
recurring/[kind]/[id], account-balances-dialog, valuation-section,
recurring-card, savings-plans-card, asset-detail (zwei Tabellen) und
shared-portfolio-view.

Weg sind sieben handgebaute `useState({key,dir})` samt Toggle und
Inline-Comparator und drei lokale Header-Komponenten, die den Sortier-Button
je einmal nachgebaut hatten (`PlanTh` zweimal, `TxTh`, `SortTh`). Vier
Tabellen waren gar nicht sortierbar und sind es jetzt (Owner-Regel): die
Sondertilgungen, die Buchungsliste einer wiederkehrenden Zahlung (dort waren
Empfaenger und Kategorie tote Header), die Faelligkeitsliste im
Sparplan-Review und die Kontostaende.

Zwei Dinge fielen dabei nebenbei auf und sind mitgenommen:

1. **Vier Tabellen hatten noch eigene Zeilen-Aktionen** (ein handgebautes
   Bleistift-SVG plus ✕) statt `RowActions` - genau die Gabelung, die Runde 24
   fuer acht andere Tabellen schon geschlossen hatte. Jetzt ueberall dieselben
   Icons mit demselben Accessible Name.
2. **`sortRows` kann "fehlt sortiert immer zuletzt" von Haus aus**, also faellt
   die handgeschriebene Sonderbehandlung fuer Eintraege ohne naechstes Datum
   in `recurring-card` weg - dieselbe Regel, nur nicht mehr doppelt.

Drei Spalten bleiben bewusst unsortierbar: Kurs, Gebuehr und Stueckzahl im
Sparplan-Review sind Eingabefelder, und eine Umsortierung waehrend des Tippens
zoege dem Nutzer das Feld unter dem Cursor weg.

Verifiziert im Browser auf Deutsch bei 1080p: /portfolio 6, /spending 4,
/accounts 3, Asset-Detail 9 sortierbare Header, null verschachtelte Buttons,
null Konsolenmeldungen. Neu `e2e/table-shell.spec.ts` (4 Tests) pinnt
`aria-sort`, das Sortieren per Enter und den deutschen Fall. 1092 Unit-Tests,
52 E2E gruen.

Offen (Batch 3): 6x /admin (billing, flags, usage, audit, errors, prices).

## Teilweise: Tabellen-Shell, Batch 1 von 2 (2026-08-01)

Der Ledger-Stand "3 von 22" war veraltet: gezaehlt sind es 18 Dateien, die den
Shell schon importieren, und 7 mit rohem `<table>`. Batch 1 nimmt die fuenf
nutzerseitigen: goals-view, dividends-view, asset-table, rebalancing-view,
risk-view. Weg sind fuenf handgebaute `useState({key,dir})` samt Toggle und
Inline-Comparator; drei Tabellen ("Nach Position" bei Dividenden, "Frueher
gehalten" bei den Positionen, die Zielallokation im Rebalancing) waren gar
nicht sortierbar und sind es jetzt (Owner-Regel).

Dabei eine echte Ergaenzung am Shell statt einer Kopie: `Th` bekommt `after`.
Die Risiko-Tabelle haengt an jede Spalte einen `InfoTip`, und der ist selbst
ein `<button>` - im Sortier-Button verschachtelt ergibt das ungueltiges HTML,
das React beim Hydrieren anmeckert. Der Subworker hatte dafuer den kompletten
Sortier-Button in `risk-view` nachgebaut, also genau die Gabelung, gegen die
dieser Task laeuft. Jetzt rendert der Shell den Tip als Geschwister. Der Tip
folgt seinem Label auch in rechtsbuendigen Spalten (der Sortierpfeil dreht
sich dort, der Tip nicht) - so wie jeder andere InfoTip in der App.

Verifiziert im Browser bei 1080p: /portfolio 6, /rebalancing 5, /dividends 4,
/analysis-Risiken 6 sortierbare Header, `aria-sort` kippt per Klick, null
verschachtelte Buttons, null Konsolenfehler. 1092 Unit-Tests, 48 E2E gruen.

Offen (Batch 2): risk-view ist durch, es bleiben debt-repayments,
recurring/[kind]/[id] und 3x /admin (billing, flags, usage).

## Erledigt: 17 Rentenpunkte waren keine 20k Rente (2026-08-01)

Die Renteninformation nennt einen **Gesamtstand** ("Sie haben bisher 17,0322
Entgeltpunkte erworben"); die Aufteilung pro Jahr steht im
Versicherungsverlauf, den niemand abtippt. Die Seite bot aber nur "Jahr +
Punkte" an, also landeten die 17 in einer Jahreszeile - und
`averageAnnualPoints` las das als 17 Punkte **pro Jahr**, rechnete es ueber 32
Restjahre hoch und meldete rund 20.000 EUR im Monat.

Zwei Antworten:

1. **Der Gesamtstand bekommt ein eigenes Feld** (`totalPoints` +
   `totalPointsYear` in `pension_settings`, gelesen von
   `currentPensionPoints`). Jahreszeilen NACH dem Stichjahr kommen obendrauf,
   genau wie die naechste Renteninformation sie zaehlen wird. Die
   Jahr-fuer-Jahr-Tabelle ist jetzt ausdruecklich das optionale Detail.
2. **Die Annahme pro Restjahr wird gedeckelt** auf das, was ein Jahr
   ueberhaupt bringen kann (`pension_reference.max_points` =
   Beitragsbemessungsgrenze / Durchschnittsentgelt, ~2,0). Reference Data wie
   der Rentenwert daneben, also **kein Deckel ohne Zeile** statt einer
   Konstante im Finanzkern. Gedeckelt wird sichtbar (`annualPointsCapped`),
   nicht stillschweigend, und das Eingabefeld warnt schon beim Tippen.

`usePensionReference` selektiert jetzt `*`: eine Datenbank ohne 0111 haette
sonst bei `max_points` einen 400 kassiert und dabei den Rentenwert mitverloren
- Euro-Werte weg wegen einer Spalte, die nur plausibilisiert. Fehler wird
gemeldet statt verschluckt.

Verifiziert: 17 Punkte + Jahrgang 1990 ergeben 17 + 32 x 1,91 Punkte statt
17 + 32 x 17. 1092 Unit-Tests, 9 E2E auf /pension gruen (inkl. der
Du-Form-Pruefung fuer die neue deutsche Copy), DE im Browser bei 1080p.

**Offen fuer den Owner: Migration 0111 muss laufen.** Vorher greift der Deckel
nicht (kein `max_points` = kein Deckel), das Gesamtstand-Feld funktioniert aber
schon, weil `pension_settings` ein jsonb-Blob ist.

## Teilweise: Tabellen auf den gemeinsamen Shell (2026-07-31)

`components/ui/table.tsx` (Table/Thead/Th/Tbody/Tr/Td) und `useSort` gab es
schon, aber nur 3 von 25 Tabellen nutzten sie - der Rest baute die Header-Klasse
selbst. Gemessen: 11 verschiedene Header-Stile, 10 Hover-Varianten.

Migriert: debt-view, spending-view, accounts-view. Dabei faellt je ein
handgebautes `useState({key,dir})` + Toggle + Inline-Comparator weg
(`useSort`/`sortRows`), und die Header werden zu echten Buttons mit `aria-sort`
- vorher waren es `<th onClick>`, also per Tastatur unerreichbar. Verifiziert:
Sortierung per Maus und per Enter, aria-sort kippt korrekt, Header-Klassen auf
/accounts und /debt identisch.

Offen: die restlichen ~19 Tabellen (Assets, Dividenden, Rebalancing, Risiko,
Ziele, Sparplaene, Wiederkehrende, shared-view, 6x /admin).

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
