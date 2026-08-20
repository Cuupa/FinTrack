# FinTrack UX-Unification — Phase-0-Audit & Umsetzungsplan

Stand: 19. August 2026
Quelle: `FINTRACK_UX_UNIFICATION_SPEC.md` (verbindliche Zielspezifikation)
Status: **Phase 0 abgeschlossen. Kein Code geändert. Warte auf Bestätigung.**

Dieses Dokument ist die abarbeitbare Vorlage. Jede Phase hat eine Checkliste,
konkrete Dateien und eine Definition-of-Done. Reihenfolge und Pilotrouten
folgen Abschnitt 20/21/25 der Spec.

---

## 0. Executive Summary

FinTrack hat bereits eine **brauchbare Primitive-Schicht** (`PageHeader`,
`Card`, `Stat`, `StatRow`, `Button`, `SegmentedControl`, `Tabs`, `EmptyState`,
`Table`) und **eine einzige Nav-Registry** (`lib/nav/routes.tsx`). Das
Frankenstein-Gefühl der Spec kommt nicht von fehlenden Primitives, sondern von
drei Lücken:

1. **Keine semantische Token-Schicht.** `app/globals.css` definiert nur
   `--background`/`--foreground`. Farben sind roh als Tailwind-Paletten
   (`zinc`/`emerald`/`red`) in **120 / 54 / 50 Dateien** verstreut, plus
   ~90 rohe Hex-Werte (v. a. Chartfarben). Es gibt keine Rollen `brand`,
   `positive`, `negative`, `warning`, `chart-1..6`. **Das ist das Fundament
   und der größte Hebel.**
2. **Falsche Platzierung von Scope-Filtern.** `PortfolioPicker` und
   `AccountPicker` sitzen in der **globalen Kopfleiste** (`site-nav.tsx`), nicht
   im Page Header. Die Spec verlangt sie zwingend im Page Header (§4.1, §10).
3. **All-in-one-Seiten ohne Untertabs.** `/portfolio`, `/accounts`+`/spending`,
   `/cashflow` stapeln 3–4 Aufgaben untereinander statt in Tabs (§10, §11).

Dazu **ein echter semantischer Fehler** (Spec §2.3, §9, §15.3), den wir fixen
dürfen: die **Nettovermögens-Kurve zeigt Aktienbenchmarks**. Der Chart-Component
`NetWorthHero` wird von Dashboard **und** Depot geteilt und trägt den
`BenchmarkPicker` — auf der Übersicht ist der Vergleich fachlich falsch.

Migrationsstrategie laut Spec: **erst Kern (Tokens + Primitives), dann eine
vollständige vertikale Pilotroute `Depot`, dann `Konten`, dann mechanisch der
Rest.** Kein 14-Seiten-Big-Bang.

---

## 1. Routenmatrix

Vier Seitentemplates laut Spec §20.1: **Dashboard**, **Datenverwaltung**,
**Planung**, **Einstellungen**. Zuordnung + Ziel-IA (Spec §3.2):

| Route (Datei) | Flag | Template | Ziel-Gruppe (neu) | Migrationsentscheidung |
| --- | --- | --- | --- | --- |
| `/` `app/page.tsx` | — | Dashboard | Übersicht | Benchmarks raus, Assets/Verb./Netto trennen, Gesundheit + Monatskontext integrieren |
| `/portfolio` `app/portfolio/page.tsx` | — | Datenverwaltung | Investments > Depot | **PILOT 1.** Untertabs `Positionen \| Sparpläne \| Watchlist \| Historie` |
| `/accounts` `app/accounts/page.tsx` | `accounts` | Datenverwaltung | Geld > Konten | **PILOT 2.** Untertabs `Konten \| Buchungen \| Wiederkehrend` |
| `/spending` `app/spending/page.tsx` | `spending` | Datenverwaltung | Geld > Konten (Tab `Buchungen`) | In Konten-Tabs aufgehen; Route bleibt als Redirect/Alias |
| `/cashflow` `app/cashflow/page.tsx` | `spending`,`plannedCashflow` | Datenverwaltung | Geld > Cashflow | Untertabs `Übersicht \| Budgets \| Prognose`; Sankey als Alt-Ansicht |
| `/debt` `app/debt/page.tsx` | `debtPayoff` | Planung | Planen > Verbindlichkeiten | Aus „Alltag“ nach „Planen“ verschieben (nur Nav-Gruppe) |
| `/household` `app/household/page.tsx` | `household` | Einstellungen | Einstellungen > Haushalt | Aus Kernnav entfernen, in Settings-Tab; Route bleibt |
| `/analysis` `app/analysis/page.tsx` | — | Datenverwaltung | Investments > Analyse | X-Ray als Primärtab integrieren |
| `/xray` `app/xray/page.tsx` | `xray` | Datenverwaltung | Investments > Analyse > X-Ray | Als Tab in `/analysis`; Route bleibt als Redirect |
| `/dividends` `app/dividends/page.tsx` | `dividends` | Datenverwaltung | Investments > Dividenden | Auf `DataTable`/`ChartCard` migrieren; bleibt eigenständig |
| `/rebalancing` `app/rebalancing/page.tsx` | `rebalance` | Datenverwaltung | Investments > Rebalancing | Zwei Donuts → Ist/Ziel/Differenz-Balken |
| `/goals` `app/goals/page.tsx` | `goals` | Planung | Planen > Ziele | Summary+Section-Struktur, Kartenreihenfolge vereinheitlichen |
| `/retirement` `app/retirement/page.tsx` | `firePlanner`,`pension` | Planung | Planen > Ruhestand | Tabs `FIRE \| Rente` auf gemeinsames Raster |
| `/fire` `app/fire/page.tsx` | `firePlanner` | Planung | → `/retirement?tab=fire` | Redirect (existiert bereits) |
| `/pension` `app/pension/page.tsx` | `pension` | Planung | → `/retirement?tab=pension` | Redirect (existiert bereits) |
| `/health` `app/health/page.tsx` | `finHealth` | Dashboard-Fragment | Übersicht > Finanzielle Gesundheit | Als Abschnitt in `/`; Detailroute bleibt bestehen |
| `/simulation` `app/simulation/page.tsx` | `simulation` | Planung | Planen > Simulation | Parameter-Panel (360–400px, sticky) + Ergebnis-Template, echte Empty/Result-States |
| `/assets/[id]` `app/assets/[id]/page.tsx` | — | Detailseite | (Detail) | Nur Primitive-/Token-Migration, Breadcrumb erlaubt |
| `/instruments/[key]` | — | Detailseite | (Detail) | Wie oben |
| `/recurring/[kind]/[id]` | — | Detailseite | (Detail) | Wie oben |
| `/settings` `app/settings/page.tsx` | — | Einstellungen | Einstellungen | Haushalt-Tab aufnehmen |
| `/login`,`/pricing`,`/shared/*` | — | Sonstige | — | Nur Token-Migration |
| `/impressum`,`/datenschutz`,`/terms` | — | Legal | — | Nur Token-Migration; Inhaltsclaims nicht verändern |
| `/admin/*`,`/system` | — | Intern | — | **Außerhalb Scope.** Nur Tokens, keine IA-Änderung |

Nav-Gruppen-Umbau (`NavGroup` in `lib/nav/routes.tsx`): heute
`everyday \| household \| invest \| plan`. Ziel laut Spec §3.1:
`Übersicht (ungruppiert) → Geld → Investments → Planen → Einstellungen`.
`household` als eigene Nav-Gruppe **entfällt**; Haushalt wandert in Settings.

---

## 2. Vorhandene Komponenten & Dubletten

### 2.1 Bereits vorhandene Primitives (behalten, auf Tokens umstellen)

| Rolle laut Spec | Vorhanden? | Datei | Anpassung |
| --- | --- | --- | --- |
| `PageHeader` (§7.1) | ✅ teils | `components/ui/primitives.tsx` | Slots ergänzen: Scope, Zeitraum, Primäraktion in fester Reihenfolge; Tabs-Slot darunter |
| `SummaryStrip` (§7.2) | ⚠️ `StatRow` | `components/ui/primitives.tsx` | `StatRow` gibt jeder Zeile eine `Card`. Spec will EINE Fläche mit Trennlinien, kein Kartenrahmen pro Stat → neuer `SummaryStrip` oder `StatRow`-Refactor |
| `Section` (§7.3) | ⚠️ `Card`+`SectionTitle` | `components/ui/primitives.tsx` | `Section`-Wrapper mit optionalem Titel/Action-Slot, rahmenlos-fähig |
| `Tabs` (§7.4 primär) | ✅ | `components/ui/tabs.tsx` | brand-Token statt `emerald-500`; Pfeiltasten-Nav (§18) |
| `SegmentedControl` (§7.4 sekundär) | ✅ | `components/ui/primitives.tsx` | Auf Tokens |
| `Button` (§7.5) | ⚠️ | `components/ui/primitives.tsx` | **Primary ist heute monochrom (`zinc-900`), Spec will brand.** Varianten `primary/secondary/ghost/destructive`; Mindesthöhe 36/40px |
| `Field` (§7.6) | ❌ | — | **Fehlt.** Formularfelder sind pro Seite hand-gebaut. Neu bauen; `FormActions` existiert |
| `DataTable` (§7.7) | ✅ | `components/ui/table.tsx` | Zeilenhöhe 44/52px, `Mehr`-Menü (>2 Aktionen, `row-actions.tsx` existiert), Mobile-Priorisierung |
| `ChartCard` (§7.8) | ❌ | — | **Fehlt.** Charts nutzen ad-hoc `Card`+Recharts. Neu bauen; stabile Höhe für Loading/Empty/Error |
| `EmptyState` (§7.9) | ✅ | `components/ui/primitives.tsx` | Auf Tokens |
| `InlineNotice` (§7.10) | ❌ | — | **Fehlt.** Amber-Sonderboxen pro Seite. Neu: `info/success/warning/error` |

### 2.2 Weitere geteilte Bausteine (relevant für Migration)

- `components/ui/month-picker.tsx` — die vom Spec geforderte einheitliche
  Monatssteuerung existiert. Muss in den Page Header wandern (heute pro Seite).
- `components/charts/chart-controls.tsx`, `performance-chart.tsx`,
  `benchmark-picker.tsx`, `axis.ts`, `use-benchmark-compare.ts` — bilden die
  Chart-Basis für `ChartCard`.
- `components/ui/select-menu.tsx`, `slider.tsx`, `modal.tsx`,
  `confirm-dialog.tsx`, `form-actions.tsx`, `info-tip.tsx`,
  `row-actions.tsx`, `skeleton.tsx`, `private.tsx` — vorhanden, wiederverwenden.
- `components/onboarding/page-tours.tsx` → `PageHeaderWithTour` wrappt
  `PageHeader`. Muss beim Header-Refactor mitgezogen werden.

### 2.3 Dubletten / Forks (auflösen)

| Dublette | Orte | Auflösung |
| --- | --- | --- |
| **KPI-Fläche** | `StatRow` (Card) vs. Einzel-`Card`-KPIs | Ein `SummaryStrip` |
| **`NetWorthHero` doppelgenutzt** | Dashboard (`app/page.tsx`) + Depot (`app/portfolio/page.tsx`) | Split/Param: Dashboard **ohne** Benchmark, Depot **mit**. Kernrisiko, s. §4 |
| **Scope-Picker** | Global bar (`site-nav.tsx`) für Portfolio+Account | In `PageHeader`-Scope-Slot verschieben |
| **X-Ray vs. Analyse** | `/xray` + `/analysis` | X-Ray als Analyse-Tab |
| **Cashflow-Mischseite** | Übersicht+Budgets+Prognose in einer Seite | 3 Tabs |
| **Chart-Range-Controls** | teils `SegmentedControl`, teils Chips in `chart-controls.tsx` | Eine Range-Auswahl (`1M/3M/YTD/1J/3J/5J/MAX`, §15.1) |

---

## 3. Lokale Styles & Sonderlösungen

- **Keine semantische Token-Schicht.** `app/globals.css` hat nur
  `--background`/`--foreground` + einen `.dark`-Block, plus rohe Slider-Farben
  (`#10b981`, `rgb(228 228 231)` …). Theme läuft über `.dark`-Klasse
  (`@custom-variant dark`), **nicht** über `data-theme` wie im Spec-CSS-Beispiel.
  → Wir mappen die Spec-Tokens auf die bestehende `.dark`-Mechanik (nicht
  `data-theme` einführen).
- **Farbstreuung (Migrationsvolumen):**
  - `zinc-*` in **120 Dateien** (Flächen/Text/Border)
  - `emerald-*` in **54 Dateien / 215 Vorkommen** (Marke + positiv + Serie —
    genau die vom Spec §2.3 kritisierte Mehrfachbedeutung)
  - `red-*` in **50 Dateien** (negativ + destruktiv + „nur Minuszeichen“)
  - ~90 rohe Hex in `.tsx` (v. a. Chartfarben `#6366f1`, `#ef4444`, `#f59e0b`,
    `#8b5cf6`, `#ec4899`, `#06b6d4` …) → auf `chart-1..6` konsolidieren.
- **Slider** (`globals.css` `.fin-slider`) mit hartem `#10b981` → brand-Token.
- **Kein max-content-width.** `app/layout.tsx` `<main>` ist voll breit
  (`px-4 sm:px-6 lg:px-8`), Global bar `max-w-[1600px]`. Spec will Inhalt
  `max 1480px` zentriert, Padding 32/24/16px pro Breakpoint.
- **Buttons monochrom** (`primary = zinc-900`) statt brand.
- **Amber-Sonderboxen** pro Seite (FIRE „Ziel nicht erreichbar“, Debt-Hinweise,
  Sparplan-„N fällig“) → ein `InlineNotice`.
- **Sondertilgungs-Formular** (Screenshot) als dauerhaft sichtbare leere
  Formularzeile → Drawer/Dialog (§12.1, §7.9).

---

## 4. Fachliche Logik — NICHT ändern (Spec §19 „Nicht verhandelbar“)

Diese Bereiche sind reines Rechen-/Datenmodell und bleiben unangetastet
(nur Präsentation ändert sich):

- **Finanzkern** `lib/finance/**` — Holdings-Ableitung, IRR, `windowChange`,
  `holdingPeriodProfit`, `netWorthSeries`, `twrSeries`, Steuerreport,
  Monte-Carlo/`withdrawal.ts`, Dividenden, Vorabpauschale, Debt-`planPayoff`,
  Renten-`projectPension`, FIRE `computeFirePlan`/`PensionBridge`.
- **Store-Seam** `lib/store/**` — `DataStore`, Local/Supabase/Offline,
  `selectTolerant`, `isMissingFunctionError`, Buchungs-Idempotenz.
- **Katalog/Preise/FX** `lib/server/**`, `lib/catalog`, `lib/live` — Yahoo/Stooq/
  CoinGecko-Resolution, `quote_pinned`, `quote_scale`, Cron-Self-Heal.
- **Flags/Plan-Gating** `lib/flags/**`, `lib/billing/**` — `resolvePlan`,
  `useFeature`, `atLimit`, RLS `user_has_pro()`.
- **Import/Export** `lib/import/**`, `lib/export/**` — CSV-Parser, Reconcile,
  Fingerprints, Round-Trip.
- **i18n-Kern** `lib/i18n/**` — Dictionary-Parität-Tests (de/es/en). Neue
  Copy-Keys müssen in **allen drei** Locales landen.

**Semantische Ausnahme, die die Spec ausdrücklich erlaubt zu ändern:**
Der Benchmark-Vergleich der Nettovermögenskurve (Übersicht) ist fachlich falsch
(§2.3, §15.3). Wir entfernen die Benchmark-Darstellung **nur auf der Übersicht**,
nicht die zugrunde liegende `netWorthSeries`-Berechnung. Benchmarks bleiben im
Investment-Kontext (Depot/Performance).

Konfliktregel (Spec §25): Widerspricht eine Funktion der Spec, ändern wir **nicht
still die Logik**, sondern dokumentieren den Konflikt hier und halten die
Berechnung stabil.

---

## 5. Risiken

### 5.1 Technisch

| Risiko | Wahrsch. | Auswirkung | Mitigation |
| --- | --- | --- | --- |
| Token-Migration über 120 Dateien bricht Dark/Light subtil | Hoch | Kontrast-/Farbregressionen | Tokens als **zusätzliche** Utilities (`text-primary`, `bg-surface` …) einführen, alte Klassen route-weise ersetzen, nicht global sed |
| `NetWorthHero` von 2 Seiten geteilt → Benchmark-Entfernung trifft Depot | Mittel | Depot verliert Benchmark oder Übersicht behält ihn | Prop `showBenchmarks` bzw. Split in `NetWorthOverviewChart` (Assets/Verb./Netto) vs. `DepotPerformanceChart` |
| Scope-Picker aus Global bar → Page Header ändert `site-nav`/`routes.tsx`-Helfer (`scopesToPortfolio`) | Mittel | Picker doppelt oder verschwindet | Helfer beibehalten, Rendering-Ort in `PageHeader`-Scope-Slot verlagern, Global bar entkoppeln |
| Route-Merge (`/spending`,`/xray` → Tab) darf URLs nicht brechen (§4 „nicht verhandelbar“) | Mittel | 404 auf Altlinks | Alte Routen als Redirect/Alias auf Ziel-Tab (`?tab=`) behalten |
| `react-hooks/set-state-in-effect` bricht Build (Next 16) | Mittel | Build rot | State in async-Continuations/Ableitung, nie sync im Effect (CLAUDE.md) |
| Dictionary-Paritätstests (de/es) schlagen fehl bei neuer Copy | Hoch | Testsuite rot | Jeder neue Key in en+de+es gleichzeitig |
| Chart-Farb-Konsolidierung ändert Serien-Zuordnung (Allocation/Rebalancing) | Mittel | „gleiche Rolle, gleiche Farbe“ verletzt | `chart-1..6` deterministisch je Kategorie zuweisen, nicht per Reihenfolge |
| CSP/Fonts: Spec nennt Google Fonts; App nutzt `next/font` (Geist) | Niedrig | — | Keine externe Font-Änderung nötig |

### 5.2 Fachlich / UX

| Risiko | Mitigation |
| --- | --- |
| „Negative Summe ist kein Fehler“ (§6): Bestandswerte wie Hypothek/Nettovermögen dürfen nicht alarmrot | Farb-Refactor: Bestandswert neutral (primary), nur **Veränderung** semantisch färben. Betrifft Übersicht-Hero, Konten, Debt-Tabelle |
| Begriffs-Vereinheitlichung (§14.2) berührt viele i18n-Keys (`Rein/Raus/Netto/Noch fällig`) | Zentrale Key-Liste, alle Locales; teils bereits erledigt (`Einnahmen/Ausgaben` laut Git-Log) |
| Gesundheit/Haushalt aus Nav entfernen, aber Feature-Flags & Notifications-Zähler zeigen weiter darauf | Flags nicht entfernen; `KIND_FLAGS`/`useNotifications` prüfen, dass kein Zähler auf entfernten Nav-Eintrag zeigt |
| „Keine Feature-Erweiterung als Ersatz für UX“ (§19) | Nur Umbau, keine neuen Features |

---

## 6. Umsetzungsplan nach Phasen

> Regel (Spec §21): jeder Zwischenstand buildbar/testbar. `npm run build`,
> `npm run test`, `npm run lint` müssen grün bleiben. Verifikation in Guest Mode
> mit `PORT=3011` (lokal ist keine Supabase-Env, siehe Memory).

### Phase 1 — Foundations (Kern, keine Seiten-IA)

- [ ] **P1.1 Tokens** `app/globals.css`: semantische Rollen laut §5 ergänzen
      (`--color-bg-app/-sidebar/-surface/-surface-elevated/-surface-hover`,
      `-border-subtle/-strong`, `-text-primary/-secondary/-tertiary`,
      `-brand/-brand-hover`, `-positive/-negative/-warning/-info`,
      `-chart-1..6`), gemappt auf die bestehende `.dark`-Klasse (nicht
      `data-theme`). Als `@theme inline`-Farben exponieren, damit
      `text-brand`/`bg-surface`-Utilities entstehen.
- [ ] **P1.2 Geometrie/Spacing** `space-1..7`, `radius-control(6)`,
      `radius-surface(10)`, `border(1)` als Tokens. Slider (`globals.css`) auf
      brand.
- [ ] **P1.3 Typografie** Skala §5.2 (Page/Section/Card title, KPI, Body,
      Label, Supporting, Table header) als Utility-Klassen; `tabular-nums`
      global für Geld/%/Datum.
- [x] **P1.4 AppShell** `app/layout.tsx`: Content zentriert + `max-w-[1480px]`
      (Wrapper-`div` in `<main>`), Body auf `bg-app text-primary`. Sidebar/Global-
      bar-Feinmaße (240px / 56px, Rail) folgen in Phase 2 mit dem Nav-Umbau.
- [x] **P1.5 Primitives** in `components/ui/` (am Depot-Pilot geerdet):
      - ✅ `Button` → brand-primary + `destructive`-Alias (`primitives.tsx`);
        brand trägt in Dark dunklen Text (Kontrast)
      - ✅ `SummaryStrip` (neu, `primitives.tsx`) — eine Fläche, Trennlinien, kein Rahmen/Stat
      - ✅ `Section` (neu, `primitives.tsx`) — rahmenlos-fähig, Titel/Action-Slot
      - ✅ `InlineNotice` (neu, `inline-notice.tsx`) — `info/success/warning/error`
      - ✅ `Tabs`/`SegmentedControl`/`EmptyState`/`PageHeader`/`Card` auf Tokens
      - `Field` (neu) — offen (kommt am nächsten Formular-Pilot, Depot braucht keins)
      - `ChartCard` (neu) — offen (Depot nutzt weiter `NetWorthHero` als Chart-Engine)
      - `DataTable`-Erweiterung (Zeilenhöhe 44/52, `Mehr`-Menü) — offen
- [ ] **P1.6 Formatierung** `lib/i18n/` bzw. `lib/finance/format`: Währung,
      Prozent (`+5,76 %`), Datum kurz/lang, Dauer (`22 Jahre, 11 Monate`),
      Unbekannt `–`. Vorhandene Helfer konsolidieren, nicht duplizieren.

**DoD Phase 1:** Primitives existieren, Build/Tests grün, keine Seite migriert.

> **Entscheidung 19.08.:** P1.1 Tokens + P1.2 Geometrie sind erledigt und
> bauen grün (`app/globals.css`). Die **neuen Primitives** (SummaryStrip,
> Section, Field, ChartCard, InlineNotice) und die **brand-Button-Umstellung**
> werden nicht spekulativ vorgebaut, sondern **am Depot-Pilot (Phase 3) im
> echten Kontext** erstellt und dort verifiziert (Spec §21/§25).

### Phase 2 — Navigation & Header

- [x] **P2.1a (IA-Labels + `/debt`-Umgruppierung, nicht strandend)** Gruppen-Labels
      auf Spec-IA gesetzt (de `Geld`/`Investments`/`Planen`, en `Money`/…, es
      `Dinero`/…) in allen drei Locales; `/debt` von `everyday` nach `plan`
      (`lib/nav/routes.tsx`). Verifiziert: Sidebar zeigt GELD/HAUSHALT/INVESTMENTS/
      PLANEN, Verbindlichkeiten steht jetzt unter Planen. Keine Route gestrandet.
- [~] **P2.1b (IA-Entfernungen, an Ziel-Tabs gekoppelt — bewusst offen)**
      `household`-Gruppe entfernen (Haushalt → Settings, Ziel-Abschnitt fehlt noch);
      `/health` aus Nav (→ Übersicht-Abschnitt, Phase 4); ~~`/xray` aus Nav (→
      Analyse-Tab, Phase 5)~~ **erledigt mit P5.1** (X-Ray-Tab existiert, Nav-Eintrag
      entfernt, Route strandet nicht dank Redirect). Jede Entfernung strandet ihre
      Route, bis das Ziel existiert — deshalb erst mit Phase 4/5.
- [x] **P2.2 (Chrome-Tokens + aktiver Zustand)** `components/sidebar.tsx` +
      `mobile-nav.tsx` auf semantische Tokens migriert (`bg-sidebar`,
      `border-subtle`, `text-primary/-secondary/-tertiary`, `text-brand`,
      `rounded-control`, `surface-hover`). Aktiver Sidebar-Eintrag trägt jetzt
      Fläche + Kontrast + brand-Akzentbalken links (`before:`-Bar, nicht nur
      Farbe). Eingeklappte Rail mit Tooltips + Bottom-Nav existierten bereits.
- [x] **P2.3 (Chrome-Tokens)** `site-nav.tsx` Global bar auf Tokens migriert
      (`bg-surface/80`, `border-subtle`, brand-Logo). Scope-Picker aus der Global
      bar entfernt — die Leiste trägt jetzt nur noch seiten-neutrale Chrome
      (Theme-/Privacy-Toggle, Account-Menü). Erledigt zusammen mit P2.4.
- [x] **P2.4** `PageHeader`/`PageHeaderWithTour` haben einen `scope`-Slot, der
      als erstes Element der rechten Control-Gruppe vor `actions` rendert
      (Reihenfolge §7.1: Scope → Zeitraum → Aktion). Neuer `PageScope`
      (`components/page-scope.tsx`) löst den Picker aus der Route auf
      (`scopesToPortfolio`/`scopesToAccounts`, Helfer unverändert) und sitzt in
      jedem scopenden Header: `/portfolio`, `/analysis`, `/dividends` (PageHeader),
      `/accounts` (Account-Achse, vor dem `MonthPicker`), `/rebalancing`,
      `/simulation` (rohe h1 → Flex-Header) und der geteilten `AssetDetail`
      (`/assets`, `/instruments`). Verifiziert Desktop 1440×900 + Mobile 390×844,
      DE/EN, Dark/Light: Picker nur noch im Page Header, keine Konsolenfehler.
- [~] **P2.5** URL-Kompatibilität: Redirects. `/xray`→`/analysis?tab=xray`
      **erledigt mit P5.1** (307). Offen: `/spending`→`/accounts?tab=bookings` etc.
      (Alt-URLs bleiben erreichbar).

**DoD Phase 2:** Neue Nav steht, alle Alt-URLs erreichbar, Notifications-Zähler
zeigen auf gültige Ziele.

### Phase 3 — PILOT `Depot` (vollständige vertikale Slice, Spec §21/§25)

- [x] **P3.1** `app/portfolio/page.tsx` auf Tabs `Positionen \| Sparpläne \|
      Watchlist \| Historie` umgestellt (Keys in en/de/es). Positionen trägt
      Chart + aktuelle Positionen + Cash-Zins; Sparpläne/Watchlist/Historie je
      eigener Tab.
- [x] **P3.2** `NetWorthHero` bleibt als Chart-Engine (Benchmarks nur hier,
      Segmented Controls `Vermögen/Rendite`, `Linear/Log`) — nicht mid-Pilot
      neu geschrieben (Risiko: shared mit Übersicht). Split in dedizierte
      `ChartCard`/`SummaryStrip` verschoben (s. Abweichungen).
- [x] **P3.3** Sparpläne/Watchlist in Tabs; `AssetTable` bekam `view`-Prop
      (`current`/`past`/`all`) → aktuelle Positionen in „Positionen“, die schon
      vorhandene „Frühere Positionen“-Ableitung in „Historie“.
- [x] **P3.4** Verifiziert Desktop 1440×900 (Light + Dark) + Mobile 390×844
      (Guest Mode, PORT=3011). Build/Lint/Dictionary-Tests grün.

**DoD Phase 3:** Depot in Tabs, Tokens greifen in Light+Dark, Desktop+Mobile
verifiziert. **Zwischenbestätigung offen, bevor Konten migriert wird (Spec §25).**

**Bewusste Abweichungen vom Soll (§11.1), für die Freigabe:**
1. **Kein separater `SummaryStrip` + `ChartCard` im Depot.** `NetWorthHero`
   vereint KPI-Leiste + Performance-Chart + Risiko-Kennzahlen in einer Fläche
   und wird mit der Übersicht geteilt. Ein Split hätte den geteilten Chart
   mitten im Pilot umgebaut. `SummaryStrip`/`Section`/`InlineNotice` sind gebaut
   und getestet, aber im Depot noch nicht eingesetzt — der Split kommt, wenn die
   Übersicht (Phase 4) denselben Chart anfasst, damit beide konsistent bleiben.
2. ~~**Scope-Picker („Alle Portfolios“) sitzt noch in der Global bar**~~
   **Erledigt (P2.4):** sitzt jetzt im `scope`-Slot des Page Headers, hier im
   Depot vor „Teilen/Export/+ Position".
3. **`Field`/`ChartCard`/`DataTable`-Ausbau** nicht gebaut — der Depot-Pilot
   braucht kein Formular und nutzt `NetWorthHero`; sie entstehen am jeweils
   ersten Bedarf.
4. ~~**Chrome (Sidebar/Global bar) noch nicht token-migriert.**~~ **Erledigt**
   (P2.2/P2.3 Chrome-Tokens): Sidebar, MobileNav und Global bar laufen jetzt
   auf semantischen Tokens, in Light+Dark verifiziert (1440×900 + 390×844).

### Phase 4 — PILOT `Konten` + restlicher Geldbereich & Übersicht

- [x] **P4.1 (Konten-Pilot)** `app/accounts/page.tsx`: Tabs `Konten \| Buchungen \|
      Wiederkehrend`. Konten gruppiert (Zahlungsverkehr/Rücklagen/Sonstiges/Kredite,
      `accountGroup`). Neue Primitive `components/ui/summary-strip.tsx` (§7.2, eine
      Fläche, Trennlinien zwischen den Kennzahlen, mobil horizontal): Guthaben/
      Kreditsalden/Veränderung(tf)/Konten. Bestandswerte NEUTRAL (Kreditsalden,
      Kontosaldo, Nettowert nicht mehr rot — nur die Veränderung trägt semantische
      Farbe). `AccountsHero` in `AccountsSummary` + `AccountsChart` gesplittet, Chart
      unter die Liste demoted. Buchungstabelle → Tab `Buchungen` (`SpendingView
      showRecurring={false}`), Accordion → Tab `Wiederkehrend` (`RecurringCard`).
      `/spending`-Redirect bleibt. Verifiziert (DE, Guest, Light+Dark 1440×900 +
      Mobile 390×844): Gruppen + neutrale Salden + drei Tabs + gestapelter Strip
      mobil. tsc/lint/Dictionary-Paritäten grün.
      **Erledigt mit P2.4:** Account-Selector sitzt jetzt im `scope`-Slot des
      Page Headers, vor dem `MonthPicker`. **Offen/gekoppelt:** innere
      Formulare/Dialoge (Buchungsmaske, Edit-Dialoge) noch nicht token-migriert
      (nur Struktur + Farbe). Tour-Text „Vermögen minus Schulden" leicht veraltet
      ggü. dem neuen Strip.
- [x] **P4.2** `app/cashflow/page.tsx`: Tabs `Übersicht \| Budgets \| Prognose`
      (Budgets/Prognose-Tab nur bei aktivem Feature, Locked bleibt sichtbar via
      ProTeaser). Übersicht = Totals + neue Karte „Geldfluss" mit
      `Balken \| Geldfluss`-Umschalter: Balken (Default) = gerankte Balken je
      Kategoriegruppe in zwei Spalten (Einnahmen/Ausgaben), Geldfluss = das
      bestehende Sankey. Neue reine Funktion `spendingGroupBreakdown`
      (`lib/finance/spending.ts`, gleiche Gruppierung wie das Sankey, ohne
      Klein-Faltung). Prognose-Tab blendet den MonthPicker aus (Forecast schaut
      nach vorn). Netto behält semantische Farbe (Fluss, kein Bestand). Keys in
      en/de/es. `tsc`/lint/Dict-Parität grün; Guest verifiziert DE Light+Dark
      1440x900 + Mobile 390x844, keine Konsolenfehler.
      **Erledigt:** Der „keine Kategorien"-Zustand (ganzer Kartenkörper, kein
      Add-Form darunter) nutzt jetzt `EmptyState` (neuer Titel-Key
      `spending.budgets.noCategoriesTitle` in en/de/es, alter Satz als Hint).
      Der „noch keine Budgets"-Fall bleibt bewusst Inline-Hint: sein Add-Form
      steht direkt darunter, ein zentrierter Leerzustand wäre dort falsch.
- [x] **P4.3** `app/page.tsx` Übersicht (§9 vollständig). **Teil 1 + Finanzstatus erledigt**
      (Spec §9/§17). `NetWorthHero` gated über das bestehende `investmentsOnly`:
      - **Rendite/Benchmark raus aus der Übersicht:** Benchmark-Picker,
        Vermögen/Rendite-Umschalter und die Risiko-Kennzahlenreihe (ZGR, Vola,
        Drawdown ...) rendern nur noch auf `/portfolio`; `showScopeNote` nur noch
        bei sichtbarer Rendite-Linie (Inkognito).
      - **Finanzstatus-Strip** statt der 6-Stat-Depotreihe: Nettovermögen
        (neutral) · Veränderung (tf) (semantisch gefärbt, §6.2) · Liquid
        verfügbar (`liquidBalance`, Sub = abgedeckte Monate) · Investiert
        (Marktwert, Sub = G/V-%) · Verbindlichkeiten (neutral). IZF, Dividenden,
        realisiert/unrealisiert und Sparquote sind damit von der Übersicht
        entfernt (gehören auf `/portfolio` bzw. in die Gesundheit-Sektion).
      - Redundante Zusammensetzungs-Zeile entfernt; die tote Komponente
        `net-worth-composition.tsx` gelöscht, stale Kommentar in
        `month-flow-card.tsx` korrigiert.
      - Terminologie `Noch fällig` → `Noch ausstehend`; `MonthFlowCard` auf
        semantische Token migriert.
      - Neue Keys `overview.status.*` in en/de/es. `tsc`(nur generierter
        `.next`-Rest)/lint/Dict-Parität grün; Guest DE Light+Dark 1440x900 +
        Mobile 390x844: Dashboard = Finanzstatus + reine Nettovermögens-Linie,
        `/portfolio` = alle Depot-Werte erhalten, keine Konsolenfehler.
      **Teil 2 — Gesundheit-Sektion + 3-Serien-Chart erledigt:**
      - **Gesundheit als kompakter, anklickbarer Abschnitt** (§9): neue
        `components/dashboard/health-summary-card.tsx` (gated `finHealth`,
        `useFeature` → `ProTeaser` bei Lock, sonst nichts), rendert die vier
        Kennzahlen kompakt und verlinkt als Titel auf `/health` (Muster wie
        `AreaHead`). Sparquote lebt jetzt hier statt in KPI-Reihen. Eingehängt
        in `app/page.tsx` nach den AreaCards. Keine neuen i18n-Keys (reuse
        `health.*`).
      - **3-Serien-Chart Assets/Verbindlichkeiten/Netto** (§9): neue pure,
        additive Funktion `netWorthBreakdownSeries` (`lib/finance/portfolio.ts`)
        — Holdings-Schleife in geteilten Helfer `holdingsValueSeries`
        refaktoriert (verhaltensneutral, alle 1289 Tests grün), Asset-/Passiv-
        Seite je eigener `accountsValueSeries`-Pass, `net` == `netWorthSeries`
        exakt (Test deckt das ab). Neue Komponente
        `net-worth-breakdown-chart.tsx` (drei Währungslinien, Netto via
        currentColor als Headline, Null-Referenzlinie damit negatives Netto
        lesbar ist, eigene Legende + Tooltip, kein %/Benchmark/Log). Im Hero
        nur auf dem Dashboard und nur im Währungsmodus (Inkognito → weiter
        Rendite-Linie); Log-Toggle auf dem Dashboard aus (`scaleAvailable=
        investmentsOnly`). Neue Keys `overview.chart.assets` +
        `chart.netWorthBreakdown.ariaLabel` in en/de/es.
      - Verifiziert Guest DE Light+Dark 1440x900 + Mobile 390x844 + EN: KPIs
        zeigen korrekt negatives Nettovermögen (-277.563,12 €, neutral),
        Chart zeigt Vermögen(grün)/Verbindlichkeiten(rot)/Netto(hell/dunkel)
        mit Null-Linie, Tooltip mit allen drei Werten, keine
        Benchmark/Rendite/Log, keine Konsolenfehler. `tsc`/lint/Dict-Parität/
        `portfolio.test.ts` (Breakdown-Tests) grün.
      **Teil 2 — Planfortschritt + Wichtige Hinweise + §9-Umbau erledigt**
      (Owner-Entscheid: AreaCards strikt nach §9 ersetzen, nicht koexistieren):
      - **Planfortschritt-Karte (M2)** neue `plan-progress-card.tsx`: drei
        Fortschrittsbalken — Notgroschen (`months / 3` Monate, Warntönung wenn
        unter dem 3-Monats-Boden), Ziele (dieselbe Rechnung wie die frühere
        GoalsCard: abgeleitete Payoff-Ziele + Top-Level-Ziele, top 3, „Alle
        Ziele"-Link ab >3, „n von m erreicht"), Schulden getilgt (Σ getilgt /
        Σ Höchststand über alle Verbindlichkeiten). Jede Zeile self-gated am
        Flag (Muster wie `MonthFlowCard`), Karte rendert nur was getrackt wird.
      - **„Aktueller Monat"-Paar (M):** `MonthFlowCard` (Cashflow) + neue
        `PlanProgressCard` nebeneinander im 2-Spalten-Grid in `app/page.tsx`;
        das Grid trägt jetzt `data-tour="areas"` (Tour-Schritt „Alltagsgeld"
        umgehängt, Copy in en/de/es neu getextet auf das Monatspaar).
      - **Wichtige Hinweise (I):** neue pure `lib/finance/insights.ts`
        (`keyInsights`, gerankt, cap 3, nur aus echten Zahlen: negative
        Sparquote / Notgroschen < 3 Mon. / Schulden > 3x Jahreseinkommen /
        erreichte Ziele) + Test `tests/insights.test.ts` (7 grün). Neue
        `key-insights-card.tsx` mappt id→Copy, rendert klickbare Zeilen
        (Severity-Punkt statt Badge), nichts wenn leer.
      - **AreaCards entfernt:** `components/dashboard/area-cards.tsx` gelöscht
        (Konten→KPIs, Ausgaben→Cashflow, Ziele→Planfortschritt). Obsoleten
        e2e-Test (`[data-tour="area-accounts"]`) in `dashboard-kpis.spec.ts`
        entfernt; Ranking bleibt über die `accountsTotals`-Unit-Tests gedeckt.
        Neue Keys `overview.plan.*` + `overview.insight(s).*` in en/de/es.
      - Verifiziert Guest DE Light+Dark 1440x900 + Mobile 390x844 + EN:
        Übersicht = KPIs → 3-Serien-Chart → Dieser Monat/Planfortschritt-Paar →
        Wichtige Hinweise → Gesundheit; Balken/Insights korrekt (Notgroschen
        3,1/3, Ziele 50%/0%, Schulden 0%, Hinweis „Schulden 7,8x
        Jahreseinkommen"), keine alten AreaCards, keine Konsolenfehler.
        `tsc`/lint/Dict-Parität/`insights`+`portfolio`-Tests grün.
      **Rest-Drift für Phase 6 (e2e):** `dashboard-kpis.spec.ts` prüft noch die
      alten Hero-Labels („Savings rate"/„Months of expenses covered") und einen
      „Return"-Toggle, die seit dem §9-Hero-Umbau nicht mehr auf der Übersicht
      sind — gehört in den Phase-6-e2e-Durchgang (nicht durch diese Änderung
      verursacht).
- [x] **P4.4** MonthPicker in Page Header aller Geldseiten (eine Komponente).
      Bereits durch P4.1/P4.2 erfüllt: `/accounts` und `/cashflow` teilen die
      eine `MonthPicker`-Komponente im PageHeader; konkurrierende Fenster-Controls
      (`ChartControls` im Konten-Hero, Timeframe im Sankey) werden ausgeblendet,
      sobald ein Monat gewählt ist. `/spending` leitet auf `/accounts` um, hat
      also keinen eigenen Picker. Kein separater Codeaufwand nötig.

**DoD Phase 4:** Geld+Übersicht erfüllen §9/§10, Bestandswerte nie „rot wegen
Minus“.

### Phase 5 — Investments (Rest) + Planung + Einstellungen

- [x] **P5.1** `/analysis` + `/xray` zusammengeführt. X-Ray ist jetzt ein
      erstklassiger Tab in `/analysis` (Reihenfolge Verteilungen · **X-Ray** ·
      Renditen · Trades · Risiken · Steuern), flag-/Pro-gegated wie Risiken/Steuern
      (Tab bleibt sichtbar, `ProTeaser` bei locked, verschwindet nur bei disabled).
      `/xray` ist ein 307-Redirect auf `/analysis?tab=xray` (Alt-Links/Bookmarks
      bleiben gültig, Flag-Degradation läuft über die Analyse-Seite). Standalone
      Nav-Eintrag entfernt (`lib/nav/routes.tsx`), `/xray` aus `PORTFOLIO_SCOPED`
      genommen (Redirect rendert keinen Header). Der Breakdown-Wähler der
      Verteilungen ist von einer handgerollten Pill-Gruppe auf das geteilte
      `SegmentedControl` (semantische Tokens) umgestellt — die Sekundärdimension
      des einen Donuts. Neue Dict-Keys `analysis.tab.xray`/`analysis.blurb.xray`
      in en/de/es. **Verifiziert** Guest 1440×900: /xray→?tab=xray mit aktivem
      X-Ray-Tab (aria-selected), Tabreihenfolge DE+EN, kein Standalone-Nav-Link,
      Donut+Legende + SegmentedControl (Dark), Look-through-Tabelle (Light), keine
      Konsolenfehler. tsc/lint/Dict-Parität grün. e2e: navigation.spec X-Ray-Zeile
      entfernt + Redirect-Test ergänzt. **Rest für Phase 6:** `XRAY_TOUR_STEPS` +
      `tour.xray.*`-Keys sind jetzt tot (X-Ray hat als Tab keinen eigenen Tour-
      Button mehr; die Analyse-Tour deckt die Tableiste); Parität bleibt heil, da
      alle drei Locales die Keys behalten.
- [x] **P5.2** `/dividends`: die drei handgerollten Card-Header
      (`<div flex justify-between><h2>…<InfoTip/></h2>…</div>`) auf das geteilte
      `SectionTitle`-Primitiv umgestellt — `actions`-Slot trägt das SegmentedControl
      (Einnahmen) bzw. den Summenwert (Anstehende). Tabellen liefen schon über die
      geteilte `Table`/`TablePagination`/`useSort`, KPIs über `Stat`/`StatRow`,
      Skeletons statt Spinner. **Prognose war und bleibt markiert:** `≈` auf JEDEM
      Anstehend-Betrag, bestätigter Termin grün gekennzeichnet, Disclaimer-Zeile
      unter der Tabelle. `InfoTip`-Direktimport entfernt (nur noch via `SectionTitle`).
      **Verifiziert** Guest 1440×900 DE-dark + EN-light: drei Section-Header mit ⓘ,
      SegmentedControl/Summe rechtsbündig, keine Konsolenfehler. tsc/lint grün.
- [x] **P5.3** `/rebalancing`: Ist/Ziel/Differenz-Balken statt zwei Donuts;
      einheitliches Segmented Control; Gesamtwert einmal.
      DONE: Die zwei fast identischen Donuts (`RebalanceDonut` + Recharts Pie)
      durch die `DeviationBars`-Abweichungsansicht ersetzt — je Position ein
      Ist-Balken (voll) und ein Ziel-Balken (umrandet), auf das größte Gewicht
      skaliert, plus Drift in Prozentpunkten (plColor, geteiltes `activeName`
      mit der Tabellenzeile beim Hover). Gesamtwert nur noch einmal (im
      `SectionTitle`-actions des Abweichungs-Cards). Beide Card-Header auf das
      `SectionTitle`-Primitiv gehoben (mode-SegmentedControl + Ziel-Summe% +
      Normalisieren-Button in `actions`; Tour-"?" in den Titel-Children).
      `Normalisieren`/`Position hinzufügen` von handgerollten `<button>` auf das
      `Button`-Primitiv (variant secondary, size sm). Recharts/`Slice`-Imports
      und die `currentSlices`/`targetSlices`-Memos entfernt. Neuer Key
      `rebalance.deviation` in en/de/es. Verifiziert: tsc/eslint grün, Parity
      grün, Guest 1440x900 DE-dark + EN-light (0 recharts-svgs, beide
      SectionTitles, Balken in beiden Themes sauber, keine Konsolenfehler).
- [x] **P5.4** `/debt`: Summary Strip; Sondertilgung in Drawer/Dialog;
      Restschuld-Chart; Bestandswerte neutral.
      DONE: Totals-Card durch das geteilte `SummaryStrip`-Primitiv (§7.2, wie
      /accounts) ersetzt — vier neutrale Kennzahlen (offene Verbindlichkeiten,
      Mindestzahlung, Zeit bis schuldenfrei + konkretes Datum als context,
      Zinsen) in EINEM Rahmen mit Dividern, kein Card-pro-Kennzahl mehr. Jede
      Zahl neutral (kein `valueClassName`), weil ein Schuldenstand ein Bestand
      und kein Fehlerzustand ist. **Sondertilgung nicht mehr als dauerhaft
      leere Formularzeile:** das Account/Datum/Betrag-Formular wandert in einen
      `Modal` (max-w-lg, `FormActions`-Footer, Abbrechen vor primärem
      "Sondertilgung hinzufügen"), geöffnet über den Header-Button im
      Sondertilgungs-Block; die geplanten Sondertilgungen bleiben als Tabelle
      sichtbar, sonst der Empty-Text. Card-Header (Tilgungsplan, Deine
      Verbindlichkeiten, Zins und Tilgung pro Jahr) auf `SectionTitle` gehoben.
      Restschuld-Chart und die neutrale Schuldentabelle blieben unverändert
      (waren schon konform). Keine neuen Dictionary-Keys (bestehende
      `debt.repayments.*`/`common.cancel` wiederverwendet). Verifiziert: tsc
      EXIT 0, eslint EXIT 0, Parity 6 grün, Guest 1440x900 DE-dark + EN-light
      (Summary Strip vorhanden, kein Inline-Formular vor dem Öffnen, Dialog
      öffnet mit Datumsfeld, keine Konsolenfehler).
- [x] **P5.5** `/retirement`: FIRE+Rente auf gemeinsames Planungsraster;
      `InlineNotice` für Statusaussagen; drei FIRE-Varianten gleiche Reihenfolge.
      Erledigt: (1) beide Tabs bereits Annahmen-Card (Eingaben) getrennt von
      Ergebnisabschnitt; Summary-Card in Rente steht davor (Spec §12.2 erfüllt).
      (2) Alle verstreuten gelben/amber Statuszeilen auf das gemeinsame
      `InlineNotice` (§7.10) umgestellt: FIRE `fire.pension.missing` → info,
      `fire.noExpenseData` → warning; Pension-Summary `outlierNotice`/
      `cappedNotice`/`gap` → warning; `PointsCard` „looksLikeStatements"-Box →
      warning mit `action`-Slot (Button). Feld-Validierungshinweise (`overMax`)
      und die per-Ziel-Risikozeile bleiben bewusst inline (kein Karten-Status).
      (3) Handgebaute `h2 text-lg font-semibold` auf `SectionTitle` gehoben
      (FIRE „Deine Ziele"/„Vollständige Simulation", Pension Vertrags-Dialoge).
      Drei FIRE-Kacheln teilen dieselbe `FireTile`-Komponente, also identische
      Reihenfolge. Keine neuen Dictionary-Keys, keine Finanz-/Store-Änderung.
      Verifiziert: tsc EXIT 0, eslint EXIT 0; Guest 1440×900 FIRE+Rente
      DE-dark + EN-light — Notices rendern (info blau / warning amber, hell+dunkel
      guter Kontrast), 0 Alt-amber-`<p>`, keine Konsolenfehler.
- [x] **P5.6** `/simulation`: Parameter-Ergebnis-Template (Spec §12.3).
      (1) Layout auf `lg:grid-cols-[380px_minmax(0,1fr)] lg:items-start`
      umgestellt; Parameter-Card ist `lg:sticky lg:top-6 self-start` (380px,
      im 360–400px-Fenster), Ergebnis nimmt den Rest. (2) Ergebnisreihenfolge
      gedreht: zuerst die Projektions-Bandbreite (Chart-Card), danach die
      Kennzahlen (StatRow), danach Szenariodetails (Entnahme + Strategie-
      vergleich). (3) Empty State auf `EmptyState` (Nutzen + Schritte, kompakt
      statt riesiger h-80-Fläche) statt handgebautem Block. (4) `Wert eingeben`
      ist kein loser Textumschalter mehr: `SliderField` zeigt ein verbundenes
      Zahlenfeld direkt neben dem Slider (beide bearbeiten denselben Wert), der
      `manual`-Toggle und `sim.enterValue`/`sim.useSlider` entfielen als
      Nutzung. (5) Modellannahmen über dasselbe `InlineNotice`:
      `CustomAssumptionsNote` → info mit Reset im `action`-Slot; die
      Portfolio-Modellnotiz (pureGuess → warning, blended → info) sitzt in einer
      neutral gerahmten Box, Gewichtsbalken neutralisiert. (6) Panel-/Ergebnis-
      Header (Parameter, Projiziertes Vermögen, Entnahme) auf `SectionTitle`.
      „Simulation starten" bleibt die einzige primäre Aktion. Keine neuen
      Dictionary-Keys, keine Finanz-/Store-Änderung. Verifiziert: tsc EXIT 0,
      eslint EXIT 0; Guest 1440×900, DE-dark + EN-light — Band-zuerst-Reihenfolge,
      Panel 380px sticky, verbundene Zahlenfelder, InlineNotice hell+dunkel mit
      gutem Kontrast, kompakter Empty State, keine Konsolenfehler.
- [x] **P5.7** `/goals`: Summary+Section, einheitliche Kartenreihenfolge (Spec §12.4).
      (1) Neues Summary-Band (`StatRow cols={4}`, nur wenn Ziele existieren):
      Ziele-Anzahl, Zielsumme, Gespart, Gesamtfortschritt — Summe über die
      Top-Level-Zeilen (Composite summiert seine Teile schon, Payoff-Ziele sind
      selbst Top-Level, also kein Doppelzählen). (2) Tabellenspalten auf die
      kanonische Reihenfolge gebracht: Name, Zielbetrag, aktueller Betrag (neu
      als eigene Spalte `goals.list.current`), Zieltermin, Fortschritt, Status.
      Ist/Ziel-Text aus der Fortschrittszelle entfernt (jetzt eigene Spalten),
      Fortschrittszelle zeigt nur Balken + % + „x / Monat nötig". (3) Neue
      Status-Spalte: `reached` (grün), `onTrack` (neutral), `overdue` (amber) —
      rein präsentativ in der View abgeleitet (`goalStatusOf`, keine Finanz-
      Änderung); overdue nur wenn Zieltermin überschritten und nicht erreicht
      (die einzige echte Planabweichung, Spec §12.4). (4) Fortschrittsbalken von
      Hash-Farbe (`colorForLabel`) auf Brand (emerald) umgestellt, amber nur bei
      overdue — Spec „Brand oder neutral, Warnung erst bei Abweichung". (5)
      Kartenüberschriften auf `SectionTitle`. (6) Sortierung um `current`
      erweitert; Skeleton um ein Summary-Band ergänzt. 9 neue Dictionary-Keys in
      en/de/es (Paritätstests grün). Keine Finanz-/Store-Änderung. Verifiziert:
      tsc EXIT 0, eslint EXIT 0, dictionaries-de/es EXIT 0; Guest 1440×900,
      DE-dark + EN-light — kanonische Spaltenreihenfolge, Summary-Band, Status
      grün/amber/neutral, Brand/amber-Balken, guter Kontrast hell+dunkel, keine
      Konsolenfehler.
- [x] **P5.8** `/settings`: Haushalt-Tab; `/household` → Settings-Seite ohne
      Finanzkennzahlen; Gesundheit in Übersicht endgültig integriert (Spec §13,
      §3.2). (1) `/household` und `/health` aus `lib/nav/routes.tsx` entfernt; die
      `household`-NavGruppe (Typ + `NAV_GROUPS`) samt Kommentaren gelöscht — die
      Gruppe fiel ohnehin leer weg, jetzt auch der tote Gruppentitel. (2) Neuer
      Settings-Tab „Haushalt" (`TABS`/`TAB_LABEL_KEYS` um `household`, Label
      wiederverwendet `nav.household`), sichtbar solange das `household`-Flag an
      ist, ohne Padlock (auch Pro-locked bleiben Einladung annehmen/verlassen
      frei; `HouseholdView` gated seine Create/Invite-Subflächen selbst). Gast
      sieht SectionTitle + `household.registeredOnly`, keine Finanzkennzahlen.
      (3) `?tab=`-Anbindung wie /analysis/-retirement (`useSearchParams`,
      `router.replace`, Suspense-Boundary in `app/settings/page.tsx`); `/household`
      ist jetzt ein `redirect("/settings?tab=household")` (Muster wie /fire).
      (4) `HouseholdView`-Überschriften auf `SectionTitle`. Haushalt-PageTour in
      den Tab verschoben (Targets rendern dort), toter dashboard-Tour-Schritt
      `navHousehold` entfernt. (5) Gesundheit war bereits als
      `HealthSummaryCard` in der Übersicht integriert (verlinkt auf /health) —
      endgültiger Schritt: `/health` aus der Hauptnav, Route bleibt über den
      Card-Link erreichbar. (6) Notification-Route der Haushalt-Einladungen von
      `/household` auf `/settings`; `ProfileMenu` zeigt den Count als
      Overlay-Ring am Avatar und inline am Settings-Eintrag (springt bei
      offenem Invite auf den Haushalt-Tab). Stale Dictionary-Keys entfernt
      (`nav.health`, `nav.group.household`, `tour.nav.household.*`) in en/de/es.
      Keine Finanz-/Store-Änderung. Verifiziert: tsc EXIT 0, eslint EXIT 0,
      volle Unit-Suite 1299 grün (notifications-Test auf `/settings`
      nachgezogen); Guest 1440×900, DE-dark + EN-light — Nav ohne
      Haushalt/Gesundheit, `/household`→`/settings?tab=household`, Tab-Strip
      Allgemein/Haushalt/Gebühren/KI, aktiver Haushalt-Tab bei `?tab=household`,
      registered-only-Copy, guter Kontrast hell+dunkel, keine Konsolenfehler.

### Phase 6 — QA & Bereinigung

- [x] Responsive (1440×900, 1280×800, 768×1024, 390×844) + Screenshots (§22.5).
      Automatisierter Sweep über 14 migrierte Seiten × 4 Viewports (de-dark
      Hauptdurchgang, en-light Desktop+Mobile) mit Body-Overflow-Messung +
      Konsolenfehler-Erfassung. **Ein echter Bug gefunden und behoben:** auf den
      portfolio-scoped Seiten (portfolio, analysis, dividends, rebalancing,
      simulation) scrollte der `<body>` bei 390px horizontal (+132px de / +81px
      en) — der Gast-Cluster oben rechts (`PortfolioPicker` + Theme + Privacy +
      „Anmelden" + „Registrieren") war mit `shrink-0` fixiert und breiter als
      der Viewport. Fix in `components/site-nav.tsx`: `<nav>` und der Cluster
      dürfen jetzt wrappen (`flex-wrap`, `shrink-0` entfernt, `justify-end`),
      die zwei Gäste-Auth-Buttons auf `size="sm"` (ab `md` identisch zur
      Default-Größe, Desktop also unverändert). Verifiziert: Sweep danach **0
      Probleme** (kein Overflow, keine Konsolenfehler) über alle 4 Viewports +
      beide Themes; Desktop 1440 optisch unverändert, Mobile 390 sauberer
      2-/3-Zeilen-Wrap rechtsbündig. tsc/lint grün.
- [x] Keyboard/Focus, Kontrast (WCAG 2.2 AA), Rot/Grün + zweites Signal.
      **Fokus (2.4.7) — Lücke gefunden und geschlossen:** `Button`, `Toggle`,
      `SegmentedControl`, `Tabs` und der `SelectMenu`-Trigger hatten **keinen**
      sichtbaren Keyboard-Fokus (nur der Browser-Default, in Dark ~unsichtbar
      1px). Ein geteiltes `FOCUS_RING` (emerald 2px, `focus-visible`, spiegelt
      den Ring der sortierbaren Tabellen-Header) in `components/ui/primitives.tsx`
      definiert und auf alle fünf plus die beiden Icon-Toggles (Theme/Privacy)
      und den `PortfolioPicker`-Trigger angewandt (`AccountPicker` nutzt
      `SelectMenu`, also automatisch abgedeckt). Per Playwright durch die Top-Nav
      getabbt: jeder Control zeigt jetzt `outline solid 2px` in Emerald, vorher
      `auto 1px`. **Rot/Grün (1.4.1) — bereits erfüllt, kein Eingriff:** Verluste
      tragen immer ein Minus, Renditen immer ein signiertes Prozent
      (`formatPercent` erzwingt `signDisplay:"exceptZero"`), Farbe ist also nie
      das einzige Gewinn/Verlust-Signal. tsc/lint/test/build grün.
- [x] Light-Mode-Durchsicht + Zustände. en-light Desktop+Mobile im Responsive-
      Sweep ohne Fehler; zusätzlich gezielter Empty-State-Durchgang (frischer
      Gast, keine Daten) über Dashboard/Konten/Ausgaben/Ziele/Dividenden in
      Light: konsistente `EmptyState`/„Not enough data yet", `FormActions`-
      Gating (deaktivierter „Add goal"), tabular-nums, Guest-Mode-Hinweis, keine
      Badges. (Der native Date-Input zeigt `tt.mm.jjjj` — Browser-Chrome nach
      OS-Locale, nicht App-Copy, daher kein Defekt.)
- [x] Tote Styles/Varianten entfernen; verwaiste Flags prüfen (CLAUDE.md-Regel).
      `XRAY_TOUR_STEPS` (seit P5.1 ohne Importer — X-Ray ist ein Tab ohne
      eigenen Tour-Button) aus `lib/onboarding/tour-steps.ts` entfernt, samt der
      4 nur daran hängenden `tour.xray.*`-Keys aus en/de/es (Parität bleibt
      heil). `dashboard-kpis.spec.ts` gegengeprüft: bereits durch P4.3 auf das
      §9-Hero aktualisiert (nicht stale). Flags `finHealth`/`household`/`xray`
      sind laut Entscheidung #3 bewusst behalten und gaten weiter ihre Features
      (Health-Route+Übersichtscard, Settings-Tab, Analyse-Tab), also nicht
      verwaist.
- [x] `npm run test` (1299 grün, Dictionary-Parität grün), `npm run lint`
      (sauber), `npm run build` (kompiliert, keine Warnungen).
- [x] **Liste verbliebener Abweichungen (§22.7)** — siehe §6a unten.

---

## 6a. Verbliebene Abweichungen vom Soll (Spec §22.7)

Stand Abschluss Phase 6. Jeder Punkt ist gegen den **aktuellen Code** geprüft,
nicht nur gegen den Status-Text. Keiner davon ist ein Regressions- oder
Finanz-/Store-Defekt; es sind bewusst gekoppelte Reste und eine Scope-Grenze.

1. ~~**Scope-Picker sitzt noch in der Global bar, nicht im Page Header.**~~
   **Erledigt (P2.4).** `PageHeader`/`PageHeaderWithTour` haben jetzt einen
   `scope`-Slot, der als erstes Element der rechten Control-Gruppe vor `actions`
   rendert (§7.1: Scope → Zeitraum → Aktion). Der neue `PageScope`
   (`components/page-scope.tsx`) löst `PortfolioPicker`/`AccountPicker` aus der
   Route auf (`scopesToPortfolio`/`scopesToAccounts` unverändert) und sitzt im
   Header jeder scopenden Seite; `site-nav.tsx` trägt keinen Picker mehr, nur noch
   seiten-neutrale Chrome. Verifiziert Desktop+Mobile, DE/EN, Dark/Light, ohne
   Konsolenfehler.

2. **P1.6 Formatierungs-Konsolidierung nicht ausgeführt.** Währung/Prozent
   (`+5,76 %`)/Datum/Dauer/Unbekannt (`–`) laufen weiter über die bestehenden
   Helfer (`lib/format.ts`, `lib/i18n/duration.ts`, `slice-label.ts` …) statt
   über eine einzelne konsolidierte Schicht. **Keine Dublette eingeführt**, aber
   die im Spec skizzierte Ein-Schicht-Formatierung wurde nicht gebaut, weil kein
   Call-Site sie brauchte.

3. **Neue Primitives teils ungenutzt.** `SummaryStrip`/`Section`/`InlineNotice`
   sind gebaut **und im Einsatz** (Konten/Cashflow/Übersicht). `Field` **und
   `Input`** sind jetzt ebenfalls gebaut (`components/ui/primitives.tsx`) und am
   ersten echten Call-Site pilotiert — siehe Punkt 4. Noch nicht gebaut:
   `ChartCard` (Depot + Übersicht teilen weiter `NetWorthHero` als Chart-Engine
   — der SummaryStrip/ChartCard-Split wurde bewusst nicht mitten durch den
   geteilten Chart gezwungen), `DataTable`-Ausbau (Zeilenhöhe 44/52 + „Mehr"-
   Menü). Jeweils am ersten echten Bedarf nachzuziehen.

4. **Innere Formulare/Dialoge nur struktur- + farbmigriert.** ~~`Input`/`FormActions`
   greifen bereits, das Feld-Layout ist noch handgerollt (wartet auf `Field`).~~
   **Teil-erledigt: `Field` + `Input` gebaut und Pilot migriert.** Der lokale
   `inputCls`-String war in ~16 Formularen kopiert; `Input` (`components/ui/
   primitives.tsx`, exportiert `INPUT_CLS`) besitzt ihn jetzt, `Field`
   (Label + optionaler Hint über dem Control) ersetzt das handgerollte
   `<div><label/>…</div>`-Tripel. **Pilot: `AccountEditDialog`** (`components/
   accounts/account-edit-dialog.tsx`) — alle 6–9 Felder (Name/Typ/Owner/Währung/
   Stand/Zins + Liability-Zusatzfelder) laufen über `Field`+`Input`/`SelectMenu`,
   kein lokaler `inputCls` mehr. `tsc`/lint grün; Guest verifiziert /accounts
   Edit-Dialog DE Dark + EN Light 1440x900, alle Controls sichtbar, Layout
   deckungsgleich, keine Konsolenfehler. **Zweite Call-Site migriert:** die
   Add-Konto-Maske (`AddAccountForm`, `components/accounts/accounts-view.tsx`) —
   alle 5 Inputs auf `Field`+`Input`, lokaler `inputCls` dort entfernt; Guest
   verifiziert (Formular rendert, Kontoerstellung end-to-end grün, keine
   Konsolenfehler, Layout deckungsgleich). Damit ist `/accounts` komplett auf die
   Primitives. **Dritte Call-Site migriert:** die Add-Position-Maske
   (`AddAssetForm`, `components/assets/add-asset-form.tsx`) — alle 9
   `inputCls`-Inputs (Import-Feld, Name/ISIN/WKN, Anzahl/Preis/Gebühr/Datum) auf
   `Field`+`Input`, lokaler `inputCls` entfernt; die zwei Sonderzeilen mit
   eigener Label-Reihe (Import mit Button, Preis mit „Live"-Link) behalten ihr
   `<div>` und nutzen nur `Input`. `tsc`/lint grün; Guest verifiziert
   DE Dark + EN Light 1440x900 (Maske deckungsgleich, Positionsanlage
   end-to-end grün — Depotwert 300 EUR, keine Konsolenfehler). `add-asset-form`
   gehört zur `mt-1`-Familie (`text-sm font-medium`-Labels), die pixelgleich auf
   die Primitives passt; `transaction-form`/`plan-form` sind die abweichende
   Kompakt-Label-Familie (`mb-1 block text-xs text-zinc-500`), deren Migration
   die Optik ändert und daher eine eigene Design-Entscheidung ist. Die
   restlichen `inputCls`-Call-Sites (cash-interest,
   Buchungsmaske, plan-form, pension-Dialoge …) ziehen inkrementell nach — je am
   nächsten Anfassen, nicht spekulativ in einem Rutsch. **Vierte Call-Site
   migriert:** der Bewertungs-Editor (`ValuationSection`,
   `components/assets/valuation-section.tsx`) — beide Inputs (Datum/Wert) auf
   `Field`+`Input`, lokaler `inputCls` entfernt; sauberer `mt-1`-Familien-Fall,
   also pixelgleich. `tsc`/lint grün; Guest verifiziert DE Dark + EN Light
   1440x900 an einem OTHER-Asset (Bewertungs-Karte deckungsgleich, Datum/Wert
   rendern, keine Konsolenfehler). **Fünfte Call-Site migriert:** die
   Zins-Konfiguration (`CashInterestSection`,
   `components/assets/cash-interest-section.tsx`) — der Zinssatz-Input auf
   `Field`+`Input`, lokaler `inputCls` entfernt; die beiden Nachbar-Spalten
   (Frequenz/Gutschrift-Tag, gleiche `text-sm font-medium`-Labels über
   `SelectMenu`) gleich mit auf `Field` gehoben, damit das Dreispalten-Grid
   einheitlich bleibt. Sauberer `mt-1`-Familien-Fall, pixelgleich. `tsc`/lint
   grün; Guest verifiziert DE Dark + EN Light 1440x900 an einem CASH-Asset
   (Zinsen-Karte deckungsgleich, Zinssatz + beide Selects rendern, keine
   Konsolenfehler). **Sechste Call-Site migriert:** das Ziel-Formular
   (`GoalForm` in `components/goals/goals-view.tsx`) — alle vier Inputs
   (Name/Zielbetrag/Zieldatum/aktueller Betrag) auf `Field`+`Input`, beide
   `SelectMenu`-Spalten (Tracking/Parent, gleiche `text-sm font-medium`-Labels)
   mit auf `Field` gehoben, lokaler `inputCls` entfernt. Die `text-sm`-Hints
   bleiben bewusst als Kind-`<p>` (nicht via `Field`-`hint`, das `text-xs`
   rendert), damit pixelgleich. Sauberer `mt-1`-Familien-Fall. `tsc`/lint grün;
   Guest verifiziert DE Dark + EN Light 1440x900 auf `/goals` (Karte
   deckungsgleich, Dreispalten-Grid intakt, keine Konsolenfehler). **Siebte
   Call-Site migriert:** der Sondertilgungs-Dialog (`DebtRepaymentsPlanner` in
   `components/debt/debt-repayments.tsx`) — beide Inputs (Datum/Betrag) auf
   `Field`+`Input`, die `Verbindlichkeit`-`SelectMenu`-Spalte (`sm:col-span-2`
   via `Field`-`className`) mit auf `Field` gehoben, lokaler `inputCls`
   entfernt. Reiner `mt-1`-Familien-Fall ohne Hints, daher pixelgleich.
   `tsc`/lint grün; Guest verifiziert DE Dark + EN Light 1440x900 auf `/debt`
   (Modal deckungsgleich, `Verbindlichkeit` spannt beide Spalten,
   emerald-Submit im `FormActions`-Footer, keine Konsolenfehler). **Achte
   Call-Site migriert:** die Budgets-Add-Form (`BudgetsCard` in
   `components/spending/budgets-card.tsx`, gerendert auf `/cashflow` im
   Budgets-Tab) — Betragsfeld auf `Field`+`Input`, die `Kategorie`-`SelectMenu`
   (`sm:col-span-2` via `Field`-`className`) mit auf `Field` gehoben, lokaler
   `inputCls` entfernt. Exakter `INPUT_CLS`-Match ohne Hints, daher pixelgleich.
   `tsc`/lint grün; Guest verifiziert DE Dark + EN Light 1440x900 auf
   `/cashflow` (Dreispalten-Grid intakt: `Kategorie` spannt zwei Spalten,
   `Monatliches Limit` einspaltig, emerald-Submit darunter, keine
   Konsolenfehler). Klassifizierung der verbleibenden Sites: exakter
   `INPUT_CLS`-Match und sauber mechanisch migrierbar sind nur noch
   `spending-view.tsx` (5), `planned-form.tsx` (6) und `pension-view.tsx` (30+,
   zu groß für Einzelschritt). `recurring-form.tsx`/`transaction-edit-dialog.tsx`
   weichen im `bg`/`focus` ab; `household-view.tsx`, `share-menu.tsx`,
   `category-manager.tsx` sind bespoke Inline-Flex-Inputs (`flex-1`/`rounded-sm`,
   kein `mt-1`), auf die `Input` nicht sauber passt; `transaction-form.tsx` und
   `plan-form.tsx` bleiben die aufgeschobene Kompakt-Label-Familie. **Neunte
   Call-Site migriert:** die Planungs-Form (`PlannedForm` in
   `components/spending/planned-form.tsx`, Edit-Modal auf `/recurring/planned/[id]`
   und im Wiederkehrend-Tab) — alle fünf Inputs (Name, Betrag, Enddatum, Notiz
   auf `Field`+`Input`; die Nachbar-`SelectMenu`-Spalten Konto/Intervall/Kategorie/
   Umbuchung mit auf `Field` gehoben), lokaler `inputCls` entfernt. Zwei
   Sonderfälle bewusst nicht auf `Field`: das Startdatum behält sein
   handgerolltes `<label>` mit `missingLabelCls` (Amber-Label bei Pflicht+leer,
   das `Field` nicht ausdrücken kann) und bekommt nur `<Input>`; der
   Umbuchungs-Hint bleibt als Kind-`<p className="text-sm">` statt Fields
   `text-xs`-Hint-Prop. `missingFieldCls` wird als `Input`-`className` übergeben
   (Input hängt es hinter `INPUT_CLS`, pixelgleich zum alten
   `inputCls + missingFieldCls`). `tsc`/lint grün; Guest verifiziert DE Dark +
   EN Light 1440x900 auf `/recurring/planned/pln1` (Modal deckungsgleich,
   Dreispalten-Grid intakt, Umbuchungs-Hint in `text-sm`, Notiz spannt zwei
   Spalten, emerald-Submit im `FormActions`-Footer, keine Konsolenfehler). **Zehnte
   Call-Site migriert:** die Buchungs-Erfassungsmaske (`SpendingView`-Entry-Modal in
   `components/spending/spending-view.tsx`, geöffnet über "Buchung hinzufügen" auf
   `/spending`) — alle vier Inputs (Betrag, Datum, Empfänger, Notiz) auf
   `Field`+`Input`, sämtliche Nachbar-`SelectMenu`-Spalten (Konto, Intervall inkl.
   Monatsende-Toggle als Kind, Kategorie mit `footer`, Umbuchung) mit auf `Field`
   gehoben; der lokale `inputCls`-Const (exakter `INPUT_CLS`-Match) entfernt. Ein
   Sonderfall bewusst als Kind statt Field-Hint-Prop: der Umbuchungs-Hint bleibt
   `<p className="text-sm">` (Fields Hint ist `text-xs`). Die Notiz nutzt Fields
   `className="sm:col-span-2 lg:col-span-3"` fürs Vollbreiten-Spanning; die
   Transfer-Anzeige im `transfer`-Zweig (gestrichelter Kasten ohne Input) bleibt
   unverändert. `tsc`/lint grün; Guest verifiziert DE Dark + EN Light 1440x900 auf
   `/spending` (Modal deckungsgleich, Dreispalten-Grid intakt, Umbuchungs-Hint in
   `text-sm`, Notiz volle Breite, emerald "Buchung hinzufügen" im
   `FormActions`-Footer, keine Konsolenfehler). Damit noch ~6
   `inputCls`-Call-Sites offen: `pension-view.tsx` (30+, sauber aber zu groß für
   einen Schritt); `recurring-form.tsx`/`transaction-edit-dialog.tsx` (bg/focus
   abweichend, brauchen Entscheidung); `household-view.tsx`/`share-menu.tsx`/
   `category-manager.tsx` (bespoke inline-flex, `Input` passt nicht); die
   aufgeschobene Compact-Label-Familie `transaction-form.tsx`/`plan-form.tsx`.

   **Elfte Call-Site migriert:** die Ruhestand-/Rente-Seite (`pension-view.tsx`,
   `/retirement`-Rente-Tab) — alle 23 `<input className={inputCls}>` auf das
   geteilte `<Input>` gehoben (Annahmen-Card, Entgeltpunkte-/Renteninfo-Tabelle,
   Vertragswerte), lokaler `inputCls`-Const entfernt. Bewusst **nicht** auf
   `Field` gehoben: die Seite nutzt ein eigenes gedämpftes Label-Idiom
   (`<label className="block text-sm"><span className="text-zinc-500">…`), das
   `Field`s fettes `font-medium`-Label optisch verändern würde — die Label-/Hint-
   Wrapper bleiben unangetastet, nur das `<input>` wird zum `<Input>` (INPUT_CLS
   ist eingebacken, daher pixelgleich). Der Häkchen-`<input type="checkbox">` in
   der Prämien-Liste bleibt unverändert (kein `inputCls`). `tsc`/lint grün; Guest
   verifiziert DE Dark + EN Light 1440x900 auf `/retirement`-Rente-Tab (Annahmen-
   Card: vier Inputs mit gedämpften Labels und `text-xs`-Hints darunter, korrekte
   Border in beiden Themes, keine Konsolenfehler). Damit noch ~5
   `inputCls`-Call-Sites offen: `recurring-form.tsx`/`transaction-edit-dialog.tsx`
   (bg/focus abweichend, brauchen Entscheidung); `household-view.tsx`/
   `share-menu.tsx`/`category-manager.tsx` (bespoke inline-flex, `Input` passt
   nicht); die aufgeschobene Compact-Label-Familie `transaction-form.tsx`/
   `plan-form.tsx`.

   **Zwölfte Call-Site migriert:** das Vertrags-/Wiederkehrend-Formular
   (`RecurringForm` in `components/spending/recurring-form.tsx`, gerendert im
   Bearbeiten-Modal auf `/recurring/contract/[id]` und in der `RecurringCard`).
   Die "brauchen Entscheidung"-Frage (die lokale `inputCls` wich mit
   `bg-white dark:bg-zinc-900` + `focus:border-zinc-400` vom Standard-`INPUT_CLS`
   ab) ist zugunsten der Vereinheitlichung entschieden: alle sechs
   `<input className={inputCls}>` (Name, Betrag, Läuft-seit inkl. Startdatum-Hint
   + Monatsende-Toggle als Kinder, Versicherungssumme, Verlängerungsdatum,
   Kündigungsfrist) auf `Field`+`Input` gehoben, lokaler `inputCls`-Const
   entfernt. Das Formular nutzte bereits exakt das `Field`-Idiom
   (`<label className="text-sm font-medium" htmlFor>`), daher rein mechanisch.
   Da das Formular auf einer `Modal`>`Card`-Fläche (weiß/`zinc-900`) sitzt, ist
   die Normalisierung `bg-white`→`bg-transparent` dort optisch deckungsgleich;
   einziger realer Unterschied ist die um eine Stufe hellere Fokus-Border
   (`zinc-500` statt `zinc-400`). Die `SelectMenu`-Blöcke `contract-account`/
   `contract-kind` bleiben handgerollt: sie tragen ein `data-tour`-Attribut, das
   `Field` nicht durchreicht; ihr `text-sm font-medium`-Label deckt sich ohnehin
   mit `Field`s Label. `tsc`/lint grün; Guest verifiziert DE Dark + EN Light
   1440x900 auf `/recurring/contract/[id]?edit=1` (Modal deckungsgleich, alle
   Inputs mit korrekter Border in beiden Themes, Hints in `text-sm`, Toggle +
   SegmentedControl als Kinder intakt, `FormActions`-Footer, keine
   Konsolenfehler). Damit noch 6 Dateien mit `inputCls`-Call-Sites offen:
   `transaction-edit-dialog.tsx` (identischer Stil wie recurring-form, der direkte
   Zwilling und nächster Schritt); `household-view.tsx`/`share-menu.tsx`/
   `category-manager.tsx` (bespoke inline-flex, `Input` passt nicht); die
   aufgeschobene Compact-Label-Familie `transaction-form.tsx`/`plan-form.tsx`.

   **Dreizehnte Call-Site migriert:** der Buchungs-Bearbeiten-Dialog
   (`TransactionEditDialog`/`EditForm` in
   `components/spending/transaction-edit-dialog.tsx`, Zeilen-Aktion auf
   `/spending`). Der direkte Zwilling von recurring-form: identischer lokaler
   `inputCls`-String (`bg-white`/`focus:border-zinc-400`/`dark:bg-zinc-900`),
   gleiche Entscheidung zugunsten der Vereinheitlichung. Alle vier
   `<input className={inputCls}>` (Datum als `datetime-local` mit `max`,
   Empfänger im `!transfer`-Zweig, Betrag, Notiz) auf `Field`+`Input` gehoben,
   lokaler `inputCls`-Const entfernt. Sitzt in `Modal`>`Card` (weiß/`zinc-900`),
   daher `bg-white`→`bg-transparent` optisch deckungsgleich. Der Payee-Kommentar
   wanderte über das `Field`, der Umbuchungs-Else-Zweig (gestrichelter Kasten)
   bleibt. Die `SelectMenu`-Blöcke (Art/Konto/Kategorie/Umbuchung) bleiben
   handgerollt, Label-Idiom deckt sich mit `Field`. `tsc`/lint grün; Guest
   verifiziert DE Dark + EN Light 1440x900 auf `/spending` (Zeilen-Aktion öffnet
   den Dialog, Zweispalten-Grid deckungsgleich, alle Inputs korrekt in beiden
   Themes, Umbuchungs-Hint in `text-sm`, SegmentedControl + `FormActions` intakt,
   keine Konsolenfehler).

   **Migration hier abgeschlossen (Entscheidung 20.08.2026).** Die 13 migrierten
   Call-Sites waren die echte Dublette: gestapelte Standard-Formularfelder mit
   `text-sm font-medium`-Label. Die 5 verbliebenen lokalen `inputCls`-Consts sind
   eine andere Spezies und bleiben **bewusst unangetastet** — sie aufs geteilte
   `Field`/`Input` zu zwingen würde die UI verschlechtern, nicht vereinheitlichen:
   - **`transaction-form.tsx` / `plan-form.tsx` (Compact-Label-Familie).** Ihr
     `inputCls` ist exakt `INPUT_CLS` *ohne* `mt-1` — bewusst, weil das Label die
     Abstände via `mb-1` trägt; `Input`s eingebackenes `mt-1` ergäbe gegen das
     `mb-1` den doppelten Abstand. Ihr Label ist `mb-1 block text-xs font-medium
     text-zinc-500`, die **andere, im Styleguide dokumentierte**
     Formularfeld-Konvention; `Field` würde es auf `text-sm font-medium` (fett,
     größer) umstellen und das Aussehen der prominentesten Kauf-/Sparplan-
     Formulare ändern. Beide haben zudem custom Suffix-Overlay-Inputs
     (Währungskürzel absolut im Feld), die kein bare `<Input>` sauber abbildet
     (`transaction-form` hat dafür eine eigene lokale `Field`-Variante).
   - **`household-view.tsx` / `share-menu.tsx` / `category-manager.tsx`
     (Inline-flex).** Kompakte Inline-Mikro-Inputs mit `flex-1`/`rounded-sm`/
     `text-xs`/enger Padding; `Input`s festes `mt-1 w-full rounded-md px-3 py-2`
     bricht ihr Flex-Layout, und Tailwind kann diese Utilities per angehängter
     className nicht zuverlässig überschreiben (Konflikt via Stylesheet-Reihen-
     folge, nicht Attribut-Reihenfolge — ohne `tailwind-merge` ein Footgun).

   `Input` um Größen-/Tight-Varianten zu erweitern, nur um diese 5 Stellen
   aufzusaugen, wäre Over-Engineering mit negativem optischen Ertrag. Die lokalen
   `inputCls`-Consts dort sind ein akzeptierter, dokumentierter Rest, kein Defekt.

   Hinweis (dieser Durchgang): Branch-Reparatur vorangestellt. `feat/redesign`
   stand versehentlich auf dem veralteten `origin/feat/redesign` mit einem kaputten
   `git stash pop` im Arbeitsbaum. Aufgelöst per `git reset --hard main` +
   sauberem Re-Apply des `migrate`-Stash (Basis == `main`-Spitze, 0 Konflikte);
   alter Branch-Stand bleibt auf `origin/feat/redesign` + Reflog, `stash@{0}` als
   Backup erhalten. Danach stale `.next/dev` verworfen und Dev-Server neu
   gestartet (interner Next-`validationLevel`-500 nach dem großen Arbeitsbaum-Swap).

5. ~~**Budgets-Card nutzt Inline-Hints statt `EmptyState`** (P4.2).~~
   **Erledigt (Teil 1).** Der „keine Kategorien"-Zustand ersetzt den ganzen
   Kartenkörper (kein Add-Form darunter) und nutzt jetzt `EmptyState`
   (`className="py-8"`, neuer Titel-Key `spending.budgets.noCategoriesTitle` in
   en/de/es, alter Satz als Hint). Der „noch keine Budgets"-Fall bleibt bewusst
   Inline-Hint: sein Add-Form steht direkt darunter, ein zentrierter
   Leerzustand wäre dort falsch. `tsc`/lint/Dict-Parität grün; Guest verifiziert
   /cashflow Budgets-Tab DE Dark + EN Light 1440x900, Titel+Hint sichtbar, keine
   Konsolenfehler.

6. ~~**Redirect-Granularität (P2.5).** `/spending` leitet nur flach auf
   `/accounts`.~~ **Erledigt.** `/spending` leitet jetzt deep auf
   `/accounts?tab=bookings`; `app/accounts/page.tsx` liest den `?tab=`-Param
   (Suspense-Boundary wie `/simulation`s `?mode=`) und wählt den Tab initial,
   aber nur wenn er für den Nutzer existiert (Bookings/Recurring nur bei
   `spending`-Flag), sonst „Konten". `/xray`→`/analysis?tab=xray`,
   `/fire`/`/pension`→`/retirement`-Tabs waren bereits deep. Verifiziert:
   /spending→Buchungen aktiv, Deep-Link aktiv, planes /accounts weiter „Konten",
   keine Konsolenfehler.

7. ~~**/accounts-Tour-Copy leicht veraltet.** „Vermögen minus Schulden".~~
   **Erledigt.** Titel+Body von `tour.accounts.totals` in en/de/es auf den
   neutralen SummaryStrip umgeschrieben (Guthaben/Kreditsalden/Veränderung/
   Kontenzahl statt der nicht mehr gezeigten „Differenz"). Parity-Tests grün.

8. **Admin & `/system` bewusst außerhalb Scope** (Entscheidung #4). Die
   Token-Variablen greifen dort, aber keine IA-/Primitive-Migration. Kein
   Defekt, die vereinbarte Scope-Grenze.

---

## 7. Deliverables-Mapping (Spec §22)

1. Audit + Routen-/Komponentenmatrix → **dieses Dokument (§1–§5)**
2. Tokens + Primitives → Phase 1
3. Nav + AppShell → Phase 2
4. Migrierte Seiten → Phasen 3–5
5. Screenshots (4 Viewports) → Phase 3 (Pilot) und Phase 6
6. Liste bewusst nicht geänderter Logik → **§4**
7. Liste verbliebener Abweichungen → **§6a** (Phase 6 abgeschlossen)

---

## 8. Entschiedene Punkte (bestätigt 19.08.2026)

1. **Reihenfolge:** ✅ Bestätigt. Spec §25: Kern → Depot → Konten → Rest.
2. **Theme-Mechanik:** ✅ Technisch sauberste Variante mit echtem Dark **und**
   Light: Tokens auf `:root` (Light-Werte), Override unter `.dark`. Nutzt die
   bestehende `@custom-variant dark`-Mechanik und das No-Flash-Bootstrap weiter,
   **kein** `data-theme`-Umbau, keine Änderung an den 120 `dark:`-Call-Sites.
3. **Flags entfernter Nav-Einträge** (`finHealth`, `household`, `xray`) bleiben
   erhalten — nur die Nav-Platzierung ändert sich.
4. **Scope-Grenze:** ✅ Nur **Admin & `/system`** bleiben außerhalb (nur Tokens).
   Legal, Login, Pricing, Shared bekommen die volle Token-/Primitive-Behandlung
   (Legal-Inhaltsclaims unverändert laut CLAUDE.md).
5. **Benchmark-Entfernung** nur auf Übersicht, nicht im Depot — einzige erlaubte
   semantische Änderung.

**Status: Phase 1 (Foundations) + AppShell + Depot-Pilot (Phase 3) +
Chrome-Token-Migration (P2.2/P2.3) + IA-Labels & `/debt`-Umgruppierung (P2.1a) +
Konten-Pilot (P4.1: Tabs, SummaryStrip, Gruppierung, neutrale Bestandswerte)
fertig und verifiziert. Damit sind beide Piloten (Depot + Konten) durch.
Scope-Picker in den Page Header (P2.4) ist inzwischen ebenfalls erledigt und
verifiziert (siehe §6a Punkt 1). Der aktuelle, maßgebliche Restestand steht in
**§6a**; dieser ältere Absatz bildet nur den Stand vor Phase 5/6 ab.**
