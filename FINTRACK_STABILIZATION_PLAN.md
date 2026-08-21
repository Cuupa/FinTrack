# Implementierungsplan: Post-Redesign-Stabilisierungspass FinTrack

**Stand:** 21. August 2026
**Bezug:** `FINTRACK_UX_UNIFICATION_SPEC.md` (Basis), `FINTRACK_POST_REDESIGN_UX_AUDIT.md` (priorisiertes Delta, hat Vorrang)
**Status:** Planungsdokument, Implementierung begonnen (siehe Addendum)

---

## 0. Addendum — Owner-Korrekturen (2026-08-21, verbindlich, Vorrang vor allem Folgenden)

### 0.1 API-Schlüssel = sofortiger P0-Sicherheitsfehler (nicht nur UI)

Ursache im Code: `SupabaseStore` läuft **client-seitig**. `SupabaseStore.load()` selektiert `llm_settings.api_key` direkt (supabase-store.ts:744) und liefert ihn als `PortfolioData.llmConfig.key` an den Browser (Zeile 1025/1052). Der account-scope-Schlüssel macht damit den Umweg **DB → Browser → zurück an `/api/llm`** und ist über DevTools/Network/State im Klartext abgreifbar. Ein maskiertes Eingabefeld ändert daran nichts.

**Verbindliche Zielarchitektur:**

- Der Browser darf den gespeicherten Schlüssel **nie** lesen. Server/Store geben nach dem Speichern nur zurück: `hasKey`, optional `lastFour`, `provider`, `model`.
- DB: neue Spalte `llm_settings.api_key_last4`; `REVOKE SELECT (api_key)` für Rollen `authenticated`/`anon` (INSERT/UPDATE bleiben), sodass auch ein manuell gebauter Client-Query den Klartext nicht lesen kann. Migration + `schema.sql`, idempotent. Reihenfolge beachten: Store-Select zuerst umstellen, dann REVOKE (sonst 42501 beim Laden).
- `SupabaseStore.load()`: nur noch `provider, model, api_key_last4` selektieren; `llmConfig` mit `key: ""`, `hasKey`, `lastFour`.
- `saveLlmConfig`: schreibt `api_key` + `api_key_last4`; ein Save mit **leerem** Key (nur Provider/Modell geändert, Maske stehen gelassen) überschreibt den gespeicherten Key **nicht**.
- `/api/llm` (Chat, nicht Ping): wenn `body.key` leer und ein Session-Bearer vorhanden → Account-Key **server-seitig** aus `llm_settings` lesen (`supabasePublishable().auth.getUser(token)` + `supabaseSecret()`, Muster aus `app/api/push/subscribe`). Browser-/Guest-Scope senden den Key wie bisher im Body (Ping = frisch getippter Key).
- `proxy-chat.ts`: Account-Scope schickt `Authorization: Bearer <token>` und keinen Key; Browser/Guest wie bisher.
- Settings: gespeicherter Key nur maskiert (`••••1234`) + „Schlüssel ersetzen"; `Anzeigen` nur für den frisch getippten, ungespeicherten Wert.
- `/datenschutz` entsprechend nachziehen.
- **Nicht lokal verifizierbar** (Dev ist guest-only, keine Supabase-Keys) → gegen Live/Demo bzw. CI prüfen.

Dies ersetzt K4 und §7-Fragen 3/4: es ist kein „prüfen ob nötig", sondern umzusetzen.

### 0.2 Freistellungsauftrag-Validierung gehört in eine gemeinsame Domainfunktion

UI-only-Validierung ist umgehbar (andere Clients, direkte Requests). Die Prüfung „Summe der brokerbezogenen Freistellungsaufträge ≤ globaler Sparer-Pauschbetrag" wird eine **reine Domainfunktion** (`lib/finance/tax.ts` bzw. `lib/finance/allowance.ts`), die **sowohl** die UI **als auch** der Speicherpfad (Store-Mutation) aufrufen. Der Speicherpfad lehnt eine Überschreitung ab; die UI zeigt `verteilt/verfügbar/überschritten` aus derselben Funktion.

### 0.3 CLAUDE.md-Regel „jede Tabelle sortierbar" korrigiert

Alte Regel entfernt, neu: „Tables are sortable when users genuinely need to switch between several sort orders, not by default. Always highlight the row on mouseover." Damit kommt die falsche Pauschalregel nicht bei nächsten Aufträgen zurück. K8/§7-Frage 5 sind damit erledigt.

---

## 1. Bestandsaufnahme des aktuellen Codes

Das Redesign aus der UX-Unification-Spec ist **bereits umgesetzt**. Der Audit ist ein Delta gegen diesen Ist-Zustand. Vorhanden und funktionsfähig:

**Tokens (`app/globals.css`, 223 Zeilen):** Semantische Farb-Tokens für Light/Dark existieren fast vollständig wie in der Spec: `--brand`, `--positive`, `--negative`, `--warning`, `--info`, `--chart-1..6`, `--surface*`, `--text-primary/secondary/tertiary`, `--border-subtle/strong`, `--radius-control/surface`. Tailwind-v4-`@theme`-Mapping ist da.
**Lücke:** `--color-action-primary-bg/-fg` aus der Spec (§5) **fehlt komplett**.

**Primitives (`components/ui/`):** `PageHeader`, `SummaryStrip`/`Stat`/`StatRow`, `Section`, `Card`, `Button` (Varianten primary/secondary/ghost/danger/destructive), `Tabs`, `SegmentedControl`, `Field`/`Input`, `Toggle`, `Slider`, `SelectMenu`, `MonthPicker`, `Modal`, `ConfirmDialog`, `InlineNotice`, `EmptyState`, `LoadError`, `Skeleton`, `InfoTip`, `EstimatedBadge`, `RowActions`, `Table`, `use-sort`, `use-focus-trap`, `Private`. `PAGE_STACK`/`SECTION_STACK` sind zentralisiert.
**Lücken:** `RadioCard` und ein `SecretField`-Muster existieren nicht.

**Helfer:** `lib/format.ts` (`formatCurrency`, `formatPercent`, `formatCompactCurrency`, `compactUnitFor`, `plColor`), `lib/colors.ts` (`colorForLabel` + `PALETTE`), `components/charts/axis.ts` (`yAxisWidth`, currency formatter).

**Routen:** Redesign-IA steht: `/accounts` (Tabs Konten/Buchungen/Wiederkehrend), `/cashflow`, `/retirement` (FIRE/Rente), `/rebalancing`, `/goals`, `/debt`, `/simulation`, `/settings` (Tabs Allgemein/Haushalt/Steuern&Gebühren/KI), Dashboard-Karten. Alt-Routen (`/fire`, `/pension`, `/household`, `/spending`, `/recurring`) leiten um.

**Tests:** 101 Unit-Specs (Vitest), Playwright-E2E (`npm run test:e2e`).

### Zentrale Erkenntnis

Ein großer Teil des Audits ist **bereits erledigt** oder nahe dran:

- Settings-Breite ist `max-w-3xl` (768px) → **im Zielkorridor 720-800px** (Audit-Annahme "~450px" überholt).
- Goals nutzt bereits `Modal` + `FormActions` (nicht mehr das Dauerformular).
- LLM-Provider/Modell-Abhängigkeit: `handleProviderChange` setzt Default-Modell → **korrekt**.
- LLM-Verbindungstest: sendet nur `{ping, provider, model, key}`, **keine Portfoliodaten** → **korrekt** (`app/api/llm/route.ts` ping-Pfad).
- Haushalt: `ConfirmDialog` für Leave/Remove, `atLimit(members + sentInvites)` zählt offene Einladungen gegen das Limit → **weitgehend erledigt**.

Der Pass ist damit primär **Farbsemantik + Formatierung + Secret-Handling + Restpolitur + QA**, nicht ein weiter Umbau. Jede Delta-Position muss dennoch am Ist-Code verifiziert werden, weil der Audit auf älteren Screenshots beruht.

---

## 2. Konfliktliste (Spec <-> Audit <-> Implementierung)

| # | Thema | Spec | Audit (Vorrang) | Ist-Code | Auflösung |
|---|---|---|---|---|---|
| K1 | Primäraktion-Farbe | neutraler `action-primary`-Token, Brand nicht als CTA | dgl. (§5.2/5.3) | `Button` primary = `bg-brand` | **Audit folgen**: Token einführen, primary umstellen |
| K2 | `colorForLabel`-Palette | auf semantische chart-Palette umstellen | Kategorien nicht rot/grün (§5.2) | `PALETTE` enthält `#ef4444`/`#059669` | Auf `chart-1..6` mappen |
| K3 | Settings-Breite | 720-800px | 720-800px | bereits `max-w-3xl` (768px) | **Kein Konflikt**, nur verifizieren |
| K4 | Stored API-Key sichtbar | nie voll re-anzeigen | dgl. (§6 KI) | `showKey` re-zeigt geladenen Key | **Audit folgen**: `SecretField`-Flow |
| K5 | Teilfreistellung global | fachlich prüfen, nicht still ändern | dgl. (§5.6/13.5) | globale Checkbox | **Blocker**: Rückfrage, Logik unverändert |
| K6 | Zielzählung Eltern/Teilziel | Doppelzählung ausschließen/kennzeichnen | dgl. (§6.7) | zu verifizieren | **Blocker**: Rückfrage vor Rechenänderung |
| K7 | `EstimatedBadge` vs. "keine Badges" | semantische Statusmarker erlaubt | dgl. | vorhanden | Behalten, Semantik als Marker |
| K8 | "jede Tabelle sortierbar" (alter Styleguide + CLAUDE.md) | nur bei Bedarf | — | `use-sort` überall | Bestehendes belassen (kein Regressionsrisiko), keine neue Erzwingung |
| K9 | Debt-Zeitraumsteuerung | Jahres-Ranges statt Börsen-Ranges | `Gesamt/5J/10J` oder entfernen (§5.5) | `Timeframe` mit `1W..MAX` | **Audit folgen** |
| K10 | plColor-Tokens | an semantische Tokens ausrichten | Gewinn != Brand | `emerald/red` raw | Auf `positive/negative` ausrichten |

**Regelkonflikt CLAUDE.md <-> Audit:** CLAUDE.md sagt "Always make every table sortable". Der Audit/Spec relativieren das. **Entscheidung:** bestehende Sortierung bleibt (kein Rückbau), aber keine Pflicht-Neueinführung. Diesen Punkt bei Bedarf mit dem Owner bestätigen.

---

## 3. Priorisierte Datei- und Komponentenliste

**Foundations (zuerst, global):**

1. `app/globals.css` (K1: action-primary-Token)
2. `components/ui/primitives.tsx` (`Button` primary; neue `RadioCard`)
3. `lib/format.ts` (Negativ-Null, plColor)
4. `lib/colors.ts` (K2 Palette)
5. `components/charts/axis.ts` (Achsenformat Simulation)
6. `components/ui/` neu: `secret-field.tsx` (oder Muster in settings-view)

**P0-Fehler/Format:**

7. `components/debt/debt-view.tsx`, `debt-chart.tsx` (K9 Zeitraum)
8. `components/simulation/monte-carlo-panel.tsx` (Achse, Begriffe)
9. `components/rebalancing/rebalancing-view.tsx` (Nullwerte, Zielsumme, Baseline, Namen)
10. `components/dashboard/net-worth-hero.tsx`, `net-worth-breakdown-chart.tsx`, `month-flow-card.tsx`, `health-summary-card.tsx`, `key-insights-card.tsx` (Übersicht)

**Sicherheits-/fachkritische Settings:**

11. `components/settings/settings-view.tsx` (Steuern&Gebühren-Validierung, KI-Key, RadioCards, Passwort-Reauth, Kontolöschung-Lokalisierung, Save-States)
12. `components/household/household-view.tsx` (Rolle "Inhaberin", Owner-Leave-Guard, Preisintervall)
13. `app/api/llm/route.ts` (Verifikation ping/Redaction; keine Änderung wenn schon korrekt)

**Progressive Disclosure / Formulare:**

14. `components/goals/goals-view.tsx` (Hierarchie/Zählung transparent)
15. `components/pension/pension-view.tsx` (Formulare in Modal/Drawer)
16. `app/cashflow/page.tsx` + Budget-Empty-State-Surface

**Seitenpolitur:**

17. `components/fire/fire-view.tsx` (gemeinsamer Notice, Button-Stil)
18. Cashflow-Kategorie-Aktion, Konten/Buchungen (Trefferflächen, Neutralfarbe)

**Lokalisierung (jede Copy-Änderung):** `lib/i18n/` Dictionaries en/de/es.

---

## 4. Phasenweiser Implementierungsplan

> Regel für alle Phasen: LEDGER.md vor Delegation beanspruchen; jede Phase einzeln committen (keine Misch-Commits); nur eigene Pfade committen; keine Code-Kommentare; jede Copy in en/de/es; lokal in Guest Mode mit `PORT=3011` verifizieren; keine Rechenlogik ohne dokumentierten Fehler.

### Phase 1 — Foundations & gemeinsame Komponenten

**Ziel/Umfang:** Semantische Grundlage schaffen, bevor Seiten angefasst werden. Action-Primary-Token, Button-Hierarchie, Chart-Palette, Zahlenformat-Normalisierung, `RadioCard`, `SecretField`-Muster.
**Betroffene Dateien:** `app/globals.css`, `components/ui/primitives.tsx`, `lib/colors.ts`, `lib/format.ts`, neu `components/ui/radio-card.tsx`, ggf. `components/ui/secret-field.tsx`.
**Wiederverwenden/erweitern:** `Button` (Variante erweitern, nicht ersetzen), `Field`/`FOCUS_RING`, `Toggle` als Vorbild für `RadioCard`.
**Abhängigkeiten:** keine (Basis für alles Weitere).
**Risiken:** Button-primary-Umstellung ändert das gesamte App-Bild → visuelle Regression breit; Brand bleibt für Nav/Tabs/Fokus reserviert. Palette-Umstellung verschiebt Slice-Farben in Analyse/Allocation (deterministische Zuordnung bleibt, Farben ändern sich).
**Automatisierte Tests:** Unit für `formatCurrency(-0.001)->"0,00 €"`, `formatPercent(-0)->"0,00 %"`, `formatCompactCurrency` Negativ-Null; `colorForLabel` gibt nur chart-Palette zurück (kein `#ef4444`/`#059669`); Snapshot der Button-Klassen.
**Manuelle Tests:** Button-Hierarchie auf 3 Referenzseiten (Depot, Konten, Simulation) Light+Dark; Fokusring sichtbar.
**Screenshots:** Depot + Konten je Light/Dark (Baseline für den Rest).
**Abnahme:** action-primary-Token existiert und wird vom primary-Button genutzt; Brand nur noch Nav/Tab/Fokus/Auswahl; keine chart-Kategorie in Rot/Grün; Negativ-Null normalisiert; `RadioCard` verfügbar.

### Phase 2 — Offensichtliche Darstellungs- und Formatierungsfehler

**Ziel/Umfang:** Audit §5.5 abarbeiten.
**Betroffene Dateien:** `components/debt/debt-view.tsx` + `debt-chart.tsx` (K9: Börsen-Range → `Gesamt/5J/10J`), `components/simulation/monte-carlo-panel.tsx` + `components/charts/axis.ts` (Y-Achse: <1 Mio in Tausendern, >=1 Mio >=1 Dezimale, keine doppelten `0M`), Simulation-Ergebnisbegriffe (`Eingezahltes Kapital`, `Wertzuwachs im Median`, `Projiziertes Endvermögen im Median`), `components/rebalancing/rebalancing-view.tsx` (`-0,0 %`->`0,0 %`, Zielsummen-Erklärung, gemeinsame Baseline, Namen nicht abschneiden), Übersicht-Change-Definition + kleine Werte annotieren.
**Wiederverwenden:** `formatCompactCurrency`/`compactUnitFor`, `SegmentedControl`, `InlineNotice`, `plColor`.
**Abhängigkeiten:** Phase 1 (Format-Helfer).
**Risiken:** Achsen-/Range-Änderung darf Chart-Datenreihen nicht berühren (nur Anzeige). Rebalancing-Zielsumme ist eine **Erklärung**, keine Rechenänderung.
**Automatisierte Tests:** Achsentick-Formatter-Unit (0,4 Mio → nicht "0M"); Debt-Range-Helper-Unit; Rebalancing-Formatter-Unit; bestehende `windowChange`-Tests bleiben grün.
**Manuelle Tests:** Debt-Chart mit 24-Jahres-Plan; Simulation mit großen und Null-Beträgen; Rebalancing mit Zielsumme <100%.
**Screenshots:** Verbindlichkeiten, Simulation (nach Start), Rebalancing, Übersicht.
**Abnahme:** Audit-§5.5-Checkliste + DoD "Simulationsachse/Begriffe eindeutig", "Nullbeträge korrekt", "Verbindlichkeiten ohne wirkungslose Zeitraumsteuerung".

### Phase 3 — Sicherheits- und fachkritische Settings-Flows

**Ziel/Umfang:** Audit §5.6 / §6.12. Nur Secret-, Konto-, Sitzplatz-, Steuergrenzen-Flows; Teilfreistellung/Zählung nur nach Klärung (siehe §7).
**Betroffene Dateien:** `components/settings/settings-view.tsx`, `components/household/household-view.tsx`, ggf. `app/api/llm/route.ts` (nur Verifikation Log-Redaction).
**Konkrete Aufgaben:**

- KI: gespeicherten Key maskieren (letzte 4 + "Schlüssel ersetzen"); `Anzeigen` nur für neu eingegebenen, ungespeicherten Wert; Speicherort als `RadioCard` mit Titel+Konsequenz; sachliche Speicherort-Copy; Teststatus/Fehler inline (vorhanden, prüfen).
- Passwortänderung: aktuelles Passwort / Reauth; Regeln + Nichtübereinstimmung inline.
- Kontolöschung: Bestätigungstext lokalisieren (`KONTO LÖSCHEN`/`DELETE ACCOUNT`/`ELIMINAR CUENTA`), Folgenzusammenfassung + `ConfirmDialog`.
- Steuern&Gebühren: native Number-Spinner entfernen → CurrencyField; Freistellungsauftrag `verteilt/verfügbar/überschritten` + Validierung Summe vs. global; `Kostenlos ab` erklären; ungespeicherte Brokeränderung bei Wechsel schützen.
- Haushalt: Rolle geschlechtsneutral (`Verwaltet den Haushalt`/`Eigentümer:in`), Owner-Leave-Guard, Preis mit Intervall (`1,99 € pro Monat`), widersprüchlicher Invite-Zustand bei Limit.
- Save-States: Dirty/Saving/Saved/Error pro Abschnitt; Speichern deaktiviert ohne Änderung/ungültig; Tab-/Broker-/Providerwechsel schützt ungespeicherte Änderungen.

**Wiederverwenden:** `ConfirmDialog`, `Field`, `FormActions`, `RadioCard` (Phase 1), `useFormTouched`, `InlineNotice`, `atLimit`, `SecretField`.
**Abhängigkeiten:** Phase 1 (`RadioCard`, `SecretField`). K5/K6 blockiert bis Klärung.
**Risiken:** Reauth-Flow abhängig von Supabase-Verhalten; nur lokal Guest-Mode testbar → registriert gegen Live-Demo verifizieren. Freistellungsauftrag-Validierung ist **UI-Validierung**, keine Steuerrechenänderung.
**Automatisierte Tests:** Unit für Freistellungs-Rest/Überschreitung-Berechnung (rein, neue Helferfunktion); E2E: KI-Key speichern → nachladen zeigt keinen Klartext; Kontolöschung-Bestätigungstext lokalisiert; Broker-Wechsel warnt bei Dirty.
**Manuelle Tests:** Registriert gegen `fintrack-five-cyan.vercel.app` (demo@demo.com): Key speichern/ersetzen/entfernen; Passwort ändern; Haushalt Owner-Leave; Sitzplatzlimit.
**Screenshots:** Settings Allgemein/Haushalt/Steuern&Gebühren/KI je Light/Dark.
**Abnahme:** DoD-Settings-Block vollständig außer den zwei geklärten Blockern.

### Phase 4 — Progressive Disclosure & Formularvereinheitlichung

**Ziel/Umfang:** Audit §5.4. Budget-Empty-State, Ziele-Hierarchie/Zählung transparent, Rente-Formulare in Modal/Drawer, optional Positionsdetail-Formular einklappbar.
**Betroffene Dateien:** Cashflow/Budgets-Surface (`app/cashflow/page.tsx` + Budget-Komponente), `components/goals/goals-view.tsx`, `components/pension/pension-view.tsx`, Positionsdetail (`app/assets/[id]`).
**Wiederverwenden:** `EmptyState`, `Modal`, `FormActions`, bestehende Goal-Form-Komponente.
**Abhängigkeiten:** Phase 1.
**Risiken:** Rente-Formulare hängen an Store-Seam + Buchungslogik → nur UI-Verschiebung in Modal, keine Booking-Logik anfassen. Ziele-Zählung: nur transparente **Kennzeichnung**, keine Rechenänderung bis K6 geklärt.
**Automatisierte Tests:** E2E Budget-Empty-State → "Erstes Budget anlegen" öffnet Modal; Rente-Formular öffnet/schließt nach Speichern; bestehende Pension-Booking-Unit-Tests bleiben grün.
**Manuelle Tests:** Budgets ohne Daten; Ziele mit Eltern+Teilziel; Rente mit/ohne Statements.
**Screenshots:** Budgets (leer), Ziele, Rente.
**Abnahme:** DoD "Budget/Ziele/Rente nutzen Progressive Disclosure".

### Phase 5 — Seitenbezogene Politur

**Ziel/Umfang:** Audit §6. FIRE (gemeinsamer Notice statt 3x Warnung, Button-Stil), Cashflow (`Ohne Kategorie` → Aktion "Buchungen kategorisieren", kategoriale Farben), Konten/Buchungen (neutrale Ausgaben, Trefferflächen >=36/44px, Zinsbuchung erkennbar), Depot/Positionsdetail (Filterchips mobil, neutrale BUY/SELL, `Strategie-Typ: Core` neutral, Gewinnfarbe != Brand), Übersicht (Karte "Dieser Monat" kompakter, Hinweise/Gesundheit kontrastreicher).
**Betroffene Dateien:** `components/fire/fire-view.tsx`, Cashflow-Übersicht, `components/accounts/*` bzw. Buchungs-/Recurring-Komponenten, Depot-View, `app/assets/[id]`, Dashboard-Karten.
**Wiederverwenden:** `InlineNotice`, `Button`, `RowActions`, `plColor`, `Status`-Muster (Text+Icon).
**Abhängigkeiten:** Phasen 1-2.
**Risiken:** BUY/SELL neutral: nur Anzeigefarbe, Transaktionstyp-Logik unberührt.
**Automatisierte Tests:** bestehende E2E (dashboard-kpis, account/spending) müssen grün bleiben; ggf. anpassen (Farb-/Textänderung).
**Manuelle Tests:** je Seite Light/Dark, Graustufen-Check (Farbe nie alleiniges Signal).
**Screenshots:** FIRE, Cashflow, Konten, Buchungen, Depot, Positionsdetail.
**Abnahme:** Audit-§6-Checklisten; "keine normale Ausgabe als Fehler codiert".

### Phase 6 — Responsive-, Accessibility- & Visual-Regression-QA

**Ziel/Umfang:** Audit §8 / Spec §18-19. Viewports, 200%-Zoom, Tastatur, Fokus, Kontrast, Privacy, Zustände.
**Betroffene Dateien:** punktuelle Fixes über alle Seiten (kein neues Feature).
**Wiederverwenden:** `use-focus-trap`, `FOCUS_RING`, `Private`.
**Abhängigkeiten:** Phasen 1-5 abgeschlossen.
**Risiken:** Umbrüche in Aktionsleisten/Filterchips; Chat-Bubble überdeckt Aktionen mobil.
**Automatisierte Tests:** Playwright Multi-Viewport-Smoke (Kernseiten laden, keine horizontale Überlaufwarnung); axe-artige Kontrast-/Rollen-Checks falls im Setup verfügbar; Tastatur-Tab-Reihenfolge auf 2 Referenzseiten.
**Manuelle Tests:** Vollständige Screenshot-Matrix (§6), 200%-Zoom, reduzierte Bewegung, lange de/en/es-Texte, große/negative/Null-Beträge, leere/volle Tabellen, Ausreißer-Charts, Privacy Mode.
**Screenshots:** siehe Matrix §6.
**Abnahme:** DoD-Accessibility/Responsive-Block.

### Phase 7 — Bereinigung veralteter Styles & Komponenten

**Ziel/Umfang:** Raw-`zinc`/Hex-Reste in JSX auf Tokens ziehen (v.a. `settings-view.tsx`); stale Feature-Flags nach Feature-Änderungen prüfen (CLAUDE.md-Regel); ungenutzte Varianten entfernen.
**Betroffene Dateien:** breit, per `grep`-Audit (`text-zinc-`, `border-zinc-`, `#`-Hex in `.tsx`).
**Wiederverwenden:** semantische Tokens.
**Risiken:** versehentliche Farbverschiebung Light/Dark.
**Automatisierte Tests:** Lint + `grep`-Gate "keine Hex in fachlichem JSX"; volle Unit-Suite grün.
**Manuelle Tests:** Stichprobe Light/Dark.
**Abnahme:** keine lokalen Hex/Standardabstände in fachlichen Seiten (DoD Global).

### Phase 8 (Abschluss) — Styleguide-Skill-Neuerstellung

**Erst nach visueller Abnahme und Bereinigung.** Neuen kompakten `styleguide`-Skill aus dem finalen Code ableiten; alten nicht parallel pflegen. Aussagen gegen reale Dateien/Exporte/Tests prüfen.

---

## 5. Automatisierte & manuelle Tests (Gesamtübersicht)

**Automatisiert (Vitest):** Negativ-Null-Normalisierung; `colorForLabel`-Palette; Achsentick-Formatter; Debt-Range-Helper; Freistellungs-Rest/Überschreitung; Locale-Parität (de/es/en) für jeden neuen Key. Alle bestehenden 101 Specs müssen grün bleiben (besonders `windowChange`, Pension-Booking, `resolvePlan`/`user_has_pro`).
**Automatisiert (Playwright):** Budget-Empty-State-Flow; KI-Key-Persistenz ohne Klartext; Kontolöschung-Bestätigungstext lokalisiert; Broker-Dirty-Guard; Multi-Viewport-Smoke; bestehende dashboard/account/spending-Specs aktualisieren.
**Manuell:** Guest Mode (`PORT=3011`) für UI; Registered Mode gegen Live-Demo für Auth/Household/Secrets; Graustufen-Check; Tastatur-Only; 200%-Zoom.

---

## 6. Screenshot-Matrix (Visual Regression)

Kernseiten x Viewports x Theme. Viewports: **1440x900, 1280x800, 1024x768, 768x1024, 390x844** + **200%-Zoom** (auf 1280x800). Theme: **Light + Dark**. Zusätzlich Zustände: leer / befüllt / Privacy.

| Seite | 1440 | 1280 | 1024 | 768 | 390 | 200% | Zustände |
|---|---|---|---|---|---|---|---|
| Übersicht | x | x | x | x | x | x | befüllt, Privacy |
| Konten / Buchungen / Wiederkehrend | x | x | x | x | x | x | leer, lange Tabelle |
| Cashflow (Übersicht/Budgets/Prognose) | x | x | x | x | x | x | Budget leer |
| Depot + Positionsdetail | x | x | x | x | x | x | Filterchips mobil |
| Rebalancing | x | x | x | x | x | x | Zielsumme <100% |
| Verbindlichkeiten | x | x | x | x | x | x | Range-Wechsel |
| Ziele | x | x | x | x | x | x | Eltern+Teilziel |
| Ruhestand FIRE / Rente | x | x | x | x | x | x | nicht erreichbar |
| Simulation | x | x | x | x | x | x | vor/nach Start |
| Settings (4 Tabs) | x | x | x | x | x | x | Dirty/Saved/Error |

Je Zelle Vorher/Nachher. Ausreißer- und Null-Wert-Charts explizit prüfen.

---

## 7. Offene fachliche & sicherheitsrelevante Fragen (Blocker vor Änderung)

1. **Teilfreistellung (K5):** Die globale Checkbox wendet Teilfreistellung pauschal an. Rechtlich ist sie fonds-/wertpapierartabhängig. **Frage:** Soll das Rechenverhalten differenziert werden (pro Instrument/AssetType), oder bleibt die globale Annahme und wir dokumentieren sie nur klarer in der UI? **Bis zur Antwort: Logik unverändert.**
2. **Zielzählung (K6):** Werden Teilziele aktuell in Anzahl/Zielsumme/Fortschritt doppelt gezählt? **Frage:** Kennzeichnung genügt, oder soll die Aggregation angepasst werden? **Bis zur Antwort: nur transparente Anzeige, keine Rechenänderung.**
3. **Passwort-Reauth:** Erzwingt Supabase bereits sichere Reauth bei Passwortänderung? Falls ja, entfällt das Feld "aktuelles Passwort". **Verifikation gegen Live nötig.**
4. **Kontospeicherung KI-Key:** Sind serverseitige Verschlüsselung + Log-Redaction für `llm_settings` gegeben? Falls nicht, ist "In deinem Konto" als sicher darzustellen zu revidieren.
5. **Tabellen-Sortierpflicht (K8):** CLAUDE.md fordert "jede Tabelle sortierbar", Audit relativiert. Bestätigung, dass bestehende Sortierung bleibt und keine neue erzwungen wird.
6. **Sitzplatz-Zusatzplatz:** Soll bei erreichtem Limit die Einladung deaktiviert werden **oder** Preis+Intervall vor kostenpflichtiger Einladung bestätigt werden? (Audit erlaubt beides.)

---

## 8. Explizit NICHT veränderte Berechnungen und Nutzerabläufe

- Finance-Core (`lib/finance/*`): Holdings-Ableitung, Cost-Basis, P&L, `netWorthSeries`, `twrSeries`, `windowChange`, IRR/XIRR, Monte Carlo/`withdrawal.ts`, Dividenden-Projektion, `stats.ts`, `xray.ts`, `allocation.ts`.
- Steuerlogik: `taxYearBreakdown`, Freistellungsauftrag-**Berechnung**, Vorabpauschale, Teilfreistellung (bis Klärung K5).
- Pension: `projectPension`, `statementAnnualPoints`, `contractReturn`, Booking-Occurrence-Logik, FIRE-`PensionBridge`.
- Debt: `amortizationSchedule`, `planPayoff`, `accountRateSteps`.
- Store-Seam, RLS, Feature-Flag-/Plan-Auflösung (`resolvePlan`/`user_has_pro`), Offline-Queue, CSV-Import/-Export/Fingerprints, Privacy-Funktionen (`EmailImage`, `data-private`), bestehende URLs/Redirects, Web-Push-Berechnungen.
- Bestehende Übersetzungen (nur additiv erweitern).

Änderungen bleiben auf **Darstellung, Formatierung, Farbsemantik, Progressive Disclosure, Save-/Secret-Flows und A11y** beschränkt.

---

## 9. Definition of Done (Stabilisierungspass)

- [ ] Keine Hauptseite erfindet eigene Button-/Formularlogik; primary = neutraler action-primary, Brand nur Nav/Tab/Fokus/Auswahl.
- [ ] Keine normale Ausgabe als Fehler codiert; BUY/SELL neutral; Farbe nie einziges Signal.
- [ ] Marke, Aktion, positiv, negativ, Warnung, Kategorie farblich getrennt; Charts in Graustufen lesbar.
- [ ] Negativ-Null überall normalisiert; Simulationsachse/-begriffe eindeutig; Rebalancing-Nullwerte/Zielsumme erklärt; Verbindlichkeiten ohne wirkungslose Zeitraumsteuerung.
- [ ] Budget/Ziele/Rente nutzen Progressive Disclosure; Eltern/Teilziele nicht missverständlich doppelt.
- [ ] Settings: eindeutige Dirty/Lade/Erfolg/Fehler-Zustände; Kontolöschung lokalisiert+bestätigt; Passwort-Reauth; Sitzplatz/Einladung/Preis widerspruchsfrei; Freistellungsauftrag gegen global validiert; Teilfreistellung geprüft+dokumentiert.
- [ ] Gespeicherter API-Key nie voll abrufbar, nicht in Logs/Antworten; Verbindungstest ohne Finanzdaten.
- [ ] 5 Viewports + 200%-Zoom + Tastatur + Fokus + WCAG-AA-Kontrast geprüft; Privacy ohne Layoutsprung.
- [ ] Vorher/Nachher-Screenshots der Kernseiten verglichen; keine Rechenlogik ohne fachlichen Grund geändert.
- [ ] Alle Unit-/E2E-Tests grün; neue Copy in en/de/es; keine Code-Kommentare.
- [ ] (Zuletzt) Neuer schlanker Styleguide-Skill aus finalem Code, alter nicht mehr aktiv.

---

**Komplexität:** Mittel bis groß, aber gut isolierbar (7 prüfbare Phasen + Skill). Kern-Risiko liegt bei der globalen Button-/Palette-Umstellung (Phase 1, breite visuelle Regression) und den zwei fachlichen Blockern (K5 Teilfreistellung, K6 Zielzählung).
