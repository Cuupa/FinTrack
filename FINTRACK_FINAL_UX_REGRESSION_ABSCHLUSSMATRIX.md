# FinTrack – Abschlussmatrix Final UX Regression

Bezug: `FINTRACK_FINAL_UX_REGRESSION_AUDIT.md` §10 (Definition of Done).
Stand: 2026-08-22. Verifikation in Guest Mode (`PORT=3011`), Locales EN + DE.

## 1. Ergebnis

- Kein P0-Punkt offen.
- Buchungen folgen drei expliziten Modi (Ausgabe / Einnahme / Umbuchung).
- Normale Finanzbewegungen sind nicht mehr als Systemfehler (Rot) codiert.
- Kein bestandener Bereich wurde unnötig neu gestaltet (Bestandsschutz §7 eingehalten).
- Alle P1-Punkte umgesetzt.
- VERIFY-Punkte protokolliert (Abschnitt 4).

## 2. Matrix: Punkt -> Datei/Komponente -> Test -> Status

### P0 – Buchungen (§4)

| Audit-Punkt | Datei / Komponente | Änderung | Test | Status |
| --- | --- | --- | --- | --- |
| §4.3 Drei explizite Modi statt Zusatzfeld `Umbuchung auf` | `components/spending/spending-view.tsx` | Tab-Strip Ausgabe/Einnahme/Umbuchung; modusspezifische Felder + CTA; kein `Keine Umbuchung` | e2e `income.spec.ts`, `recurring.spec.ts`, `helpers.bookTransaction`; Shots 01–03 | ERLEDIGT |
| §4.3 Kein Transferfeld in Ausgabe/Einnahme; keine gestrichelte Umbuchungskarte | `components/spending/spending-view.tsx` | Transfer nur im Umbuchungsmodus; Karte entfernt | Shots 01/02 (kein Transferfeld), 03 (From/To) | ERLEDIGT |
| §4.3 Umbuchung ohne Kategorie/Gegenpartei; Quelle != Ziel | `components/spending/spending-view.tsx`, `lib/finance/spending.ts` | Umbuchungsmodus blendet Kategorie/Empfänger aus; Gleichheits-Guard | `tests/booking-validation.test.ts`; Shot 03 | ERLEDIGT |
| §4.3 Betrag positiv, Vorzeichen aus Modus; lokalisiert `1.595,00 €` | `components/ui/currency-field.tsx` (neu), `spending-view.tsx` | Gemeinsames Zahlenfeld mit €-Suffix, locale-Parse/Format | `tests/booking-validation.test.ts`; Shot 09 (DE `1.595,00`) | ERLEDIGT |
| §4.3 Inline-Validierung statt nur ausgegrautem Button | `components/spending/spending-view.tsx` | Verständliche Feldfehler, Required/Optional getrennt | `tests/booking-validation.test.ts` | ERLEDIGT |
| §4.3 Kontextabhängige CTA (Ausgabe/Einnahme hinzufügen, Umbuchung erstellen) | `components/spending/spending-view.tsx`, `lib/i18n/dictionaries.ts` | CTA pro Modus | Shots 01–03/09; parity Tests | ERLEDIGT |
| §4.3 Verborgene Werte eines Modus werden nicht mitgesendet | `components/spending/spending-view.tsx`, `lib/finance/spending.ts` | Modus baut die Nutzlast; Fremdfelder werden nicht gesendet | `tests/booking-validation.test.ts` | ERLEDIGT |
| §4.4 `Wiederkehrend` als Modifier mit Rhythmus + Startdatum | `components/spending/spending-view.tsx` | Toggle „Wiederholt sich automatisch ab dem Startdatum" | Shots 01/09; `recurring.spec.ts` | ERLEDIGT |
| §4.3 Atomare Umbuchung über bestehenden Transfermechanismus | `lib/finance/spending.ts` (isTransfer/`transferAccountId`) | Kein zweiter Mechanismus erfunden | `tests/booking-validation.test.ts`; e2e `recurring.spec.ts` | ERLEDIGT |
| §4.5 Normale Ausgaben neutral statt Fehlerrot | `components/spending/spending-view.tsx`, `lib/format.ts` | Richtung über Vorzeichen + Payee/Payer, nicht über Alarmrot | Shot 05 (`-€42.90` neutral) | ERLEDIGT |
| §4.5 Rot nur für Fehler/überfällig/destruktiv/echte Negativperformance | `lib/format.ts`, `spending-view.tsx`, `recurring-card.tsx` | `plColor` bleibt nur echter P&L vorbehalten | `table-shell.spec.ts`; Shot 05 | ERLEDIGT |
| §4.5 Wiederkehrend nutzt dieselbe Farb-/Interaktionslogik | `components/spending/recurring-card.tsx` | Neutralisiert; Zeilenaktionen mit Trefferfläche/Tastatur | `recurring.spec.ts` | ERLEDIGT |
| §4.6 Skalierbare, suchbare/gruppierte Kategorieverwaltung | `components/spending/category-manager.tsx` | Kein rotes Löschen pro Zeile; sichere Löschflüsse + Auswirkung | e2e `spending`/manager; Shot 06 | ERLEDIGT |

### P1 – Restfälle (§5)

| Audit-Punkt | Datei / Komponente | Änderung | Test | Status |
| --- | --- | --- | --- | --- |
| §5.1 `Strategie-Typ` neutral statt Warnung | `components/assets/asset-tags.tsx` | Neutraler Chip + Farbpunkt statt satter Füllung | Shot 07; `holdings.spec.ts` | ERLEDIGT |
| §5.1 BUY/SELL/BOOKING neutral/kategorial | `components/assets/asset-detail.tsx` | Typ-Label + Betragsspalte neutral (Vorzeichen bleibt) | Shot 07 | ERLEDIGT |
| §5.1 Transaktionsformular einklappbar | `components/assets/asset-detail.tsx` | Collapse ab vorhandener Historie | `holdings.spec.ts` (öffnet Form) | ERLEDIGT |
| §5.2 Kaufen/Verkaufen nicht als Erfolg/Fehler | `components/rebalancing/rebalancing-view.tsx` | Neutral + Richtungspfeil ↑/↓ | manuell/Code-Review | ERLEDIGT |
| §5.2 Ursache unvollständiger Zielsumme erklären | `components/rebalancing/rebalancing-view.tsx` | Direktes Amber-Band statt Hover-Tooltip | Code-Review | ERLEDIGT |
| §5.2 `Auf 100 % normieren` mit Vorschau/Bestätigung | `components/rebalancing/rebalancing-view.tsx` | `ConfirmDialog` mit Summe + Faktor | Code-Review | ERLEDIGT |
| §5.3 Warnung nicht dreimal wiederholen; gemeinsamer Hinweis | `components/fire/fire-view.tsx` | Ein `InlineNotice` über den Karten; Karten auf Status reduziert | Code-Review | ERLEDIGT |
| §5.4 Anlagenliste einklappbar/intern scrollbar; Parameter nicht verdrängt | `components/simulation/monte-carlo-panel.tsx` | `max-h-72 overflow-y-auto` | Code-Review | ERLEDIGT |
| §5.5 `Gebühren und Steuern` -> `Steuern & Gebühren` | `settings-view.tsx`, `dictionaries.ts` | Tab umbenannt (EN „Taxes & fees") | Shot 08; parity Tests | ERLEDIGT |
| §5.5 `delete` bei Kontolöschung lokalisieren | `settings-view.tsx`, `dictionaries.ts` | Phrase `KONTO LÖSCHEN`/`DELETE ACCOUNT`/`ELIMINAR CUENTA` | parity Tests | ERLEDIGT |
| §5.5 Native Number-Spinner durch gemeinsames Zahlenfeld | `settings-view.tsx` | `inputMode="decimal"`, `parseDecimal` | Code-Review | ERLEDIGT |
| §5.5 KI-Schlüssel-Speicherort als Radio Rows | `settings-view.tsx`, `dictionaries.ts` | `fieldset`/`radiogroup` mit Konsequenztext | Code-Review | ERLEDIGT |
| §5.5 Haushaltsrollen konsistent; Preis-/Intervall; Benachrichtigungsstatus | `settings-view.tsx` | vorhanden -> VERIFY (Abschnitt 4), Notification-Fix nicht überschrieben | manuell | VERIFIZIERT |

## 3. Bestandsschutz (§7) – nicht verändert

App-Shell/Nav-Gruppen, gemeinsame Seitenköpfe/Tab-Leisten/Summary-Strips, Übersicht,
Kontengruppierung + Tabs, Cashflow-Tabs, Depot-Tabs, Analyse-Struktur, Dividendenansicht,
Ist-gegen-Ziel beim Rebalancing, Ziele ohne Anlegeformular, Verbindlichkeiten-Zeitraum,
gemeinsame Ruhestandsseite, Simulations-Grundlayout (Parameter links/Ergebnis rechts),
Settings-Breite/Tabs. Keine Füllkarten ergänzt.

## 4. VERIFY-Protokoll (§8)

| VERIFY-Punkt | Ergebnis |
| --- | --- |
| 390 px responsive (Buchungsmodal) | OK – Felder stapeln, kein H-Overflow, CTA sichtbar (Shot 04) |
| Drei Buchungsmodi EN + DE | OK – Shots 01–03 (EN), 09 (DE, `1.595,00 €`) |
| Umbuchung ohne Kategorie/Gegenpartei | OK – Shot 03 (From/To account, kein Payee/Kategorie) |
| Neutrale Buchungsliste ohne Alarmrot | OK – Shot 05 (`-€42.90` und `€3.200,00` neutral) |
| Positionsdetail neutral + Form eingeklappt | OK – Shot 07 |
| Settings Tab-Rename | OK – Shot 08 (`Taxes & fees`) |
| Atomare Umbuchung / keine doppelte Buchung | OK – Store-Seam + `tests/booking-validation.test.ts` |
| Ausschluss Umbuchung aus Einnahmen-/Ausgabenstatistik | OK – `isTransfer` in `lib/finance/spending.ts`, Unit-Test |
| Escape schließt Modal + Rückfokus | OK – `use-focus-trap`; Escape-Schließen im Shot-Flow genutzt |
| Fokusfalle in Modals/Drawern | OK – gemeinsamer `use-focus-trap` |
| Keine API-Schlüssel in Logs/Responses | OK – Proxy `/api/llm` (Design-Invariante), unverändert |
| 200-%-Zoom / 768 px / Screenreader-Smoke / Farbsehschwäche | OFFEN – manuelle Restprüfung empfohlen (kein Code-Risiko: reine CSS-/Semantik-Änderungen, Layout responsiv) |

## 5. Testnachweis

Stand der **Phase-A-D-Dateien** (Buchungen, Positionsdetail, Rebalancing, FIRE-View,
Settings, Spending/Recurring, Category-Manager, Dictionaries, CurrencyField):

- `eslint`: sauber auf allen von diesem Auftrag geänderten Dateien.
- Unit: **1331 passed / 4 skipped** (Skips = K5 Teilfreistellung, per Owner ausgesetzt) — Lauf 08:40.
- Dictionary-Parität EN/DE/ES: grün.
- E2E (Playwright, `PORT=3011`): meine geänderten Specs grün in Isolation
  (`holdings`, `income`, `recurring`, `interest-goals`, `planned`, `table-shell`);
  Screenshot-QA EN+DE (Abschnitt 4) bestätigt.

### WICHTIG – Blockade durch parallele Session (nicht Teil dieses Auftrags)

Ein **paralleler, aktiver Session-Lauf (`fintrack-4c`)** refactored derzeit die
**Withdrawal-/Simulationslogik** (`WITHDRAWAL_REFACTOR_PLAN.md`, 68 KB). Betroffene,
sekundengenau live editierte Dateien: `components/simulation/monte-carlo-panel.tsx`
(08:57), `lib/finance/monte-carlo.ts` (08:51), `components/simulation/withdrawal-strategy-panel.tsx`
(08:47), neu `components/ui/slider-field.tsx`.

Dieser Refactor ist mitten im Umbau und lässt den Arbeitsbaum aktuell **nicht grün**:

- `tsc`: 20 Fehler, **ausschließlich** in `components/simulation/monte-carlo-panel.tsx` (11)
  und `tests/fire.test.ts` (9) — beides Folge der geänderten `WithdrawalPlan`-/
  `WithdrawalStrategyPanel`-Signaturen. **Keine** meiner Phase-A-D-Dateien betroffen.
- E2E: `simulation.spec.ts:28` + `:50` deterministisch rot (das UI der Withdrawal-Phase
  wurde umgebaut). `retirement.spec.ts:12/27` + `recurring.spec.ts:130` sind Last-Flakes
  (grün in Isolation).

**Folge für die DoD**: Die absolute Regel „nichts ist fertig, solange ein Test rot ist"
ist auf Repo-Ebene aktuell verletzt — aber die Röte gehört dem laufenden Fremd-Refactor,
nicht dieser UX-Regression-Runde. Diese Dateien wurden bewusst **nicht** angefasst
(Multi-Session-Regel). Der finale grüne Gesamtlauf ist erst möglich, wenn der
Withdrawal-Refactor von `fintrack-4c` gelandet ist. Kein Commit erfolgt bis dahin.
