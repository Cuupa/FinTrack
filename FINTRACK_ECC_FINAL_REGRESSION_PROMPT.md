# FinTrack – ECC Prompt für die finale Regression-Runde

## Verwendung

Diesen Inhalt zusammen mit den drei Markdown-Dateien in Claude Code verwenden:

1. `FINTRACK_UX_UNIFICATION_SPEC.md`
2. `FINTRACK_POST_REDESIGN_UX_AUDIT.md`
3. `FINTRACK_FINAL_UX_REGRESSION_AUDIT.md`

Für diese Runde ist `/ecc:plan` sinnvoll, weil das Buchungsmodal, der Transfermechanismus, wiederkehrende Regeln, Farbsemantik und Kategorieverwaltung mehrere Komponenten und möglicherweise Datenlogik berühren. Der Plan soll aber eng bleiben und keine dritte Redesign-Runde eröffnen.

## Copy-Paste-Prompt

```text
/ecc:plan

Du arbeitest am bestehenden FinTrack-Repository. Das große UX-Redesign ist weitgehend abgeschlossen. Plane jetzt ausschließlich eine finale Regression-Runde anhand dieser Dokumente, in dieser Priorität:

1. FINTRACK_FINAL_UX_REGRESSION_AUDIT.md – verbindliche aktuelle Abnahme und Restarbeitsliste
2. FINTRACK_POST_REDESIGN_UX_AUDIT.md – Detailregeln und fachlicher Kontext
3. FINTRACK_UX_UNIFICATION_SPEC.md – Designsystem und ursprüngliches Zielbild

WICHTIGE EINORDNUNG

- Buchungen sind NICHT ausgenommen. Sie sind die zentrale offene P0-Regression.
- Der aktuelle Buchungsflow mit Ausgabe/Einnahme plus Feld „Umbuchung auf“ gilt ausdrücklich als nicht abgenommen.
- Ausgabe, Einnahme und Umbuchung müssen drei explizite Modi sein.
- Normale Ausgaben dürfen nicht als Fehlerrot erscheinen.
- Die überlange, löschdominierte Kategorieverwaltung muss in eine skalierbare Verwaltungsansicht überführt werden.
- Außerhalb der im finalen Audit als P0/P1/P2/VERIFY markierten Punkte gilt Bestandsschutz.
- Keine neue Informationsarchitektur, keine neuen Dashboard-Karten und keine kosmetische Komplettüberarbeitung bereits bestandener Seiten.
- Bestehende Businesslogik, Datenmigrationen und APIs nur ändern, wenn es für die spezifizierte UX fachlich notwendig ist.
- Keine produktiven Daten löschen und keine destruktiven Live-Tests durchführen.

DEINE AUFGABE IM PLAN-MODUS

1. Lies die drei Dokumente vollständig.
2. Inspiziere das Repository und ordne jeden offenen Punkt konkreten Routen, Komponenten, Hooks, Stores, API-Endpunkten und Tests zu.
3. Prüfe zuerst, wie Buchungen, Umbuchungen und wiederkehrende Regeln aktuell fachlich gespeichert werden. Erfinde keinen zweiten Transfermechanismus.
4. Identifiziere die gemeinsame Farb-, Button-, Field-, Modal-, Table- und Validation-Infrastruktur. Korrigiere gemeinsame Ursachen zentral, ohne legitime P/L- oder Warnfarben zu zerstören.
5. Erstelle einen umsetzbaren Phasenplan mit kleinen, überprüfbaren Schritten.
6. Nenne pro Schritt:
   - betroffene Dateien/Komponenten,
   - konkrete Änderung,
   - fachliches Risiko,
   - Tests,
   - Screenshot-/QA-Zustand,
   - Abnahmekriterium aus dem finalen Audit.
7. Markiere Punkte, die aus dem Screenshot nicht verifizierbar sind, als explizite QA-Aufgabe statt Annahmen zu treffen.
8. Weise auf Konflikte zwischen Dokument und aktuellem Code hin. Bei Konflikt hat der finale Regression-Audit Vorrang.

VERBINDLICHE IMPLEMENTIERUNGSPHASEN

Phase A – Buchungsdomäne und Modal
- Drei explizite Modi Ausgabe, Einnahme, Umbuchung.
- Modusspezifische Felder und CTAs.
- Kein „Keine Umbuchung“, kein Transferfeld in Ausgabe/Einnahme, keine gestrichelte Transferkarte.
- Positiver Betrag als Eingabe; Vorzeichen aus Modus.
- Lokalisierte CurrencyField-Eingabe.
- Klare Required-/Optional-Regeln und Inline-Validierung.
- Wiederkehrend als sichtbarer Modifier mit Rhythmus und Startdatum.
- Atomare Umbuchung über vorhandene fachliche Logik.

Phase B – Buchungslisten und Kategorien
- Normale Ausgaben neutral statt alarmrot.
- Datenqualität, Status und Richtung nicht ausschließlich über Farbe ausdrücken.
- Wiederkehrende Regeln zugänglich bearbeiten/pausieren/löschen.
- Kategorieverwaltung als skalierbare, such-/gruppierbare Ansicht mit sicheren Löschflüssen.

Phase C – enge P1-Restpunkte
- Positionsdetail: neutrales Strategie-Tag und neutrale BUY/SELL-Typen.
- Rebalancing: Kaufen/Verkaufen neutral; 83,6-%-Ursache und Normalisierung erklären.
- FIRE: gemeinsame Warnung statt dreifacher Wiederholung.
- Simulation: Detaildichte reduzieren, Grundlayout beibehalten.
- Settings: ausschließlich die im finalen Audit genannten Restpunkte.

Phase D – QA und Abnahme
- Desktop, 768 px, 390 px und 200-%-Zoom.
- Tastatur, Fokus, Escape, Rückfokus und Screenreader-Smoke-Test.
- Disabled, Loading, Error, Success und Confirmation.
- Component-/Unit-/E2E-Tests für Moduswechsel, Validierung, wiederkehrende Regeln und Umbuchung.
- Neue Screenshots der im Audit genannten Zustände.

PLAN-AUSGABE

Liefere am Ende:

1. eine kurze Codebase-Diagnose,
2. eine Tabelle „Audit-ID -> konkrete Datei/Komponente -> Änderung -> Test“,
3. einen phasenweisen Implementierungsplan,
4. Risiken und nötige fachliche Entscheidungen,
5. eine explizite Liste der Bereiche, die nicht angefasst werden,
6. die genaue Test- und Screenshot-Abnahme.

Beginne noch nicht mit der Implementierung. Erzeuge zuerst den Plan zur Prüfung.
```

## Prüfkriterien für den von ECC erzeugten Plan

Den Plan erst freigeben, wenn er:

- Buchungen als P0 führt und nicht als spätere Politur,
- alle drei Buchungsmodi getrennt aufführt,
- die bestehende Transfer-/Recurring-Datenlogik zuerst untersucht,
- Kategorieverwaltung als eigenen Arbeitspunkt enthält,
- normale Ausgaben von Fehlerrot trennt,
- Bestandsschutz für bestandene Seiten nennt,
- Dateien, Tests und Abnahmekriterien konkret zuordnet,
- responsive und Accessibility nicht nur pauschal erwähnt,
- keine unnötige Neuarchitektur oder komplette Komponenten-Neuschreibung vorschlägt.

## Prompt nach Freigabe des Plans

```text
Setze den freigegebenen Plan jetzt phasenweise um. Beginne mit Phase A und B. Arbeite die Audit-IDs nachvollziehbar ab, führe nach jeder Phase die zugeordneten Tests aus und dokumentiere Abweichungen. Verändere keine als PASS oder Bestandsschutz markierten Bereiche, außer eine zentrale Komponentenkorrektur ist zwingend nötig; in diesem Fall führe vorher die betroffenen Screens und Regressionstests auf. Liefere zum Abschluss die Matrix „Audit-Punkt -> Implementierung -> Test -> Screenshot -> Status“.
```

