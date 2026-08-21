# FinTrack Post-Redesign UX Audit

**Stand:** 21. August 2026  
**Status:** Stabilisierungspass nach dem ersten Redesign  
**Bezug:** `FINTRACK_UX_UNIFICATION_SPEC.md`

> Dieses Dokument ist ein Delta-Audit. Das neue Grunddesign bleibt bestehen. Es soll nicht erneut konzeptionell umgebaut werden. Ziel ist, die verbliebenen Inkonsistenzen, Verständlichkeitsprobleme und Darstellungsfehler gezielt zu beseitigen.

---

## 1. Auftrag an Claude Code

Arbeite die Punkte dieses Audits in der angegebenen Priorität ab.

### Unbedingt beibehalten

- die neue Navigation mit den Bereichen **Geld**, **Investments** und **Planen**
- die neue Tab-Struktur innerhalb der Fachbereiche
- die einheitlichen Seitenköpfe
- die neuen Summary-Strips
- das gemeinsame Karten- und Tabellenbild
- die neue Cashflow-Darstellung ohne Sankey-Diagramm
- die neue Rebalancing-Darstellung ohne zwei Donut-Charts
- den neuen zweispaltigen Simulationsaufbau
- die fachliche Logik und bestehende Berechnungen, sofern dieses Audit keinen konkreten Fehler benennt

### Nicht tun

- kein zweites vollständiges Redesign starten
- keine neue Navigation erfinden
- keine neuen Features ergänzen
- keine funktionierenden Berechnungen beiläufig refactoren
- keine neue Farbpalette pro Seite einführen
- nicht durch noch mehr Karten oder permanente Formulare künstlich Inhalt erzeugen
- keine bestehende Informationsarchitektur wieder auseinanderziehen

### Ziel dieser Runde

Ein konsistenter, gut lesbarer und semantisch eindeutiger Release Candidate für Desktop und Mobile.

---

## 2. Kurzurteil

Das Redesign ist ein klarer Erfolg. FinTrack wirkt erstmals wie **ein Produkt** und nicht wie zwei nachträglich verbundene Anwendungen.

| Bereich | Bewertung | Urteil |
|---|---:|---|
| Informationsarchitektur | 9/10 | Deutlich klarer und fachlich nachvollziehbar |
| Seitenstruktur | 8/10 | Header, Tabs, Kennzahlen und Inhalte folgen einem gemeinsamen Muster |
| Visuelle Konsistenz | 8/10 | Oberflächen wirken zusammengehörig |
| Datenvisualisierung | 7/10 | Stark verbessert, aber einzelne Skalen und Semantiken sind missverständlich |
| Lesbarkeit | 6/10 | Zu viel sehr kleine und kontrastarme Sekundärinformation |
| Interaktionsklarheit | 6,5/10 | Formulare und Aktionshierarchien sind noch nicht überall vereinheitlicht |
| Barrierefreiheit | ungeprüft | Aus Screenshots sind Kontrast-, Größen- und Farbcodierungsrisiken erkennbar |

**Gesamturteil:** ungefähr **7,5/10**. Das Produkt befindet sich nicht mehr in einer Redesign-Phase, sondern in einer gezielten Konsolidierungs- und QA-Phase.

---

## 3. Was nachweislich besser geworden ist

### Navigation und mentale Modelle

- **Konten & Buchungen** bündelt jetzt Konten, Buchungen und wiederkehrende Buchungen.
- **Cashflow** bündelt Übersicht, Budgets und Prognose.
- **Depot** bündelt Positionen, Sparpläne, Watchlist und Historie.
- **Ruhestand** bündelt FIRE und gesetzliche/private Rente.
- **Verbindlichkeiten** steht sinnvoll unter **Planen**.
- Seltene oder sehr spezialisierte Hauptnavigationseinträge wurden reduziert.

### Wiederkehrende Seitenstruktur

Die meisten Seiten verwenden jetzt dieselbe Abfolge:

1. Seitentitel und kurze Einordnung
2. kontextuelle Tabs oder Filter
3. kompakte Summary-Zeile
4. Hauptinhalt in klaren Oberflächen
5. Footer

Diese Grundstruktur soll als neue Norm behandelt werden.

### Fachliche Verbesserungen

- Die Übersicht vergleicht das Nettovermögen nicht mehr mit Aktienindizes.
- Cashflow ist in lesbare Einnahmen- und Ausgabenströme übersetzt.
- Rebalancing vergleicht Ist und Ziel direkt in Balken und Tabelle.
- Simulation zeigt Parameter, Ergebnisband und Ergebniskennzahlen gemeinsam.
- Sondertilgungen sind nicht mehr als dauerhaftes leeres Formular präsent.
- Der Ziele-Dialog ist klar und fokussiert.

---

## 4. Prioritäten

### P0 - vor dem UX-Sign-off

1. **Lesbarkeit und Kontrast auf allen Seiten korrigieren**
2. **Farbsemantik in Brand, Aktion, positiv, negativ, Warnung und Kategorie trennen**
3. **offensichtliche Diagramm- und Zahlenbeschriftungen berichtigen**
4. **Budget-Empty-State und dauerhaft offene Eingabeformulare korrigieren**
5. **Aktionshierarchie und Button-Stile vereinheitlichen**
6. **Desktop, Tablet, Mobile und 200-Prozent-Zoom sichtbar testen**
7. **Settings-Flows für Secrets, Kontolöschung, Sitzplätze und Steuergrenzen absichern**

### P1 - direkt danach

1. Planungsseiten auf dasselbe Interaktionsmuster bringen
2. Tabellenaktionen und Filter vereinheitlichen
3. Erklärungen für ungewöhnliche Datenverläufe und Kennzahlen ergänzen
4. Kategorisierungsprobleme im Cashflow handlungsorientiert darstellen
5. Formulare stärker per Modal, Drawer oder Disclosure öffnen
6. Settings-Breite, Speichern-Zustände und Informationsgruppierung vereinheitlichen

### P2 - Politur

1. Abstände und vertikale Dichte feinjustieren
2. Footer-Verhalten auf kurzen Seiten vereinheitlichen
3. Legenden, Tooltips und Mikrotexte redaktionell glätten
4. leere Flächen ohne künstlichen Inhalt sauber behandeln

---

## 5. P0: globale Korrekturen

## 5.1 Lesbarkeit und Kontrast

### Problem

Viele Beschriftungen sind visuell zu schwach:

- Tabellenköpfe
- Achsen und Diagrammlegenden
- Hilfetexte unter Formularfeldern
- Kennzahlenlabels
- Hinweise und Fußnoten
- kleine Segment- und Zeitraumsteuerungen
- Zeilenaktionen
- Footer-Links

Auf einem großen Screenshot sind diese Informationen bereits schwer zu lesen. Auf einem normalen Laptop oder bei gedimmtem Display wird das Problem größer.

### Änderung

- Fließtext und handlungsrelevanten Hilfetext nicht unter effektiv 12 CSS-Pixel setzen.
- Sekundärtext darf kleiner sein, muss aber ausreichend Kontrast besitzen.
- Tertiärtext nur für wirklich optionale Metadaten verwenden.
- Tabellenkopf, Achsen, Legenden und Formlabels mindestens eine Kontraststufe anheben.
- Klickbare Icon-Aktionen erhalten mindestens 36 x 36 Pixel Trefferfläche, mobil 44 x 44 Pixel.
- Informationshierarchie über Größe, Gewicht und Abstand erzeugen, nicht nur über immer schwächeres Grau.

### Abnahme

- [ ] Kerninformationen sind bei 100 Prozent Zoom ohne Anstrengung lesbar.
- [ ] Die Anwendung bleibt bei 200 Prozent Zoom vollständig bedienbar.
- [ ] Sekundärtext erfüllt WCAG-AA-Kontrast für normalen Text.
- [ ] Kein handlungsrelevanter Text ist nur aufgrund seiner geringen Helligkeit erkennbar.

---

## 5.2 Farbsemantik trennen

### Problem

Der aktuelle Türkis-/Grünton bedeutet gleichzeitig:

- Marke
- aktive Navigation
- primäre Aktion
- Gewinn
- Erfolg
- Fortschritt
- positive Chartreihe

Rot bedeutet gleichzeitig:

- Verlust
- Ausgabe
- Verkauf
- Löschung
- Warnung oder Fehler

Dadurch sieht die Oberfläche zwar einheitlich aus, ist semantisch aber nicht eindeutig.

### Verbindliche Token-Rollen

| Rolle | Verwendung | Nicht verwenden für |
|---|---|---|
| `brand` | aktive Navigation, Fokus, ausgewählter Tab, dekorativer Akzent | Gewinn oder Erfolg |
| `action-primary` | wichtigste Aktion eines Bereichs | Status oder Diagrammreihe |
| `positive` | Gewinn, Verbesserung, erfolgreich abgeschlossen | Kauf oder beliebige CTA |
| `negative` | Verlust, Verschlechterung, destruktive Konsequenz | normale Ausgabe oder Verkauf als Transaktionstyp |
| `warning` | Aufmerksamkeit, unvollständige Daten, Planabweichung | allgemeine Hervorhebung |
| `neutral` | normale Geldbewegung, Metadaten, Transaktionstyp | Fehlerzustand |
| `categorical-*` | voneinander unterscheidbare Diagrammreihen | Erfolgs- oder Fehleraussage |

### Konkrete Änderungen

- Primäre Aktionen erhalten einen eigenen neutralen, kontrastreichen Action-Token.
- Brand-Türkis bleibt bei Navigation, Tabs, Fokus und ausgewählten Zuständen.
- Positives Grün wird nur für echte positive Zustände oder Wertentwicklungen eingesetzt.
- Normale Ausgaben sind neutral mit Minuszeichen. Rot ist für problematische oder negative Zustände reserviert.
- **BUY** und **SELL** sind Transaktionstypen und werden neutral oder kategorial codiert.
- **Kaufen** und **Verkaufen** beim Rebalancing sind Richtungen, keine Erfolgs- oder Fehlerzustände.
- Alle farbcodierten Zustände benötigen zusätzlich Text, Symbol, Muster oder Position.

### Abnahme

- [ ] Eine Farbe besitzt produktweit dieselbe Bedeutung.
- [ ] Gewinn und Primäraktion sehen nicht identisch aus.
- [ ] Normale Ausgabe und Fehler sehen nicht identisch aus.
- [ ] BUY/SELL ist ohne Rot-Grün-Unterscheidung verständlich.
- [ ] Charts bleiben in Graustufen interpretierbar.

---

## 5.3 Einheitliche Aktionshierarchie

### Regel

Pro Oberfläche gibt es höchstens:

- eine primäre Aktion
- ein bis zwei direkt sichtbare sekundäre Aktionen
- seltene Aktionen unter **Mehr** oder einem Zeilenmenü

### Konkret

- **Buchungen:** `Buchung hinzufügen` bleibt primär. Import, automatische Kategorisierung und Kategorienverwaltung werden sekundär oder unter **Mehr** gruppiert.
- **Depot:** `Position hinzufügen` bleibt primär. Teilen ist sekundär.
- **Ziele:** Das dauerhaft offene Formular wird durch `Ziel hinzufügen` ersetzt.
- **Rente:** `Renteninformation hinzufügen`, `Jahr hinzufügen` und `Vertrag hinzufügen` öffnen fokussierte Eingaben.
- **Simulation:** `Simulation starten` verwendet denselben Primary-Button wie der Rest der Anwendung.
- **FIRE:** `Simulation öffnen` verwendet dieselbe Button-Hierarchie und keinen abweichenden weißen Stil.

---

## 5.4 Empty States und Progressive Disclosure

### Budget-Seite

Der aktuelle Zustand zeigt bei fehlenden Budgets direkt Kategorieauswahl, Zahlenfeld und Button. Das ist kein vollständiger Empty State.

Ersetzen durch:

- Titel: **Noch keine Budgets**
- kurze Erklärung des Nutzens
- optional ein kleines Beispiel
- genau eine CTA: **Erstes Budget anlegen**
- Formular erst nach Aktivierung als Modal oder Drawer öffnen

### Ziele

Wenn bereits Ziele vorhanden sind, soll das sechs Felder breite Formular nicht permanent sichtbar sein.

- oben Summary und `Ziel hinzufügen`
- darunter direkt die vorhandenen Ziele
- Eingabe in Modal oder Drawer
- Editieren verwendet dieselbe Formularkomponente wie Anlegen

### Rente

Die Formulare für Entgeltpunkte, einzelne Jahre und Verträge sind Aktionen, kein dauerhaft sichtbarer Primärinhalt.

- Listen und Ergebnisse zuerst
- Formulare bei Bedarf öffnen
- nach Speichern schließen und Ergebnis direkt sichtbar machen

---

## 5.5 Zahlen- und Diagrammfehler

### Verbindlichkeiten: Zeitraumsteuerung

Die Steuerung `1W`, `1M`, `3M`, `YTD`, `1Y`, `5Y`, `10Y`, `MAX` passt nicht zu einem Tilgungsplan über etwa 24 Jahre. Im Screenshot ist `1Y` ausgewählt, während das Diagramm weiterhin 2025 bis 2049 zeigt.

**Entscheidung:**

- entweder echte Ausschnittslogik implementieren
- oder die Börsen-Zeitraumsteuerung entfernen
- bevorzugte Tilgungsoptionen: `Gesamt`, `5 Jahre`, `10 Jahre`

### Simulation: Y-Achse

Mehrere Achsenwerte erscheinen durch zu grobe Millionenformatierung praktisch identisch.

- unter einer Million in Tausendern darstellen
- ab einer Million mindestens eine Dezimalstelle verwenden
- keine wiederholten, ununterscheidbaren `0M`-Labels

### Simulation: Ergebnisbegriffe

Im Ergebnis erscheinen ungefähr:

- eingezahlt: 88.070 Euro
- projiziertes Wachstum: 280.765,64 Euro
- Median-Ergebnis: 368.835,64 Euro

Die Werte können rechnerisch korrekt sein, aber die Begriffe müssen den Zusammenhang eindeutig erklären:

- **Eingezahltes Kapital**
- **Wertzuwachs im Median**
- **Projiziertes Endvermögen im Median**

### Rebalancing

- `-0,0 %` als `0,0 %` darstellen
- bei `Gesamt: 83,3 %` erklären, warum die Zielsumme nicht 100 Prozent beträgt
- Asset-Namen nicht unnötig abschneiden, wenn Platz vorhanden ist
- klare Prozentachse oder gemeinsame Baseline für Ist und Ziel ergänzen

### Übersicht

Die gemeinsame Skala von ungefähr -500.000 bis +500.000 Euro macht liquide Mittel und Depot im Verhältnis zu Verbindlichkeiten kaum sichtbar.

Bevorzugte Lösung:

- absolute Gesamtansicht beibehalten
- zusätzlich verständliche Detailwerte oder Annotationen für Vermögen und Verbindlichkeiten anbieten
- nicht mit einer künstlichen Doppelachse verfälschen

### Werteformatierung

- negative Null überall normalisieren: `-0,00 €` zu `0,00 €`
- dieselben Regeln für Tausendertrennzeichen, Dezimalstellen, Prozentwerte und Vorzeichen verwenden
- bei `Veränderung (1Y)` klar benennen, worauf sich der Prozentwert bezieht

---

## 5.6 Settings als gemeinsames System

### Problem

Die Settings verwenden zwar die neuen Karten, Tabs und Felder, wirken auf Desktop aber wie eine eigene schmale Anwendung. Zusätzlich fehlen einheitliche Zustände für Speichern, Sicherheit, Kosten und Secrets.

### Verbindliche Änderung

- Settings-Container auf ungefähr 720 bis 800 px erweitern. Formulare bleiben scanbar und werden nicht über die gesamte Dashboardbreite gestreckt.
- Einheitliche Tabs `Allgemein`, `Haushalt`, `Steuern & Gebühren`, `KI-Assistent` verwenden.
- Page-Description auf alle Inhalte beziehen, nicht nur auf Profil, Sprache und Sicherheit.
- Pro Settings-Fläche genau ein Speichern-Modell festlegen: explizites Speichern oder Autosave.
- `Speichern` ohne Änderungen und bei ungültigem Formular deaktivieren.
- Dirty-, Lade-, Erfolgs- und Fehlerzustände direkt am jeweiligen Abschnitt zeigen.
- Tab-, Broker- und Providerwechsel dürfen ungespeicherte Änderungen nicht still verwerfen.
- Sicherheitskritische, kostenpflichtige und destruktive Aktionen zeigen die konkrete Konsequenz vor Bestätigung.
- Benachrichtigungsdesign wird separat überarbeitet. Dieses Audit verlangt ergänzend nur korrekte Berechtigungs-, Geräte- und Fehlerzustände.

### Abnahme

- [ ] Settings wirken visuell wie Teil desselben App-Shells.
- [ ] Jede Änderung hat einen eindeutigen Speicherzustand.
- [ ] Kostenpflichtige Aktionen können nicht versehentlich ausgelöst werden.
- [ ] Secrets sind nach dem Speichern nicht im Klartext abrufbar.
- [ ] Destruktive Konto- und Haushaltsaktionen erklären ihre Auswirkungen.

---

## 6. Seitenbezogener Audit

## 6.1 Übersicht

### Beibehalten

- Nettovermögen, Veränderung, Liquidität, Investments und Verbindlichkeiten als erste Ebene
- Vermögen/Verbindlichkeiten statt Indexvergleich
- Planfortschritt und wichtige Hinweise

### Korrigieren

- kleine Vermögenswerte gehen in der Gesamtskala optisch unter
- Erklärung der Jahresveränderung schärfen
- Karte **Dieser Monat** kompakter strukturieren, damit die große Leerfläche keine unfertige Wirkung erzeugt
- Hinweise stärker lesbar machen
- Gesundheitskennzahlen im unteren Strip kontrastreicher darstellen

---

## 6.2 Konten & Buchungen

### Konten

- aktuelle Gruppierung in Zahlungsverkehr, Rücklagen und Kredite beibehalten
- ungewöhnliche Sprünge im Verlauf als Import, Eröffnungsbestand oder Datenänderung annotieren
- Zeilenaktionen vergrößern oder in ein zugängliches Kontextmenü legen

### Buchungen

- normale Ausgaben nicht automatisch als Fehlerrot behandeln
- Aktionsleiste entschlacken
- Kategorieproblem und fehlende Kategorie deutlicher als bearbeitbare Datenqualität zeigen
- Pagination und Zeilenaktionen mobil testen

### Wiederkehrend

- Gruppierung und nächste Ausführung beibehalten
- Pausieren, Bearbeiten und Löschen mit klaren Tooltips und ausreichenden Trefferflächen versehen
- automatisch erzeugte Zinsbuchungen erkennbar von frei angelegten Regeln unterscheiden

---

## 6.3 Cashflow

### Übersicht

Die neue Balkendarstellung ist gegenüber dem alten Sankey klarer.

Korrigieren:

- `Ohne Kategorie` dominiert die Ausgaben. Direkt eine Aktion **Buchungen kategorisieren** anbieten.
- Kategorienfarben kategorial behandeln und nicht mit Erfolg/Fehler verwechseln.
- Summe, Teilwerte und Zeitraumsteuerung deutlicher verbinden.

### Budgets

- vollständigen Empty State umsetzen
- Monatsteuerung an derselben Stelle wie in Übersicht und Prognose halten
- Formular erst nach CTA öffnen

### Prognose

- Darstellung beibehalten
- Legende, Achsen und Erklärung geplanter gegenüber gebuchten Werten vergrößern
- sicherstellen, dass positive und negative Balken nicht ausschließlich über Farbe erklärt werden

---

## 6.4 Depot

### Beibehalten

- Tabs für Positionen, Sparpläne, Watchlist und Historie
- Summary, Chart und Positionstabelle
- Portfoliofilter im Seitenkopf

### Korrigieren

- Filterchips dürfen mobil nicht ungeordnet umbrechen oder aus dem Viewport laufen
- Tabellenaktionen benötigen größere Trefferflächen
- Gewinnfarben von Brand- und CTA-Farben trennen
- Suchfeld und Kategorienfilter responsiv priorisieren

---

## 6.5 Positionsdetail

### Korrigieren

- rotes Tag `Strategie-Typ: Core` neutral darstellen, da kein Fehler vorliegt
- Risikoindikatoren größer und auch ohne Farbe verständlich machen
- BUY und SELL neutral oder kategorial darstellen
- lange Transaktionsliste und Eingabeformular mobil testen
- Eingabeformular bei Bedarf einklappbar machen, wenn Transaktionshistorie der häufigere Anwendungsfall ist

---

## 6.6 Rebalancing

Die neue Ist-gegen-Ziel-Darstellung ist eine deutliche Verbesserung.

### Korrigieren

- gemeinsame Skala und Baseline klarer darstellen
- lange Asset-Namen lesbar halten
- Kaufen und Verkaufen nicht als Erfolg und Fehler codieren
- Nullwerte korrekt formatieren
- unvollständige Zielsumme mit Ursache und Handlung erklären
- Normalisierung als bewusste, nachvollziehbare Aktion behandeln

---

## 6.7 Ziele

### Beibehalten

- Summary mit Anzahl, Zielsumme, Erspartem und Gesamtfortschritt
- Fortschritt direkt in der Tabelle
- fokussierten Bearbeitungsdialog

### Korrigieren

- permanentes Anlegeformular entfernen
- Hierarchie von Gesamtziel und Teilziel klar einrücken oder gruppieren
- erklären, ob Teilziele in Anzahl und Gesamtbetrag mitgezählt werden
- Doppelzählung von Eltern- und Teilziel im Fortschritt ausschließen oder transparent kennzeichnen
- Status zusätzlich zur Farbe textlich und gegebenenfalls per Icon ausgeben

---

## 6.8 Verbindlichkeiten

Diese Seite ist strukturell bereits sehr stimmig.

### Korrigieren

- unpassende Zeitraumsteuerung ersetzen
- Zinsen als Kosten darstellen, aber nicht wie einen Systemfehler
- Sondertilgung per Modal oder Drawer ergänzen, vorhandene reduzierte Oberfläche beibehalten
- Tabellenwerte und Legenden kontrastreicher machen

---

## 6.9 Ruhestand: FIRE

Diese Ansicht ist aktuell die am wenigsten konsolidierte Planungsseite.

### Probleme

- eine lange grüne Erklärung trägt zu viele Informationen
- dieselbe Warnung wird in allen drei Zielkarten wiederholt
- die Button-Gestaltung weicht vom restlichen Produkt ab
- negative Ausgangslage wird gezeigt, aber nicht ausreichend eingeordnet

### Änderung

- ein gemeinsamer Hinweis oberhalb der drei FIRE-Karten
- Ursache, Auswirkung und nächster möglicher Stellhebel in drei kurzen Teilen
- Karten zeigen nur Zielwert, Annahme und Status
- Warnung nicht dreimal wiederholen
- `Simulation öffnen` im globalen Button-System darstellen
- gleiche Abstände, Textgrößen und Formkontrollen wie auf den anderen Planungsseiten verwenden

---

## 6.10 Ruhestand: Rente

### Beibehalten

- obere Zusammenfassung
- Trennung von Entgeltpunkten und privaten Verträgen

### Korrigieren

- permanente Eingabeformulare reduzieren
- Listen und bestehende Daten vor die Eingabe stellen
- Hilfetexte lesbarer und kürzer formulieren
- Anlegen und Bearbeiten in wiederverwendbaren Modal-/Drawer-Formularen lösen
- Tabellenaktionen mit denselben Komponenten wie bei Konten, Zielen und Depot umsetzen

---

## 6.11 Simulation

Die neue Ansicht ist fachlich und visuell stark verbessert.

### Beibehalten

- Parameter links, Ergebnis rechts
- Perzentilband, Median und Einzahlpfad
- Ergebniskennzahlen unter dem Chart
- sichtbare Modellwarnung

### Korrigieren

- Achsenformatierung berichtigen
- `Wertzuwachs` und `Endvermögen` klar unterscheiden
- Perzentillegende und Achsen lesbarer machen
- ähnliche Violetttöne zusätzlich über Beschriftung und Linienart unterscheiden
- sehr dichte Modellhinweise im schmalen Panel besser gruppieren
- Detailaufstellung der Anlagen scrollbar oder einklappbar gestalten, ohne die Hauptparameter zu verdrängen
- Button mit dem globalen Primary-Action-Stil abgleichen

---

## 6.12 Einstellungen

### Gesamtstruktur

#### Beibehalten

- Settings als eigener Bereich hinter dem Profilzugang
- Tabs statt einzelner verstreuter Verwaltungsseiten
- Karten und Formfelder aus dem gemeinsamen Designsystem
- getrennte destruktive Aktionen

#### Korrigieren

- Content-Spalte ist mit ungefähr 450 px für den Desktop-App-Shell zu schmal. Auf 720 bis 800 px erweitern.
- Beschreibung `Dein Profil, deine Sprache und Sicherheit` deckt Haushalt, Steuern, Gebühren und KI nicht ab.
- Tab `Gebühren und Steuern` zu `Steuern & Gebühren` kürzen.
- Formularlabels, Hilfetexte und Tabs kontrastreicher und besser lesbar machen.
- Karten nicht nur stapeln, sondern fachlich in Konto, Benachrichtigungen, Sicherheit, Haushalt, Finanzeinstellungen und Integrationen gruppieren.
- Kurze Seiten dürfen kurz bleiben. Keine leeren Platzhalter hinzufügen.

### Allgemein

#### Beibehalten

- Abo, Profil, Sprache, Benachrichtigungen, Passwort und Gefahrenzone
- Gefahrenzone am Ende
- explizite Kontolöschungsbestätigung

#### Korrigieren

- Profil und Sprache können in eine gemeinsame Fläche `Profil & Sprache`.
- `Geführte Tour` ist eine sekundäre Hilfeaktion und benötigt keine gleichgewichtete Hauptkarte.
- Passwortänderung braucht erneute Authentifizierung oder das aktuelle Passwort, sofern der Auth-Provider dies nicht bereits sicher erzwingt.
- Passwortregeln und Nichtübereinstimmung inline anzeigen.
- Englischen Bestätigungstext `delete` lokalisieren, beispielsweise als exaktes `KONTO LÖSCHEN`.
- Vor dem finalen Löschen Folgen zusammenfassen und einen ConfirmDialog zeigen.
- Sprache speichert aktuell scheinbar ohne sichtbaren Abschluss. Autosave mit Rückmeldung oder explizites Speichern festlegen.
- Benachrichtigungen müssen getrennt zeigen: gewünschte Ereignisse und tatsächliche Geräteberechtigung.
- Statuswerte vorsehen: `Aktiv`, `Nicht aktiviert`, `Im Browser blockiert`, `Nicht unterstützt`.
- Das bereits parallel behobene visuelle Benachrichtigungsproblem nicht in einem konkurrierenden lokalen Workaround lösen.

### Haushalt

#### Beibehalten

- Haushaltsname, Mitgliederliste und Einladung
- destruktive Aktionen als rote Kontur
- Tarifhinweis unter der Einladung

#### Korrigieren

- Rollenbezeichnung `Inhaberin` neutral und produktweit konsistent formulieren.
- Eigentümer:innen dürfen den Haushalt erst nach Eigentumsübertragung oder geordnetem Auflösen verlassen.
- `Haushalt verlassen` und `Entfernen` benötigen eine Bestätigung mit konkreter Folge für Datenzugriff.
- Laut Screenshot sind zwei Personen enthalten und zwei vorhanden. Gleichzeitig bleiben Eingabe und `Einladen` aktiv. Diesen widersprüchlichen Zustand beheben.
- Bei erreichtem Limit entweder Einladung deaktivieren und Sitzplatzkauf verlangen oder vor Einladung Preis und Abrechnungsintervall bestätigen lassen.
- `1,99 €` immer als wiederkehrenden oder einmaligen Preis ausweisen, beispielsweise `1,99 € pro Monat`.
- offene Einladungen beim Sitzplatzlimit nachvollziehbar berücksichtigen.

### Steuern & Gebühren

#### Beibehalten

- Trennung von globalen Steuerannahmen und brokerbezogenen Gebühren
- Auswahl von Broker und Inhaber:in
- Order-, Sparplan- und Schwellengebühren
- brokerbezogenen Freistellungsauftrag

#### Korrigieren

- native Number-Input-Spinner entfernen und gemeinsames Zahlen-/Währungsfeld einsetzen.
- `Sparer-Pauschbetrag` und Veranlagungsstatus eindeutig verbinden.
- bei Freistellungsaufträgen `bereits verteilt`, `noch verfügbar` oder `überschritten` anzeigen.
- Summe aller brokerbezogenen Freistellungsaufträge gegen den globalen Betrag validieren.
- `Kostenlos ab` fachlich genauer erklären: Welche konkrete Gebühr entfällt ab dem Wert?
- ungespeicherte Brokeränderungen bei Brokerwechsel schützen.
- globale Checkbox `Teilfreistellung` fachlich prüfen. Teilfreistellung ist typischerweise wertpapier- beziehungsweise fondsartabhängig und darf nicht blind auf alle Fonds angewendet werden.
- Berechnungslogik erst nach dokumentierter fachlicher Entscheidung ändern.

### KI-Assistent

#### Beibehalten

- Provider- und Modellauswahl
- eigener API-Schlüssel
- Auswahl des Speicherorts
- Verbindungstest
- klarer Hinweis, dass keine Anlageberatung erfolgt

#### Korrigieren

- Provider und Modell abhängig validieren. Providerwechsel darf kein ungültiges Modell behalten.
- gespeicherten API-Schlüssel niemals vollständig wieder anzeigen. Nur Maskierung, letzte vier Zeichen und `Schlüssel ersetzen`.
- `Anzeigen` nur für den aktuell eingegebenen, noch nicht gespeicherten Schlüssel zulassen.
- lange Speicheroptionen nicht als winziges Segmented Control darstellen. Radio Rows oder Radio Cards mit Titel und Konsequenz verwenden.
- Browser-Speicherung nicht pauschal als sicherer darstellen. Sie ist gerätegebunden, bleibt aber gegenüber kompromittiertem Browsercode exponiert.
- Kontospeicherung setzt serverseitige Verschlüsselung, Log-Redaction und einen geschützten Backendpfad voraus.
- Verbindungstest sendet keine Portfolio- oder Haushaltsdaten, sondern nur die minimal erforderliche Testanfrage.
- Teststatus und Fehler inline anzeigen.
- `Schlüssel entfernen` bestätigen und ausdrücklich von Kontolöschung unterscheiden.
- erklären, welche Daten bei einer späteren Chat-Anfrage an den Anbieter gesendet werden können.

---

## 7. Einheitliche Komponentenregeln

Claude soll vorhandene Komponenten zuerst konsolidieren und nicht seitenweise neue Varianten bauen.

| Komponente | Verbindliche Regel |
|---|---|
| `PageHeader` | Titel, Beschreibung, optionale Kontextauswahl, optionale Aktionen |
| `SectionTabs` | gleiche Höhe, aktiver Brand-Indikator, horizontal scrollbar auf Mobile |
| `SummaryStrip` | gleiche Abstände, gleiche Label-/Werttypografie, responsive 1/2/4-Spalten |
| `Card` | ein Radius, ein Border-Token, definierte Padding-Stufen |
| `PrimaryButton` | genau eine dominante Aktion pro Bereich |
| `SecondaryButton` | neutrale Kontur, keine Statusfarbe |
| `DestructiveButton` | rot nur bei tatsächlicher destruktiver Aktion |
| `EmptyState` | Titel, Erklärung, eine CTA, kein permanentes Rohformular |
| `DataTable` | einheitliche Kopfzeile, Zeilenhöhe, Zahlenalignment und Aktionsmenü |
| `FormField` | Label, Control, optionaler Helper, Fehler direkt am Feld |
| `Modal/Drawer` | dieselbe Form für Create und Edit, klare Abbrechen-/Speichern-Hierarchie |
| `ChartToolbar` | Zeitraum, Darstellung und Teilen an konsistenter Position |
| `Status` | Text plus Symbol oder Form, nie ausschließlich Farbe |
| `SettingsSection` | Titel, Erklärung, zusammengehörige Controls und eindeutiger Save-State |
| `SaveState` | unverändert, ungespeichert, speichernd, gespeichert oder fehlerhaft |
| `SecretField` | Klartext nur vor Speicherung, danach Maskierung und Ersetzen-Flow |
| `RadioCard` | längere exklusive Optionen mit Titel und Konsequenz statt engem Segment |

---

## 8. Responsive und Accessibility QA

Für jede Kernseite mindestens folgende Viewports prüfen:

- 1440 x 900
- 1280 x 800
- 1024 x 768
- 768 x 1024
- 390 x 844

Zusätzlich:

- Browser-Zoom bei 200 Prozent
- Tastaturbedienung ohne Maus
- sichtbarer Fokuszustand
- reduzierte Bewegung
- Hell- und Dunkelmodus, falls beide unterstützt werden
- lange deutsche Texte
- große und negative Geldbeträge
- leere, teilweise befüllte und sehr lange Tabellen
- Diagramme mit Ausreißern und Nullwerten

### Responsive Regeln

- Sidebar wird mobil zu Drawer oder kompakter Navigation.
- Tabs bleiben scrollbar und schneiden Text nicht ab.
- Summary-Strips wechseln kontrolliert von vier auf zwei auf eine Spalte.
- Tabellen bekommen priorisierte Spalten, Detailansicht oder horizontalen Scrollbereich.
- Aktionsleisten umbrechen nicht zufällig.
- Chart-Legenden dürfen den Plot nicht verdecken.
- schwebender Chat-Button darf keine primären Aktionen oder Pagination überdecken.
- Settings verwenden auf Desktop eine mittlere Breite, auf Mobile eine Spalte und keine abgeschnittenen Tab- oder Radio-Labels.

---

## 9. Abnahmekriterien für diese Runde

Die Runde gilt erst als abgeschlossen, wenn:

- [ ] keine Hauptseite eine eigene Button- oder Formularlogik erfindet
- [ ] keine normale Ausgabe automatisch als Fehler codiert ist
- [ ] Marke, Aktion, positiver Status und Kategorie farblich getrennt sind
- [ ] alle wichtigen Texte und Diagrammbeschriftungen gut lesbar sind
- [ ] Budget, Ziele und Rente Progressive Disclosure verwenden
- [ ] Verbindlichkeiten keine wirkungslose Zeitraumsteuerung zeigt
- [ ] Simulationsachse und Ergebnisbegriffe eindeutig sind
- [ ] Nullbeträge korrekt formatiert sind
- [ ] Eltern- und Teilziele nicht missverständlich doppelt gezählt werden
- [ ] Settings besitzen eindeutige Dirty-, Lade-, Erfolgs- und Fehlerzustände
- [ ] Sitzplatzlimit, Einladung und kostenpflichtiger Zusatzplatz widersprechen sich nicht
- [ ] Kontolöschung und sicherheitskritische Haushaltsaktionen sind lokalisiert und bestätigt
- [ ] brokerbezogene Freistellungsaufträge werden gegen den globalen Betrag validiert
- [ ] fachliche Behandlung der Teilfreistellung ist geprüft und dokumentiert
- [ ] gespeicherte API-Schlüssel sind weder vollständig abrufbar noch in Logs sichtbar
- [ ] Verbindungstest des KI-Assistenten überträgt keine Finanzdaten
- [ ] alle Kernseiten bei den fünf definierten Viewports geprüft wurden
- [ ] Fokus, Tastaturbedienung und 200-Prozent-Zoom funktionieren
- [ ] Screenshots der finalen Kernseiten visuell gegeneinander geprüft wurden
- [ ] keine bestehenden Berechnungen ohne fachlichen Grund verändert wurden

---

## 10. Empfohlene Umsetzungsreihenfolge

### Phase A: Foundations

1. semantische Farbtokens
2. Text- und Kontrasttokens
3. Button-Hierarchie
4. Tabellenaktionen und Trefferflächen
5. Zahlenformatierung

### Phase B: offensichtliche Fehler

1. Verbindlichkeiten-Zeitraum
2. Simulation-Achse und Begriffe
3. Rebalancing-Nullwerte und Zielsumme
4. Ziele-Zählung und Hierarchie
5. Overview-Veränderungsdefinition
6. Settings-Sicherheits-, Sitzplatz- und Secret-Flows

### Phase C: Progressive Disclosure

1. Budgets
2. Ziele
3. Rente
4. optional Positionsdetail
5. Einstellungen: allgemeine Informationsgruppierung

### Phase D: Seitenpolitur

1. FIRE
2. Cashflow
3. Konten/Buchungen
4. Depot/Positionsdetail
5. Übersicht
6. Einstellungen: Breite, Save-States und Microcopy

### Phase E: Responsive und Accessibility QA

1. definierte Viewports
2. 200-Prozent-Zoom
3. Tastatur und Fokus
4. Kontrast
5. visuelle Regression

Nach jeder Phase separat prüfen und committen. Keine Misch-Commits mit fachlich unbeteiligten Refactorings.

---

## 11. Prompt für `/ecc:plan`

```text
Erstelle einen konkreten Implementierungsplan für den Post-Redesign-Stabilisierungspass von FinTrack.

Lies zuerst vollständig:
1. FINTRACK_UX_UNIFICATION_SPEC.md
2. FINTRACK_POST_REDESIGN_UX_AUDIT.md

Wichtig:
- Das neue Redesign und seine Informationsarchitektur bleiben bestehen.
- Dies ist kein neues Redesign, sondern eine gezielte Korrektur- und QA-Runde.
- Behandle FINTRACK_POST_REDESIGN_UX_AUDIT.md als priorisierte Delta-Anforderung.
- Arbeite P0 vor P1 und P2 ab.
- Untersuche zuerst die existierenden Tokens und wiederverwendbaren Komponenten.
- Plane komponentenweite Änderungen vor seitenweisen Sonderlösungen.
- Verändere keine fachlichen Berechnungen, sofern kein konkret dokumentierter Fehler vorliegt.
- Plane kleine, überprüfbare Phasen und nenne je Phase betroffene Dateien, Risiken, Tests und visuelle Abnahme.
- Berücksichtige Desktop, Tablet, Mobile, 200-Prozent-Zoom, Tastaturbedienung und Kontrast.
- Beziehe Allgemein, Haushalt, Steuern & Gebühren und KI-Assistent ausdrücklich in den Plan ein.
- Behandle Kontolöschung, Sitzplatzkosten, Steuergrenzen und API-Schlüssel als sicherheits- beziehungsweise fachkritische Flows.
- Füge keine neuen Features hinzu.

Liefere am Ende:
1. eine priorisierte Datei-/Komponentenliste,
2. die geplanten Implementierungsschritte,
3. automatisierte und manuelle Tests,
4. eine Screenshot-Matrix für die visuelle Regression,
5. offene fachliche Fragen, die vor einer Änderung geklärt werden müssen.
```

---

## 12. Erwartete Abschlussdokumentation von Claude

Nach der Umsetzung soll Claude knapp dokumentieren:

- geänderte globale Tokens und Komponenten
- erledigte Punkte aus P0, P1 und P2
- bewusst nicht umgesetzte Punkte mit Begründung
- getestete Viewports
- Accessibility-Prüfungen
- verbleibende fachliche Unklarheiten
- geprüfte Settings-Flows einschließlich Haushalt, Steuergrenzen und API-Schlüssel
- Vorher-/Nachher-Screenshots der Kernseiten

Erst nach diesem Stabilisierungspass sollte aus dem finalen Code ein neuer, schlanker FinTrack-Design-Skill erzeugt werden. Der aktuelle Skill soll nicht parallel als zweite Wahrheit weitergepflegt werden.
