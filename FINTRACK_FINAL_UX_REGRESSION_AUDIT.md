# FinTrack Final UX Regression Audit

**Stand:** 21. August 2026  
**Basis:** 41 Screenshots nach dem Redesign, `FINTRACK_UX_UNIFICATION_SPEC.md` und `FINTRACK_POST_REDESIGN_UX_AUDIT.md`  
**Zweck:** Abschlussprüfung des Redesigns und eng begrenzte Restarbeitsliste für Claude Code

## 1. Urteil

Das Redesign ist als System deutlich gelungen. Navigation, Seitenkopf, Tabs, Summary-Strips, Karten, Tabellen und Diagrammflächen wirken inzwischen wie ein gemeinsames Produkt. Die Anwendung ist nicht mehr „Portfolio-App plus angehängtes Haushaltsbuch“.

Der Stand ist trotzdem **noch nicht UX-sign-off-fähig**, weil der Bereich **Buchungen** nachweislich auf dem alten Interaktionsmodell und der alten Farbsemantik geblieben ist. Das ist keine optionale Politur, sondern eine **offene P0-Regression** gegen die bereits beschlossene Spezifikation.

Außerhalb der Buchungen soll Claude keine neue Designrunde beginnen. Dort bleiben nur wenige, eng umrissene Rückfälle und Verifikationspunkte.

## 2. Statuslegende

| Status | Bedeutung |
|---|---|
| PASS | Im Screenshot fachlich und visuell ausreichend umgesetzt; nicht neu gestalten |
| P0 REGRESSION | Verletzt eine bereits beschlossene Kernregel; vor UX-Sign-off beheben |
| P1 OPEN | Relevanter Restpunkt; direkt nach P0 beheben |
| P2 POLISH | Kleine Konsistenz- oder Microcopy-Korrektur |
| VERIFY | Aus einem statischen Screenshot nicht sicher prüfbar; gezielt testen |

## 3. Gesamtmatrix

| Bereich | Status | Kurzbegründung |
|---|---|---|
| App-Shell und Navigation | PASS | Klare Gruppen `Geld`, `Investments`, `Planen`; konsistente aktive Zustände |
| Seitenkopf, Tabs, Filter | PASS | Wiederkehrendes Muster und deutlich bessere Orientierung |
| Übersicht | PASS mit globalem Farb-Follow-up | Gute Verdichtung aus Vermögen, Monat, Planfortschritt und Hinweisen |
| Konten | PASS | Summary, Kontengruppen, Verlauf und Aktionen sind kohärent |
| Buchungsliste | P0 REGRESSION | Normale Ausgaben erscheinen als Fehlerrot; alte Aktions- und Datenqualitätslogik |
| Buchungsmodal | P0 REGRESSION | Umbuchung ist weiter ein Zusatzfeld von Ausgabe/Einnahme statt eigener Modus |
| Wiederkehrende Buchungen | P0 REGRESSION | Alte Farbsemantik und schwer zugängliche Icon-Aktionen |
| Kategorieverwaltung | P0 REGRESSION | Extrem langer, löschdominierter Modal-Dialog ohne skalierbare Informationsarchitektur |
| Cashflow | PASS | Übersicht, Budgets und Prognose sind als Tabs konsolidiert; Diagramme sind lesbar |
| Depot | PASS | Positionen, Sparpläne, Watchlist und Historie sind sinnvoll getrennt |
| Positionsdetail | P1 OPEN | Neutrales Strategie-Tag wirkt wie Warnung; BUY/SELL weiterhin Erfolgs-/Fehlerfarbe |
| Analyse | PASS | Verteilungen, X-Ray, Renditen, Trades, Risiken und Steuern wirken zusammengehörig |
| Dividenden | PASS | Summary, Verlauf und Tabellenhierarchie sind stimmig |
| Rebalancing | P1 OPEN | Kaufen/Verkaufen noch grün/rot codiert; Zielsumme 83,6 % braucht klarere Ursache |
| Ziele | PASS | Permanentes Formular ist entfernt; fokussierter Dialog und klare Fortschrittstabelle |
| Verbindlichkeiten | PASS | Passende Zeiträume `Gesamt`, `5 Jahre`, `10 Jahre`; gute Seitenstruktur |
| Ruhestand – FIRE | P1 OPEN | Dieselbe Warnung wird weiterhin dreimal wiederholt |
| Ruhestand – Rente | PASS | Kennzahlen, Annahmen und Datenerfassung sind nachvollziehbar gegliedert |
| Simulation | PASS mit P1-Dichteproblem | Fachlich stark; schmales Parameterpanel bleibt sehr dicht |
| Einstellungen | PASS mit P1/P2-Resten | Breite, Tabs und Grundstruktur sind korrigiert; einzelne alte Detailpunkte bleiben |

## 4. P0 – Buchungen vollständig ins neue UX-System überführen

### 4.1 Evidenz

- `21.10.35`: Buchungsliste mit normalen Ausgaben in Alarmrot
- `21.10.48` und `21.11.33`: Modal `Buchung hinzufügen` mit den Modi `Ausgabe` und `Einnahme`, aber zusätzlichem Feld `Umbuchung auf`
- `21.11.36`: Nach Auswahl eines Zielkontos erscheint eine gestrichelte zweite Umbuchungsfläche; Kategorie und Umbuchung existieren weiterhin parallel
- `21.11.29`: Wiederkehrende Buchungen mit derselben roten Alltags-Ausgabenlogik und sehr kleinen Icon-Aktionen
- `21.11.43`: Kategorieverwaltung als sehr hoher Modal-Dialog mit wiederholten roten `Löschen`-Buttons

### 4.2 Warum der aktuelle Modal-Flow falsch ist

Der Benutzer muss eine normale Ausgabe implizit als `Keine Umbuchung` modellieren. Das macht Umbuchung zu einer Eigenschaft einer Ausgabe oder Einnahme, obwohl sie fachlich ein eigener Vorgang ist. Nach der Zielauswahl entsteht zusätzlich eine gestrichelte Fläche, die wie ein Drop-Ziel oder eine zweite Eingabe aussieht. Gleichzeitig bleiben Kategorie und Umbuchungsziel sichtbar, obwohl eine Umbuchung nicht als Konsumausgabe oder Einnahme in den Cashflow eingehen soll.

### 4.3 Verbindliches Interaktionsmodell

`Ausgabe`, `Einnahme` und `Umbuchung` sind drei gleichwertige, explizite Modi.

| Modus | Sichtbare Pflicht-/Kernfelder | Nicht anzeigen |
|---|---|---|
| Ausgabe | Konto, Betrag, Datum und Uhrzeit, Empfänger, Kategorie, Notiz | Umbuchungsziel |
| Einnahme | Konto, Betrag, Datum und Uhrzeit, Zahler, Kategorie, Notiz | Umbuchungsziel |
| Umbuchung | Von Konto, Auf Konto, Betrag, Datum und Uhrzeit, Notiz | Empfänger/Zahler, Kategorie |

Verbindliche Regeln:

- Kein Feld `Umbuchung auf` in Ausgabe oder Einnahme.
- Kein Auswahlwert `Keine Umbuchung`.
- Keine gestrichelte Umbuchungskarte.
- Quell- und Zielkonto dürfen nicht identisch sein.
- Betrag wird positiv eingegeben; das Vorzeichen folgt aus dem Modus.
- `Ohne Kategorie` ist eine bewusste Auswahl, kein stiller Default. Ausgangszustand ist `Kategorie auswählen`.
- Falls die Gegenpartei Pflicht ist, wird sie sichtbar als Pflichtfeld markiert. Falls sie optional ist, darf sie die CTA nicht blockieren.
- Label lautet `Datum und Uhrzeit`, wenn beides gespeichert wird.
- CTA ist kontextabhängig: `Ausgabe hinzufügen`, `Einnahme hinzufügen`, `Umbuchung erstellen`.
- Footer enthält `Abbrechen` und die primäre Aktion.
- Inline-Validierung erklärt konkret, welche Angabe fehlt; ein nur grau gesetzter Button reicht nicht.
- Beim Moduswechsel werden verborgene Werte verworfen und nicht mitgesendet.
- Umbuchung bleibt atomar bzw. verwendet den vorhandenen fachlichen Transfermechanismus.

### 4.4 Wiederkehrend ist ein Modifier, kein vierter Buchungstyp

Nach Aktivierung von `Wiederkehrend` werden sichtbar:

- Rhythmus bzw. Intervall
- Startdatum
- optional Enddatum oder Anzahl
- Vorschau der nächsten Ausführung

Die CTA passt sich an, beispielsweise `Wiederkehrende Ausgabe anlegen`. Es darf keine unsichtbare Default-Regel entstehen.

### 4.5 Farblogik in Liste und Wiederkehrend

Normale Ausgaben sind keine Fehler. Daher:

- Betrag standardmäßig in normaler Textfarbe darstellen; das Minuszeichen reicht zur Richtung.
- Einnahme/Ausgabe zusätzlich über verständliche Bezeichnung oder Icon unterscheiden, nicht nur über Farbe.
- Rot nur für Fehler, überfällige/fehlgeschlagene Zustände, destruktive Aktionen oder echte negative Performance verwenden.
- Grün nur für Erfolg/positive Performance verwenden, nicht pauschal für jeden Eingang.
- Fehlende Kategorie als bearbeitbare Datenqualität markieren, nicht als Systemfehler.
- Die gleiche Regel auf Buchungsliste, wiederkehrende Buchungen, Übersicht und verwandte Summaries anwenden.

### 4.6 Kategorieverwaltung neu strukturieren

Der aktuelle, überlange Löschdialog skaliert nicht. Ziel ist keine kosmetische Verkleinerung, sondern eine wartbare Verwaltungsansicht.

Verbindlich:

- Als breiter Drawer, eigene Settings-Unterseite oder ausreichend großes Dialoglayout umsetzen.
- Kategorien gruppiert und ein-/ausklappbar oder über Suche/filterbare Liste darstellen.
- `Neue Gruppe` und `Neue Kategorie` als normale primäre/sekundäre Aktionen platzieren.
- Bearbeiten und Löschen über Zeilenaktionen oder Kontextmenü; nicht jede Zeile mit rotem Button dominieren.
- Löschen immer bestätigen und Auswirkung nennen.
- Bei verwendeten Kategorien entweder Löschen verhindern oder vorher eine Ersatzkategorie verlangen.
- Bei Gruppenlöschung Anzahl betroffener Kategorien und Buchungen anzeigen.
- Dialoginhalt besitzt eigene Scrollfläche; Header und Abschlussaktion bleiben erreichbar.
- Fokusfalle, Escape, Tastaturbedienung und Rückfokus auf Auslöser testen.

### 4.7 Abnahmekriterien Buchungen

- Drei explizite Buchungsmodi sind sichtbar und per Tastatur bedienbar.
- Ausgabe/Einnahme enthalten keinerlei Transferfeld.
- Transfer enthält keinerlei Kategorie- oder Gegenparteifeld.
- Kein gestricheltes Pseudo-Drop-Ziel mehr.
- Normale Ausgaben sind nicht alarmrot.
- Lokalisierte Betragseingabe akzeptiert `1595`, `1595,00` und formatiert zu `1.595,00 €`.
- CTA, Validierung, Loading, Serverfehler und Erfolg sind verständlich.
- Wiederkehrende Regel zeigt ihre tatsächlichen Parameter vor dem Speichern.
- Kategorieverwaltung bleibt bei vielen Gruppen nutzbar und passt in den Viewport.
- 390 px, 768 px, Desktop, 200-%-Zoom, Tastatur und Screenreader-Smoke-Test bestehen.

## 5. P1 – offene Rückfälle außerhalb der Buchungen

### 5.1 Positionsdetail

Evidenz: `21.12.12` und `21.12.16`.

- `Strategie-Typ: Core` ist neutrale Metadateninformation und darf nicht als gelb/oranges Warn-Tag erscheinen.
- `BUY`, `SELL` und `BOOKING` sind neutrale/kategoriale Typen. Grün/Rot gehört in dieser Tabelle an realisierte Wirkung bzw. Gewinn/Verlust, nicht an die Handlungsrichtung.
- Das Eingabeformular `Transaktion hinzufügen` einklappbar machen, wenn die Historie der primäre Lesefall ist.
- Portfolio-Auswahl, Löschaktion und Tags auf Tastatur-/Fokuszustände prüfen.

### 5.2 Rebalancing

Evidenz: `21.14.09`.

- `Kaufen` und `Verkaufen` nicht als Erfolg/Fehler grün/rot codieren; neutraler Text plus Richtungspfeil oder neutrales Badge.
- `Gesamt: 83,6 %` muss direkt erklären, warum die Summe unvollständig ist und welche Aktion das löst.
- `Auf 100 % normieren` als nachvollziehbare Aktion mit Vorschau/Bestätigung behandeln.
- Ist/Ziel-Legende und gemeinsame Baseline kontrast- und zoomfest testen.

### 5.3 Ruhestand – FIRE

Evidenz: `21.14.48`.

- Die identische Warnung `... 30 Rentenjahre ... leer aus` nicht in allen drei Karten wiederholen.
- Einen gemeinsamen Hinweis oberhalb der Karten zeigen: Ursache, Auswirkung, möglicher Stellhebel.
- Zielkarten enthalten nur Zielwert, Annahme und Status.
- Die lange grüne Erklärung oberhalb in zwei kurze Aussagen aufteilen und positive Farbe nur für echte positive Aussage verwenden.

### 5.4 Simulation

Evidenz: `21.15.01`.

- Grundlayout beibehalten; kein Redesign.
- Modellwarnung und Anlagen-Detailaufstellung einklappbar bzw. intern scrollbar machen.
- Hauptparameter dürfen im schmalen Panel nicht von Detailtext verdrängt werden.
- Bei logarithmischer Skala Zustand und Achsenformat explizit und lesbar halten.
- Violette Perzentilflächen zusätzlich über Beschriftung/Linienart unterscheidbar machen.

### 5.5 Einstellungen

Evidenz: `21.15.08`, `21.15.12`, `21.15.16`, `21.15.21`.

Beibehalten:

- korrigierte Content-Breite
- gemeinsame Tabs und Karten
- maskierter API-Schlüssel mit letzten vier Zeichen und `Schlüssel ersetzen`
- getrennte Gefahrenzone

Offen:

- Tab `Gebühren und Steuern` zu `Steuern & Gebühren` vereinheitlichen.
- Kontolöschbestätigung `delete` lokalisieren, z. B. exakt `KONTO LÖSCHEN`.
- Benachrichtigungen zusätzlich mit tatsächlichem Gerätestatus ausgeben: `Aktiv`, `Nicht aktiviert`, `Im Browser blockiert`, `Nicht unterstützt`. Das separat laufende visuelle Notification-Fix nicht überschreiben; nur integrieren/verifizieren.
- Haushaltsrolle produktweit neutral/konsistent formulieren.
- Preis `1,99 €` mit Abrechnungsintervall ausweisen, z. B. `1,99 € pro Monat`.
- Native Number-Input-Spinner beim Sparer-Pauschbetrag entfernen und gemeinsames Zahlenfeld verwenden.
- Speicherort des KI-Schlüssels nicht als winziges Segmented Control, sondern als zwei verständliche Radio Rows mit Konsequenz darstellen.
- Teststatus, Speichern, Ersetzen und Entfernen des Schlüssels auf eindeutige Lade-/Erfolgs-/Fehlerzustände prüfen.

## 6. P2 – Politur

- Tabellen-Icons benötigen Tooltips, ausreichend große Trefferflächen und sichtbare Fokusrahmen.
- Sekundärtexte, Achsen, Hilfetexte und Spaltenköpfe auf WCAG-Kontrast prüfen; mehrere Screens wirken weiterhin sehr niedrig kontrastiert.
- Lange Namen nicht nur per Ellipsis abschneiden; vollständigen Namen via Tooltip oder zugänglichen Detailtext anbieten.
- `Inhaber:in`, `Inhaberin`, `du` und Haushaltsrollen terminologisch vereinheitlichen.
- Zahlenformatierung produktweit mit geschütztem Abstand vor `€`, deutschem Tausenderpunkt und einheitlichen Dezimalstellen prüfen.

## 7. Bestandsschutz – nicht erneut umbauen

Claude soll folgende erreichte Lösungen beibehalten:

- neue Navigationsgruppen und reduzierte Anzahl von Hauptpunkten
- gemeinsame Seitenköpfe, Tab-Leisten, Summary-Strips und Kartenradien
- Übersicht mit Vermögensverlauf, Monatsstatus, Planfortschritt und wichtigen Hinweisen
- Kontengruppierung und separate Tabs für Konten, Buchungen und Wiederkehrend
- Cashflow-Tabs `Übersicht`, `Budgets`, `Prognose`
- Depot-Tabs `Positionen`, `Sparpläne`, `Watchlist`, `Historie`
- Analyse-Tabs und die jetzt konsistente Chart-/Tabellenstruktur
- Ist-gegen-Ziel-Darstellung beim Rebalancing
- Ziele ohne permanentes Anlegeformular
- Verbindlichkeiten mit `Gesamt`, `5 Jahre`, `10 Jahre`
- FIRE/Rente als Tabs einer gemeinsamen Ruhestandsseite
- Simulation mit Parametern links und Ergebnissen rechts
- Settings als gemeinsamer Bereich mit Tabs und korrigierter Breite
- kurze Seiten dürfen kurz bleiben; keine Füllkarten erzeugen

## 8. Verifikationsmatrix

Diese Punkte sind aus Screenshots nicht abschließend prüfbar und gehören in die QA:

- responsive Verhalten bei 390 px und 768 px
- 200-%-Zoom ohne horizontales Abschneiden
- Fokusreihenfolge, Escape, Rückfokus und Fokusfalle in allen Modals/Drawern
- sichtbare Hover-, Focus-, Disabled-, Loading-, Error- und Success-Zustände
- Confirmation-Dialogs für Löschen, Haushalt verlassen, Mitglied entfernen und Schlüssel entfernen
- Autosave/Speichern-Rückmeldung bei Sprache und Benachrichtigungen
- fachlich atomare Umbuchung ohne doppelte oder halbfertige Buchung
- Ausschluss von Umbuchungen aus Einnahmen-/Ausgabenstatistik
- Berechtigungen und Status bei Browserbenachrichtigungen
- keine API-Schlüssel in Logs, Responses oder Analytics
- Farbverständlichkeit ohne Farbe und mit Farbsehschwäche

## 9. Empfohlene Reihenfolge

1. Buchungsmodell im UI in drei Modi aufteilen.
2. Validierung, CurrencyField, wiederkehrende Parameter und atomaren Transferpfad absichern.
3. Buchungslisten- und Summary-Farblogik korrigieren.
4. Kategorieverwaltung ersetzen.
5. Positionsdetail und Rebalancing farbsemantisch korrigieren.
6. FIRE-Warnung und Simulationsdichte bereinigen.
7. Settings-Restpunkte schließen.
8. Responsive, Accessibility und Interaktionszustände testen.
9. Neue Screenshots derselben Zustände erzeugen und gegen diese Abnahme prüfen.

## 10. Definition of Done

Der Redesign-Pass ist erst abgeschlossen, wenn:

- kein P0-Punkt offen ist,
- Buchungen den drei expliziten Modi folgen,
- normale Finanzbewegungen nicht als Systemfehler codiert sind,
- kein bereits bestandener Bereich unnötig neu gestaltet wurde,
- P1-Punkte umgesetzt oder mit begründeter technischer Blockade dokumentiert sind,
- alle VERIFY-Punkte mit Ergebnis protokolliert wurden,
- relevante Unit-/Component-/E2E-Tests bestehen,
- Claude eine kurze Abschlussmatrix `Punkt -> Datei/Komponente -> Test -> Status` liefert.

