# Planung: Betriebliche Altersvorsorge in FinTrack

Stand: 2026-08-02  
Status: fachliche und technische Planung, keine Implementierung

## 1. Ziel

FinTrack soll betriebliche Altersvorsorge (bAV) sauber planen und prognostizieren können, obwohl die Anwendung bewusst kein Brutto-/Netto-Gehaltsmodell besitzt.

Die neue Funktion soll folgende Fälle abdecken:

- Arbeitnehmer wandelt einen Teil des Bruttogehalts in einen bAV-Beitrag um.
- Arbeitgeber fördert die bAV zusätzlich.
- Die Arbeitgeberförderung kann als Prozentsatz oder als fester Betrag erfasst werden.
- Die bAV erhöht die spätere Altersvorsorgeprojektion.
- Die bAV darf die Kontoseite nicht verfälschen, weil dort nur echte Netto-Zahlungsströme und echte Kontobewegungen stehen.
- Die bAV soll in der Renten-/FIRE-Planung sichtbar werden, ohne ein vollständiges Payroll-, Steuer- oder Sozialversicherungsmodell einzuführen.

Der zentrale Produktkonflikt ist:

> Die bAV ist wirtschaftlich ein Beitrag in einen Altersvorsorgevertrag, aber bei Entgeltumwandlung fließt der Arbeitnehmeranteil nie als Nettozahlung über ein FinTrack-Konto. Wenn FinTrack ihn wie eine normale Ausgabe bucht, wird der Kontostand falsch. Wenn FinTrack ihn ignoriert, fehlt er in der Altersvorsorgeprojektion.

Diese Planung löst den Konflikt über eine fachliche Trennung zwischen:

- echtem Konten-/Buchungsledger,
- Altersvorsorge-Vertragslogik,
- optionaler Netto-Auswirkungsnotiz für Budget/FIRE.

## 2. Bestehender Kontext in FinTrack

FinTrack hat bereits mehrere Bausteine, die für bAV wiederverwendet werden sollten.

### 2.1 Rentenverträge existieren bereits

Es gibt bereits `PensionContract`.

Dieser Vertragstyp ist bewusst nicht identisch mit einem normalen Vertrag (`Contract`), weil ein normaler Vertrag primär sagt:

- was kostet mich regelmäßig Geld,
- wann wird es vom Konto gebucht,
- welche Kündigungs-/Vertragsdaten gibt es.

Ein Rentenvertrag sagt dagegen:

- welche spätere monatliche Rente oder welcher Rentenfaktor entsteht,
- welches Kapital aktuell vorhanden ist,
- welche Beiträge bis Rentenbeginn weiterlaufen,
- welche Rendite aus Vertragsständen und Beiträgen gemessen oder angenommen wird.

Das ist für bAV korrekt. Eine bAV ist fachlich ein Altersvorsorgevertrag, nicht nur eine Ausgabe.

### 2.2 `occupational` ist als Vertragsart bereits vorgesehen

`PensionContractKind` enthält bereits `occupational`.

Das ist der richtige Anker für bAV. Die bAV sollte daher nicht als komplett neue Hauptentität neben Rentenverträgen modelliert werden. Stattdessen sollte `occupational` fachlich erweitert werden.

### 2.3 Beiträge können heute von einem Konto gebucht werden

Ein bestehender Rentenvertrag kann bereits ein `accountId`, ein `bookingStartDate` und ein `lastBookedDate` haben.

Wenn ein Beitrag fällig ist, kann FinTrack eine `SpendingTransaction` erzeugen:

- Betrag negativ,
- Konto wird belastet,
- `pensionContractId` wird gesetzt,
- die Buchung zählt als Transfer in Altersvorsorge, nicht als Konsumausgabe.

Das ist für private Rentenversicherungen oder selbst bezahlte Riester-/Rürup-/Police-Beiträge korrekt.

Für bAV-Entgeltumwandlung ist es aber falsch, weil kein Geld vom Bankkonto abgeht.

### 2.4 Konten & Buchungen sind Netto-Realität

Die Kontenseite hält echte eingehende und ausgehende Nettozahlungen fest.

Ein Gehalt erscheint dort als Nettozahlung, z. B.:

- 2.800 EUR Eingang auf Girokonto.

Die Anwendung kennt nicht:

- Bruttogehalt,
- Lohnsteuer,
- Sozialversicherung,
- geldwerte Vorteile,
- Bruttoabzüge,
- Arbeitgeberanteile.

Das ist eine klare Produktentscheidung und sollte nicht nebenbei durch bAV aufgeweicht werden.

## 3. Fachliches Problem

Eine bAV per Entgeltumwandlung besteht wirtschaftlich aus mindestens zwei Beitragsquellen:

1. Arbeitnehmeranteil aus Bruttoentgelt
2. Arbeitgeberförderung

Beispiel:

- Arbeitnehmer wandelt 200 EUR brutto pro Monat um.
- Arbeitgeber gibt 15 % dazu.
- Gesamtbeitrag in den bAV-Vertrag: 230 EUR pro Monat.
- Auf dem Girokonto erscheint nur das reduzierte Netto-Gehalt.

FinTrack sieht auf Kontoseite aber nur:

- Netto-Gehalt nach Entgeltumwandlung.

FinTrack sieht ohne zusätzliche bAV-Erfassung nicht:

- 200 EUR Brutto-Umwandlung,
- 30 EUR Arbeitgeberzuschuss,
- 230 EUR Gesamtbeitrag in den Vertrag,
- geringere spätere gesetzliche Rentenpunkte durch niedrigeres sozialversicherungspflichtiges Einkommen,
- Steuer-/SV-Effekt auf das Netto.

Wenn FinTrack jetzt einfach eine Ausgabe von 230 EUR vom Girokonto bucht, entstehen mehrere Fehler:

- Das Girokonto wird um 230 EUR zu niedrig.
- Die Sparquote wird falsch.
- Ausgaben werden falsch, falls die Buchung nicht sauber als Transfer markiert wird.
- Der Nutzer sieht einen Geldabfluss, der auf dem Kontoauszug nie existiert.
- Importierte Bankdaten und FinTrack-Bestand laufen auseinander.

Wenn FinTrack gar nichts bucht, entstehen andere Fehler:

- Die Altersvorsorgeprojektion unterschätzt bAV-Kapital und spätere Rente.
- FIRE unterschätzt spätere Rentenbrücke.
- Der Nutzer kann Arbeitgeberförderung nicht sichtbar machen.
- Vertragsstände können nicht sinnvoll gegen Beiträge ausgewertet werden.

Die Lösung muss also Beiträge für die Rentenprojektion erfassen, aber nicht automatisch als Bankbuchungen materialisieren.

## 4. Leitentscheidung

Die empfohlene Lösung ist:

> bAV-Beiträge aus Bruttoentgelt und Arbeitgeberförderung werden als Vertragsbeiträge im Rentenvertrag geführt, aber nicht als `SpendingTransaction` auf einem FinTrack-Konto gebucht.

Das bedeutet:

- Die bAV beeinflusst die Altersvorsorgeprojektion.
- Die bAV beeinflusst Vertragsrendite, wenn Vertragsstände vorhanden sind.
- Die bAV erscheint in Renten-/FIRE-Auswertungen.
- Die bAV erscheint nicht als echte Kontobuchung.
- Die bAV verändert keinen Kontostand.
- Die bAV zählt nicht als Konsumausgabe.
- Die bAV kann optional in einer separaten Kennzahl als "Brutto-Vorsorgebeitrag" oder "nicht kontowirksamer Vorsorgebeitrag" gezeigt werden.

Diese Lösung ist eine bewusste "Krücke", aber sie ist die sauberste Krücke, weil sie die wichtigste Invariante von FinTrack schützt:

> Konten zeigen nur echte Kontobewegungen.

## 5. Abgrenzung: Was nicht gebaut werden sollte

### 5.1 Kein vollständiges Brutto-Netto-Modell

FinTrack sollte für diese bAV-Erweiterung kein vollständiges Gehaltsmodell einführen.

Nicht modellieren:

- Bruttogehalt,
- Steuerklasse,
- Kirchensteuer,
- Kinderfreibeträge,
- Krankenversicherung,
- Zusatzbeitrag,
- Pflegeversicherung,
- Rentenversicherung,
- Arbeitslosenversicherung,
- Beitragsbemessungsgrenzen,
- monatliche Lohnabrechnung,
- Arbeitgeber-Gesamtkosten.

Warum:

- Das wäre ein eigener Payroll-Rechner.
- Es wäre fehleranfällig und wartungsintensiv.
- Gesetzeswerte ändern sich regelmäßig.
- Der Nutzen für FinTrack ist zu schmal.
- Die App müsste plötzlich rechtlich/steuerlich exakte Aussagen nahelegen.

FinTrack sollte stattdessen erfassen:

- Was wird laut bAV-Vertrag monatlich eingezahlt?
- Welcher Anteil kommt vom Arbeitnehmer?
- Welcher Anteil kommt vom Arbeitgeber?
- Wie stark reduziert sich optional das Netto-Gehalt, falls der Nutzer das als Budget-/FIRE-Annahme erfassen will?

### 5.2 Keine Phantom-Buchung auf dem Girokonto als Standard

Eine scheinbare Buchung wie:

- -230 EUR "bAV Beitrag" vom Girokonto

ist falsch, wenn die bAV per Gehaltsumwandlung läuft.

Sie erzeugt einen Kontostand, der nicht mit dem Bankkonto übereinstimmt.

Das widerspricht der Funktion "Konten & Buchungen".

### 5.3 Kein künstliches Bruttogehalt als Eingangsbuchung

Eine alternative Krücke wäre:

- Brutto- oder Pseudo-Netto-Gehalt als Eingang buchen,
- bAV-Beitrag als Ausgang buchen,
- tatsächliches Netto als Rest übrig lassen.

Beispiel:

- +3.000 EUR "Gehalt vor bAV"
- -200 EUR "bAV Arbeitnehmeranteil"
- tatsächlicher Kontozufluss 2.800 EUR

Das ist ebenfalls problematisch:

- Der Kontoauszug zeigt nur 2.800 EUR.
- FinTrack würde Einkommensauswertungen verfälschen.
- Der Nutzer müsste jeden Monat eine künstliche Gegenbuchung pflegen.
- Import/Reconciliation wird schlechter.
- Netto-Realität und Planungsrealität werden vermischt.

Diese Variante sollte höchstens als expliziter Expertenmodus denkbar sein, aber nicht als Standard.

### 5.4 Keine automatische Netto-Schätzung als Wahrheit

Die Nettoauswirkung einer Brutto-Entgeltumwandlung ist nicht identisch mit dem Bruttobeitrag.

Ein Bruttobeitrag von 200 EUR kann das Netto z. B. nur um 100-130 EUR reduzieren, abhängig von individueller Steuer-/SV-Situation.

FinTrack sollte diese Nettoauswirkung nicht automatisch als exakten Wert behaupten.

Falls eine Nettoauswirkung benötigt wird, gibt es zwei sinnvolle Wege:

1. Nutzer trägt die tatsächliche Netto-Minderung aus der Gehaltsabrechnung manuell ein.
2. FinTrack bietet später eine grobe Schätzung an, klar als Schätzung markiert.

Für die erste Version sollte nur der manuelle Wert geplant werden.

## 6. Empfohlenes Produktmodell

### 6.1 Eine bAV bleibt ein Rentenvertrag

Die bAV wird als `PensionContract` mit `kind = "occupational"` geführt.

Zusätzlich bekommt dieser Vertrag eine Beitragsquelle.

Die Beitragsquelle beantwortet:

> Woher kommt der laufende Beitrag?

Mögliche Werte:

- `bank_account`: Beitrag wird vom Konto abgebucht. Bestehendes Verhalten.
- `payroll_gross`: Beitrag läuft über Entgeltumwandlung vor Nettozufluss. Neue bAV-Logik.
- `external_only`: Nur Arbeitgeber oder Dritter zahlt, kein Arbeitnehmeranteil. Optionaler Sonderfall.
- `manual`: Keine automatische Beitragslogik; Nutzer pflegt Werte/Vertragsstände manuell. Fallback für alte Daten oder unklare Verträge.

Für die bAV ist primär `payroll_gross` relevant.

### 6.2 Beitragskomponenten statt nur `monthlyContribution`

Heute gibt es `monthlyContribution`.

Für bAV reicht ein einzelner Beitrag nicht aus, weil der Nutzer wissen will:

- eigener umgewandelter Bruttobetrag,
- Arbeitgeberförderung,
- Gesamtbeitrag.

Geplant werden sollte daher eine Aufteilung in Beitragskomponenten.

Für bAV:

- Arbeitnehmer-Brutto-Umwandlung pro Monat
- Arbeitgeberförderung
- Gesamtbeitrag pro Monat
- optionale Netto-Minderung pro Monat

Der Gesamtbeitrag ist entscheidend für:

- Kapitalprojektion,
- Rentenfaktor,
- spätere monatliche Rente,
- Renditemessung aus Vertragsständen.

Die Netto-Minderung ist entscheidend für:

- Budgetgefühl,
- verfügbare Liquidität,
- FIRE-Sparquote,
- Erklärung, warum das Netto-Gehalt niedriger ist.

Sie darf aber nicht auf ein Konto gebucht werden.

### 6.3 Arbeitgeberförderung

Die Arbeitgeberförderung sollte flexibel modelliert werden.

Varianten:

1. Kein Arbeitgeberzuschuss
2. Fester Betrag pro Monat
3. Prozentsatz auf Arbeitnehmer-Brutto-Umwandlung
4. Prozentsatz auf Gesamtbeitrag oder andere Basis, falls nötig später

Für Version 1 reichen:

- `employerContributionType = "none" | "fixed" | "percent_of_employee"`
- `employerContributionValue`

Beispiele:

- `fixed`, Wert 40 EUR -> Arbeitgeber zahlt 40 EUR monatlich.
- `percent_of_employee`, Wert 15 -> Arbeitgeber zahlt 15 % des Arbeitnehmerbeitrags.

Optional später:

- Mindestbetrag,
- Höchstbetrag,
- Staffelung,
- zeitlich befristeter Zuschuss,
- abweichende Zuschüsse in Probezeit/Teilzeit,
- Arbeitgeber zahlt nur bis zu einer Grenze.

Diese Erweiterungen sollten nicht in Version 1 enthalten sein, aber das Modell sollte sie nicht verbauen.

### 6.4 Gesamtbeitrag

Der monatliche Gesamtbeitrag ergibt sich bei `payroll_gross` aus:

```text
Gesamtbeitrag = Arbeitnehmer-Brutto-Umwandlung + Arbeitgeberförderung
```

Bei einem festen Arbeitgeberbetrag:

```text
Gesamtbeitrag = Arbeitnehmer-Brutto-Umwandlung + Arbeitgeber-Fixbetrag
```

Bei prozentualer Förderung:

```text
Arbeitgeberförderung = Arbeitnehmer-Brutto-Umwandlung * Förderprozentsatz / 100
Gesamtbeitrag = Arbeitnehmer-Brutto-Umwandlung + Arbeitgeberförderung
```

Beispiel:

```text
Arbeitnehmer-Brutto-Umwandlung: 200 EUR
Arbeitgeberförderung: 15 %
Arbeitgeberbetrag: 30 EUR
Gesamtbeitrag: 230 EUR
```

Dieser Gesamtbeitrag ersetzt für die bAV die bisherige einfache Logik "monatlicher Beitrag".

### 6.5 Netto-Minderung

Da FinTrack kein Brutto-/Netto-Modell kennt, sollte die Netto-Minderung optional und manuell sein.

Feld:

- `monthlyNetReduction`

Bedeutung:

> Um wie viel ist das monatliche Netto-Gehalt durch diese bAV ungefähr oder laut Gehaltsabrechnung niedriger?

Beispiel:

- Brutto-Umwandlung: 200 EUR
- Arbeitgeberzuschuss: 30 EUR
- Gesamtbeitrag: 230 EUR
- Netto-Minderung: 115 EUR

Die Netto-Minderung wird nicht gebucht.

Sie kann aber angezeigt werden:

- "Dein bAV-Vertrag erhält 230 EUR monatlich."
- "Dein Konto sieht davon nur die reduzierte Nettozahlung."
- "Erfasste Netto-Minderung: 115 EUR monatlich."

Optional kann sie später in FIRE/Spending-Kontexten verwendet werden, aber nur als Planungsannahme.

### 6.6 Beitragsdynamik

`PensionContract` kennt bereits `contributionDynamicPct`.

Diese Dynamik sollte bei bAV auf den Arbeitnehmeranteil angewendet werden.

Dann ergeben sich Folgewerte:

```text
Arbeitnehmeranteil Jahr n = Startbeitrag * (1 + Dynamik)^n
Arbeitgeberbetrag = abhängig von Typ:
  fixed: fixer Betrag, optional ebenfalls dynamisch später
  percent_of_employee: Prozentsatz auf dynamischen Arbeitnehmeranteil
Gesamtbeitrag = Arbeitnehmeranteil + Arbeitgeberbetrag
```

Für Version 1 sollte gelten:

- Bei prozentualer Arbeitgeberförderung wächst der Arbeitgeberbetrag automatisch mit dem Arbeitnehmeranteil.
- Bei festem Arbeitgeberbetrag bleibt der Betrag konstant.
- Eine separate Arbeitgeber-Dynamik ist nicht nötig.

### 6.7 Bestehendes `monthlyContribution`

Es gibt zwei mögliche Migrationsstrategien.

#### Option A: `monthlyContribution` bleibt Gesamtbeitrag

Bei dieser Option bleibt `monthlyContribution` der Gesamtbeitrag, den der Vertrag monatlich erhält.

Für bAV werden zusätzliche Felder eingeführt:

- Arbeitnehmeranteil,
- Arbeitgeberlogik,
- Netto-Minderung.

`monthlyContribution` kann weiterhin als abgeleiteter oder gespeicherter Gesamtbeitrag verwendet werden.

Vorteil:

- Weniger Bruch mit bestehender Projektion.
- Bestehende Tests und UI bleiben näher an der heutigen Logik.

Nachteil:

- Gefahr doppelter Wahrheit, wenn Gesamtbeitrag und Komponenten auseinanderlaufen.

#### Option B: Komponenten werden Wahrheit, Gesamtbeitrag wird abgeleitet

Bei dieser Option wird der Gesamtbeitrag nicht mehr als eigene Wahrheit für bAV gespeichert, sondern aus Komponenten berechnet.

Für alte/private Verträge bleibt `monthlyContribution` weiterhin der direkte Beitrag.

Für `contributionSource = payroll_gross` gilt:

```text
effectiveMonthlyContribution(contract) = employeeGrossContribution + calculatedEmployerContribution
```

Vorteil:

- Keine widersprüchlichen Daten.
- Fachlich sauber.

Nachteil:

- Mehr Anpassungen in Projektion, UI, Tests und Store.

Empfehlung:

> Option B. Die bestehende `monthlyContribution` bleibt für klassische Verträge erhalten. Für bAV wird der effektive Beitrag aus Komponenten abgeleitet.

## 7. Datenmodellplanung

Die folgenden Felder sind fachlich nötig. Namen sind Vorschläge, keine Implementierungsvorgabe.

### 7.1 Erweiterung `PensionContract`

Neue Felder:

```text
contributionSource:
  "bank_account" | "payroll_gross" | "external_only" | "manual"

employeeGrossContribution:
  number | null

employerContributionType:
  "none" | "fixed" | "percent_of_employee"

employerContributionValue:
  number | null

monthlyNetReduction:
  number | null

payrollNote:
  string | null
```

Semantik:

- `contributionSource`
  - entscheidet, ob Beiträge Konto-Buchungen erzeugen dürfen.
- `employeeGrossContribution`
  - monatliche Brutto-Entgeltumwandlung des Arbeitnehmers.
- `employerContributionType`
  - legt Berechnungsmodus der Förderung fest.
- `employerContributionValue`
  - Betrag oder Prozentsatz, je nach Typ.
- `monthlyNetReduction`
  - manuelle Netto-Auswirkung, nicht kontowirksam.
- `payrollNote`
  - Freitext für Hinweise aus Gehaltsabrechnung, z. B. "seit 04/2026 laut Abrechnung 113,42 EUR netto weniger".

### 7.2 Defaultwerte

Für bestehende Verträge:

- Wenn `accountId` gesetzt ist:
  - `contributionSource = "bank_account"`
- Wenn `accountId` nicht gesetzt ist und `monthlyContribution` gesetzt ist:
  - `contributionSource = "manual"`
- Wenn `kind = "occupational"` und neue Felder fehlen:
  - nicht automatisch `payroll_gross` setzen, weil bestehende occupational-Verträge unterschiedlich gemeint sein können.

Warum nicht automatisch `payroll_gross`?

- Es könnte bereits eine arbeitgeberfinanzierte Direktzusage sein.
- Es könnte eine private Fortführung nach Arbeitgeberwechsel sein.
- Es könnte ein manuell erfasster Altvertrag ohne Beitragsbuchung sein.
- Migration darf bestehende Verträge nicht fachlich uminterpretieren.

### 7.3 Supabase-Migration

Eine spätere Migration müsste die Spalten zu `pension_contracts` hinzufügen.

Plan:

- Spalten nullable hinzufügen.
- Keine aggressive Backfill-Logik.
- Optional sanfte Backfills:
  - `contribution_source = 'bank_account'`, wenn `account_id is not null`.
  - sonst `contribution_source = 'manual'`.
  - `employer_contribution_type = 'none'`.
- Store muss tolerant bleiben, solange Migration live noch nicht ausgeführt ist.

Da FinTrack bereits mehrfach tolerante Store-Reads für noch nicht live angewandte Migrationen nutzt, sollte die bAV-Migration dieselbe Strategie verwenden.

### 7.4 LocalStorage/Guest Mode

Guest Mode muss dieselben Felder speichern können.

Keine Sonderlogik:

- Neue Felder sind optional.
- Fehlende Werte werden als Defaults interpretiert.
- Export/Import muss sie vollständig erhalten.

### 7.5 Export/Import

Der FinTrack-Export muss die neuen Felder enthalten.

Wichtig:

- bAV-Felder enthalten teilweise Gehalts-/Arbeitgeberinformationen.
- Datenschutztext sollte prüfen, ob der Exporthinweis breit genug ist.
- Import alter Exporte muss funktionieren.
- Import neuer Exporte in ältere App-Versionen ist nicht garantiert und muss nicht speziell gelöst werden.

## 8. Berechnungslogik

### 8.1 Effektiver monatlicher Beitrag

Es sollte eine zentrale Funktion geben, die den effektiven Beitrag eines Rentenvertrags berechnet.

Fachliche Signatur:

```text
effectiveMonthlyContribution(contract, date?) -> ContributionBreakdown
```

Ergebnis:

```text
employeeContribution
employerContribution
totalContribution
netReduction
source
```

Für klassische Verträge:

```text
employeeContribution = monthlyContribution
employerContribution = 0
totalContribution = monthlyContribution
netReduction = monthlyContribution, falls vom Konto gebucht
source = bank_account/manual
```

Für bAV per Entgeltumwandlung:

```text
employeeContribution = employeeGrossContribution
employerContribution = berechneter Arbeitgeberbetrag
totalContribution = employeeContribution + employerContribution
netReduction = monthlyNetReduction oder null
source = payroll_gross
```

### 8.2 Projektion bis Rentenbeginn

Die private/bAV-Projektion sollte mit dem effektiven Gesamtbeitrag rechnen.

Bei bAV:

- Arbeitnehmeranteil plus Arbeitgeberanteil erhöhen das Vertragskapital.
- Netto-Minderung spielt für das Vertragskapital keine Rolle.
- Beitragsdynamik wirkt wie oben beschrieben.

Beispiel:

```text
employeeGrossContribution = 200
employerContributionType = percent_of_employee
employerContributionValue = 15
totalContribution = 230
expectedReturnPct = 3
rentenfaktor = 27
startsOn = 2056-01-01
```

Die Projektion nutzt 230 EUR monatlich, nicht 200 EUR und nicht die Netto-Minderung.

### 8.3 Renditemessung aus Vertragsständen

FinTrack misst bereits Vertragsrenditen aus:

- Vertragsständen,
- Beiträgen zwischen den Ständen.

Für bAV muss diese Logik die effektiven Beiträge verwenden.

Problem:

- Bei `bank_account` existieren echte `SpendingTransaction`-Beiträge.
- Bei `payroll_gross` existieren bewusst keine `SpendingTransaction`-Beiträge.

Die Renditemessung darf daher nicht nur aus gebuchten Kontoabflüssen lesen.

Für bAV braucht sie geplante Vertragsbeiträge als Cashflows.

Ansatz:

- Wenn Vertrag `bank_account` ist und echte Buchungen existieren:
  - tatsächliche Buchungen verwenden.
- Wenn Vertrag `payroll_gross` ist:
  - geplante Monatsbeiträge aus Vertragsdaten generieren.
- Wenn Vertrag `manual` ist:
  - entweder `monthlyContribution` als geplante Beiträge verwenden oder Renditemessung nur mit Vertragsständen erlauben, je nachdem heutiges Verhalten.

Wichtig:

- Es darf keine Doppelzählung geben.
- Wenn ein bAV-Vertrag versehentlich zusätzlich Konto-Buchungen hat, muss die Logik klar priorisieren oder warnen.

Empfehlung:

```text
if contributionSource == "bank_account":
  use actual pensionContractId spending transactions
else if contributionSource == "payroll_gross":
  synthesize contribution cashflows from contract schedule
else:
  use existing projection/manual behavior
```

Diese synthetischen Cashflows sind keine Kontobuchungen. Sie existieren nur innerhalb der Rentenvertragsberechnung.

### 8.4 FIRE

FIRE nutzt heute deterministisch bereits eine Pension Bridge, Monte Carlo offenbar noch nicht vollständig.

Für bAV gilt:

- Spätere bAV-Rente erhöht spätere Renteneinkünfte.
- Dadurch sinkt der Kapitalbedarf ab Rentenbeginn.
- Während der Erwerbsphase kann bAV die verfügbare Netto-Liquidität senken.

Die erste bAV-Version sollte nur den sicheren Teil aufnehmen:

- bAV erhöht spätere Rentenprojektion.
- bAV wird in `monthlyPrivate` oder einer vergleichbaren privaten Rentensumme berücksichtigt.

Nicht sofort tun:

- automatische Veränderung der heutigen Sparrate aus Brutto-Umwandlung.

Warum:

- FinTrack sieht bereits nur tatsächliche Nettozahlungen.
- Wenn das Netto-Gehalt niedriger ist, ist das bereits in realen Kontobuchungen enthalten.
- Eine zusätzliche Netto-Minderung würde die Sparfähigkeit doppelt reduzieren, wenn der Nutzer seine echten Nettoeingänge pflegt.

Die Netto-Minderung sollte zunächst nur informativ angezeigt werden.

Später kann ein expliziter Planungsmodus entstehen:

> "Netto-Minderung in zukünftigen Cashflow-Prognosen berücksichtigen"

Dieser Modus darf aber nur für geplante Zukunftswerte gelten, nicht rückwirkend auf echte Kontoauswertungen.

### 8.5 Spending und Sparquote

Eine bAV per Entgeltumwandlung sollte nicht als Ausgabe zählen.

Auch nicht als normale Sparrate aus Netto.

Besser:

- separate Kennzahl "nicht kontowirksame Altersvorsorge"
- optional Bestandteil einer erweiterten Vorsorgequote

Beispielauswertung:

```text
Netto-Sparrate aus Konten/Depot: 600 EUR
bAV Gesamtbeitrag: 230 EUR
  davon Arbeitnehmer-Brutto: 200 EUR
  davon Arbeitgeber: 30 EUR
erfasste Netto-Minderung: 115 EUR
erweiterte Vorsorgeleistung: 830 EUR
```

Diese Darstellung ist ehrlicher als eine einzige Sparquote.

Denn:

- Die 230 EUR bAV sind echter Vermögensaufbau/Anwartschaft.
- Sie sind aber nicht aus dem Netto frei verfügbar.
- Der Arbeitgeberanteil ist ein zusätzlicher Benefit.
- Die Netto-Minderung ist der Liquiditätsverlust, nicht der Vorsorgezufluss.

### 8.6 Gesetzliche Rente

Eine Brutto-Entgeltumwandlung kann Auswirkungen auf gesetzliche Rentenpunkte haben, wenn sozialversicherungspflichtiges Einkommen sinkt.

FinTrack sollte das in Version 1 nicht automatisch berechnen.

Gründe:

- Es hängt von Einkommen, Grenzen und individueller Abrechnung ab.
- Die Anwendung kennt kein Bruttoeinkommen.
- Eine automatische Korrektur wäre wahrscheinlich ungenau.

Stattdessen:

- Hinweis in der UI:
  - "Eine Entgeltumwandlung kann gesetzliche Rentenansprüche beeinflussen. FinTrack passt Rentenpunkte nicht automatisch an; erfasse deine Renteninformationen wie bisher."
- Die gesetzlichen Rentenpunkte bleiben vom Nutzer oder aus Renteninformationen geführt.
- Wenn sich die bAV auf Rentenpunkte auswirkt, zeigt sich das später in den tatsächlichen Renteninformationen.

## 9. UI-Planung

### 9.1 Einstieg

Die bAV gehört in den bestehenden Bereich:

- `/retirement?tab=pension`

Nicht in:

- Konten & Buchungen,
- normale Verträge,
- Depottransaktionen.

Im Rentenbereich sollte ein bAV-Vertrag wie ein normaler Rentenvertrag sichtbar sein, aber mit bAV-spezifischen Feldern.

### 9.2 Vertragstyp-Auswahl

Im Formular:

```text
Art der Altersvorsorge:
- Private Rentenversicherung
- Riester
- Rürup
- Betriebliche Altersvorsorge
- Sonstige gesetzliche/berufsständische Versorgung
- Sonstige
```

Wenn "Betriebliche Altersvorsorge" gewählt wird, erscheint ein Abschnitt:

```text
Beiträge über Gehaltsabrechnung
```

### 9.3 Beitragsquelle

Feld:

```text
Wie wird der Beitrag gezahlt?
```

Optionen:

1. Vom Konto abbuchen
   - heutige Logik
   - Konto wählen
   - fällige Beiträge erscheinen im Review
2. Über Gehaltsabrechnung / Entgeltumwandlung
   - keine Kontobuchung
   - Arbeitnehmer-Bruttobeitrag erfassen
   - Arbeitgeberförderung erfassen
3. Nur Arbeitgeber / extern
   - keine Kontobuchung
   - nur Arbeitgeberbetrag erfassen
4. Nur manuell dokumentieren
   - keine automatische Beitragslogik

Für bAV sollte "Über Gehaltsabrechnung / Entgeltumwandlung" als empfohlene Auswahl erscheinen.

### 9.4 bAV-Beitragsformular

Felder:

```text
Arbeitnehmer-Brutto-Umwandlung pro Monat
[ 200,00 EUR ]

Arbeitgeberförderung
( ) keine
( ) fester Betrag
( ) Prozentsatz des Arbeitnehmerbeitrags

Bei fester Betrag:
[ 40,00 EUR ]

Bei Prozentsatz:
[ 15,00 % ]

Erfasste Netto-Minderung pro Monat (optional)
[ 115,00 EUR ]

Beitragsdynamik pro Jahr (optional)
[ 0,00 % ]
```

Direkt darunter sollte FinTrack eine Zusammenfassung zeigen:

```text
Monatlicher Vertragsbeitrag: 230,00 EUR
  200,00 EUR Arbeitnehmer-Brutto-Umwandlung
   30,00 EUR Arbeitgeberförderung

Dieser Beitrag wird nicht auf einem Konto gebucht.
Deine Konten zeigen bereits das tatsächliche Netto-Gehalt.
```

Wenn `monthlyNetReduction` gesetzt ist:

```text
Erfasste Netto-Auswirkung: 115,00 EUR weniger Netto pro Monat.
Dieser Wert ist nur eine Planungsnotiz und verändert keine Kontobuchungen.
```

### 9.5 Warnung bei Kontoauswahl und Payroll gleichzeitig

Falls der Nutzer bei bAV `payroll_gross` wählt, darf kein Konto erforderlich sein.

Wenn bereits ein Konto gesetzt ist und der Nutzer auf Payroll wechselt:

- UI sollte erklären:
  - "Bei Gehaltsabrechnung wird kein Konto belastet. Bestehende bereits gebuchte Beiträge bleiben erhalten, neue Beiträge werden nicht mehr als Kontobuchung vorgeschlagen."

Wenn bestehende gebuchte `pensionContractId`-Buchungen vorhanden sind:

- Nicht löschen.
- Nicht automatisch ändern.
- Hinweis anzeigen:
  - "Dieser Vertrag hat bereits Kontobuchungen. Prüfe, ob diese aus einer früheren Zahlungsweise stammen."

### 9.6 Vertragskarte

Eine bAV-Karte sollte anzeigen:

```text
Name: MetallRente / Allianz bAV
Typ: Betriebliche Altersvorsorge
Quelle: Gehaltsabrechnung
Monatlicher Gesamtbeitrag: 230 EUR
Arbeitnehmer-Brutto: 200 EUR
Arbeitgeber: 30 EUR
Netto-Minderung: 115 EUR (optional)
Aktueller Vertragswert: 12.400 EUR
Rentenfaktor: 27 EUR je 10.000 EUR
Prognostizierte Monatsrente: 420 EUR
```

### 9.7 Review-Liste für fällige Beiträge

Heute gibt es für kontofinanzierte Rentenbeiträge eine Review-Liste.

Für bAV per Payroll sollte es keine normale "Beitrag buchen"-Review-Liste geben, weil nichts auf einem Konto zu buchen ist.

Stattdessen mögliche Anzeige:

```text
Nicht kontowirksame bAV-Beiträge laufen automatisch in die Projektion ein.
Letzter erfasster Vertragsstand: 31.12.2025
Nächster sinnvoller Check: neue Jahresmitteilung erfassen.
```

Wenn später eine "Beitragsbestätigung" gewünscht ist, sollte sie nicht in `SpendingTransaction` schreiben, sondern höchstens den internen Beitrags-Cursor fortschreiben. Für Version 1 ist das nicht nötig, weil geplante Beiträge aus Startdatum und Vertragsdaten ableitbar sind.

### 9.8 Vertragsstände

Vertragsstände bleiben wichtig.

Die UI sollte bAV-Nutzer aktiv dazu bringen, jährlich den Vertragsstand einzutragen.

Text:

```text
Trage den Wert aus der jährlichen bAV-Mitteilung ein. FinTrack kann daraus zusammen mit den erfassten Beiträgen die tatsächliche Vertragsrendite schätzen.
```

Bei Payroll-bAV:

```text
Für die Renditemessung nutzt FinTrack die hier erfassten Brutto-/Arbeitgeberbeiträge als interne Cashflows. Es werden keine Kontobuchungen erzeugt.
```

## 10. Konten & Buchungen

### 10.1 Keine bAV-Payroll-Buchungen auf Konten

Die zentrale Regel:

> `contributionSource = payroll_gross` erzeugt keine `SpendingTransaction`.

Das gilt für:

- fällige Beiträge,
- wiederkehrende Buchungsvorschläge,
- Kontoauswertungen,
- Importabgleich.

### 10.2 Echte Netto-Gehaltsbuchung bleibt unverändert

Der Nutzer bucht oder importiert weiterhin sein tatsächliches Netto-Gehalt.

Beispiel:

```text
30.04.2026 +2.800 EUR Gehalt
```

FinTrack muss nicht wissen, ob das ohne bAV 2.915 EUR gewesen wäre.

Wenn der Nutzer die Netto-Minderung dokumentieren will, wird sie am bAV-Vertrag gespeichert, nicht als Buchung.

### 10.3 Optionaler Hinweis bei Gehaltsplanung

Wenn es eine geplante Cashflow-Zeile für Gehalt gibt, könnte FinTrack später optional eine Verbindung anbieten:

```text
Gehaltsplan "Gehalt" ist bereits netto nach bAV?
[x] Ja, nicht zusätzlich reduzieren
[ ] Nein, geplante Netto-Minderung abziehen
```

Für Version 1 sollte das nicht umgesetzt werden, weil die Gefahr einer Doppelzählung hoch ist.

### 10.4 Import

Bankimports sollten bAV-Payroll nicht erkennen müssen.

Sie sehen nur das Netto-Gehalt.

Keine Parser-Anpassung notwendig.

## 11. Reporting

### 11.1 Rentenübersicht

Die Rentenübersicht sollte bAV separat ausweisen.

Mögliche Aufteilung:

```text
Gesetzliche Rente
Private Rentenverträge
Betriebliche Altersvorsorge
Sonstige Versorgung
```

Für bAV:

- aktueller Vertragswert,
- monatlicher Gesamtbeitrag,
- Arbeitgeberanteil,
- prognostizierte Monatsrente,
- Startdatum,
- Datenqualität.

### 11.2 Beitragsübersicht

Eine Beitragsübersicht sollte unterscheiden:

```text
Kontowirksame Beiträge:
- Private Rentenversicherung: 150 EUR vom Girokonto

Nicht kontowirksame Beiträge:
- bAV Arbeitnehmer-Brutto: 200 EUR
- bAV Arbeitgeber: 30 EUR
```

Das vermeidet falsche Summen.

### 11.3 Erweiterte Vorsorgequote

Optional später:

```text
Netto-Sparen aus Konten/Depot
+ kontowirksame Rentenbeiträge
+ nicht kontowirksame bAV-Gesamtbeiträge
= erweiterte Vorsorgeleistung
```

Wichtig:

- Nicht als normale Sparquote ersetzen.
- Als eigene Kennzahl erklären.

### 11.4 Arbeitgeberförderung sichtbar machen

Ein eigener kleiner Wert ist sinnvoll:

```text
Arbeitgeberförderung bAV: 30 EUR / Monat, 360 EUR / Jahr
```

Warum:

- Das ist ein echter Benefit.
- Nutzer können sehen, ob die Entgeltumwandlung durch Zuschuss attraktiver wird.
- Es motiviert zur Pflege der Daten, ohne steuerliche Empfehlung zu geben.

## 12. Validierung und Plausibilität

### 12.1 Eingaberegeln

Für `payroll_gross`:

- Arbeitnehmer-Bruttobeitrag muss `>= 0` sein.
- Arbeitgeberwert muss `>= 0` sein.
- Prozentsatz sollte realistisch begrenzt werden, z. B. UI-Warnung ab sehr hohen Werten.
- Netto-Minderung muss `>= 0` sein.
- Netto-Minderung darf größer als Arbeitnehmer-Brutto sein, sollte aber warnen, weil das ungewöhnlich ist.
- Gesamtbeitrag muss größer 0 sein, außer der Vertrag wird nur dokumentiert.

### 12.2 Warnungen

Warnung 1:

```text
Die Netto-Minderung ist höher als die Brutto-Umwandlung. Prüfe, ob du hier den Gesamtbeitrag oder einen Jahreswert eingetragen hast.
```

Warnung 2:

```text
Der Arbeitgeberzuschuss ist sehr hoch im Verhältnis zum Arbeitnehmerbeitrag. Wenn das korrekt ist, kannst du speichern.
```

Warnung 3:

```text
Dieser bAV-Vertrag ist auf Gehaltsabrechnung gestellt, hat aber ein Verrechnungskonto. Neue Beiträge werden nicht vom Konto gebucht.
```

Warnung 4:

```text
Dieser Vertrag hat keine Vertragsstände. Die Projektion basiert nur auf Beiträgen, Rentenfaktor und Renditeannahme.
```

### 12.3 Datenqualität

Die UI sollte Datenqualität anzeigen:

- "Gut": Vertragsstand, Rentenfaktor, Startdatum und Beiträge vorhanden.
- "Mittel": Beiträge und erwartete Monatsrente vorhanden, aber kein Vertragsstand.
- "Niedrig": nur Name und grober Beitrag vorhanden.

## 13. Migrationsstrategie für bestehende Nutzer

### 13.1 Bestehende occupational-Verträge

Bestehende `occupational`-Verträge dürfen nicht automatisch in die neue Payroll-Logik gezwungen werden.

Stattdessen:

- Sie bleiben `manual` oder `bank_account` je nach vorhandenem Konto.
- Beim Bearbeiten zeigt die UI einen Hinweis:
  - "Dieser bAV-Vertrag nutzt noch das alte Beitragsmodell. Du kannst ihn auf Gehaltsabrechnung umstellen."

### 13.2 Bestehende Konto-Buchungen

Falls ein Nutzer bisher bAV-Beiträge manuell als Kontoausgabe gebucht hat, dürfen diese nicht gelöscht werden.

Optionen:

- Nutzer lässt sie stehen, wenn sie tatsächlich vom Konto abgegangen sind.
- Nutzer löscht oder korrigiert sie selbst, wenn sie Phantom-Buchungen waren.

FinTrack sollte nur warnen, nicht automatisch reparieren.

### 13.3 Altdaten mit `monthlyContribution`

Wenn ein bestehender bAV-Vertrag nur `monthlyContribution = 230` hat:

- Anzeige:
  - "Gesamtbeitrag: 230 EUR"
  - "Aufteilung Arbeitnehmer/Arbeitgeber nicht erfasst"
- Nutzer kann später aufteilen:
  - Arbeitnehmer-Brutto 200
  - Arbeitgeber 15 %

Nach Aufteilung wird der effektive Gesamtbeitrag aus Komponenten berechnet.

## 14. Tests, die später nötig wären

Keine Implementierung in dieser Datei, aber folgende Tests sollten bei Umsetzung entstehen.

### 14.1 Beitragsberechnung

Testfälle:

- keine Arbeitgeberförderung
- fixer Arbeitgeberbetrag
- prozentuale Arbeitgeberförderung
- null/fehlende Werte
- negative Werte werden nicht akzeptiert oder normalisiert
- Beitragsdynamik bei Prozentförderung
- Beitragsdynamik bei Fixförderung

### 14.2 Keine Kontobuchung bei Payroll

Testfälle:

- `payroll_gross` erzeugt keine fälligen `SpendingTransaction`-Vorschläge.
- `bank_account` erzeugt weiterhin fällige Vorschläge.
- Wechsel von `bank_account` zu `payroll_gross` erzeugt keine neuen Buchungen.
- Bestehende Buchungen bleiben sichtbar.

### 14.3 Projektion

Testfälle:

- bAV-Gesamtbeitrag fließt in Kapitalprojektion ein.
- Arbeitgeberförderung erhöht Kapital.
- Netto-Minderung beeinflusst Kapital nicht.
- Rentenfaktor nutzt projiziertes Kapital inklusive Arbeitgeberanteil.

### 14.4 Renditemessung

Testfälle:

- Payroll-bAV nutzt synthetische Vertrags-Cashflows.
- Konto-finanzierter Vertrag nutzt echte `SpendingTransaction`-Cashflows.
- Keine Doppelzählung, wenn beide Daten vorhanden sind.
- Vertragsstände vor Beitragsstart funktionieren.
- Fehlende Vertragsstände führen zu Fallback ohne Crash.

### 14.5 Export/Import

Testfälle:

- neue bAV-Felder werden exportiert.
- neue bAV-Felder werden importiert.
- alte Exporte ohne Felder erhalten sinnvolle Defaults.
- Guest Mode und Registered Mode verhalten sich identisch.

### 14.6 UI

Testfälle:

- Auswahl `occupational` zeigt bAV-Felder.
- Auswahl `payroll_gross` versteckt Konto-Pflicht.
- Zusammenfassung rechnet Arbeitgeberförderung korrekt.
- Hinweis "keine Kontobuchung" erscheint.
- Netto-Minderung wird als Planungsnotiz gezeigt.

## 15. Priorisierte Umsetzung

### Phase 1: Fachliches Fundament

Ziel:

- bAV korrekt als nicht kontowirksamer Rentenvertrag abbilden.

Umfang:

- Datenmodellfelder hinzufügen.
- Effektive Beitragsberechnung zentralisieren.
- Rentenprojektion auf effektiven Beitrag umstellen.
- UI-Felder im Rentenvertragsformular ergänzen.
- Keine Kontobuchungen für Payroll-bAV erzeugen.
- Export/Import erweitern.

Nicht enthalten:

- Netto-Prognose in FIRE.
- Brutto-Netto-Rechner.
- automatische Rentenpunkte-Korrektur.
- Payroll-Import.

### Phase 2: Transparenz und Auswertung

Ziel:

- Nutzer versteht, was die bAV leistet.

Umfang:

- bAV-Aufteilung in Rentenübersicht.
- Arbeitgeberförderung pro Monat/Jahr anzeigen.
- Beitragsübersicht kontowirksam vs. nicht kontowirksam.
- Datenqualitätsanzeige.
- bessere Hinweise zu Vertragsständen.

### Phase 3: Renditemessung sauber machen

Ziel:

- bAV-Rendite aus Vertragsständen und internen Beiträgen messen.

Umfang:

- synthetische Vertrags-Cashflows für Payroll-bAV.
- Prioritätsregel echte Buchungen vs. Payroll-Schedule.
- Tests für XIRR/Rendite.
- UI-Erklärung der Berechnung.

Diese Phase kann auch schon in Phase 1 enthalten sein, wenn die bestehende Renditeanzeige sonst irreführend wäre.

### Phase 4: Optionaler Planungsmodus Netto-Minderung

Ziel:

- zukünftige Liquiditätsplanung kann Netto-Minderung berücksichtigen, ohne echte Konten zu verändern.

Umfang:

- Option am Vertrag:
  - "Netto-Minderung in zukünftiger Planung berücksichtigen"
- Verwendung nur in Planungs-/Forecast-Kontexten.
- Keine rückwirkende Änderung historischer Spending-Auswertungen.
- klare Doppelzählungswarnung, wenn Gehalt bereits netto nach bAV geplant ist.

Diese Phase sollte erst umgesetzt werden, wenn klar ist, wo FinTrack zukünftige Cashflows zentral prognostiziert.

## 16. Entscheidungsmatrix für die "Krücke"

| Lösung | Vorteil | Nachteil | Empfehlung |
| --- | --- | --- | --- |
| bAV gar nicht buchen, nur Vertragsbeitrag intern führen | Konten bleiben korrekt, Rentenprojektion wird korrekt | Beitrag ist nicht in Konten sichtbar | Ja, Standard |
| Phantom-Ausgabe vom Girokonto | Einfach sichtbar | Kontostand falsch | Nein |
| Pseudo-Gehalt + bAV-Ausgabe | Vollständig im Ledger darstellbar | Einkommen/Kontoimport falsch, hoher Pflegeaufwand | Nein |
| Separates Schattenkonto "Payroll" | Technisch sauberer als Girokonto | Neue Kontoart nur für Krücke, UI-Komplexität | Später höchstens prüfen |
| Voller Brutto-Netto-Rechner | Könnte Nettoeffekt schätzen | Viel zu groß, wartungsintensiv, rechtlich heikel | Nein |
| Manuelle Netto-Minderung am Vertrag | Einfach, ehrlich, keine Kontoverfälschung | Nutzer muss Wert selbst kennen | Ja |

## 17. Warum kein Schattenkonto in Version 1?

Ein Schattenkonto wäre denkbar:

```text
Konto: Gehaltsabrechnung / Payroll
+200 EUR interner Bruttoanteil
+30 EUR Arbeitgeberzuschuss
-230 EUR bAV-Beitrag
Saldo 0
```

Vorteil:

- Doppelte Buchführung wäre vollständig.
- Der Beitrag hätte eine Ledger-Spur.

Nachteile:

- Nutzer muss ein Konto verstehen, das kein Konto ist.
- Konten & Buchungen würden nicht mehr nur echte Konten zeigen.
- Reports müssten Schattenkonten überall ausfiltern.
- Import/Reconciliation müsste Schattenkonten ignorieren.
- Es löst die Nettofrage trotzdem nicht.

Für FinTrack ist das zu viel Komplexität für Version 1.

Falls später mehrere nicht kontowirksame Benefits modelliert werden sollen, könnte ein allgemeines "Benefit Ledger" entstehen. Für bAV allein reicht das nicht.

## 18. Offene Produktfragen

Vor Implementierung sollten diese Fragen entschieden werden.

### 18.1 Soll `monthlyContribution` bei bAV noch sichtbar sein?

Empfehlung:

- In der UI nicht als editierbares Hauptfeld zeigen.
- Stattdessen berechneten Gesamtbeitrag anzeigen.
- In technischen Details oder Migration kann `monthlyContribution` als Legacy-Wert bestehen.

### 18.2 Soll `external_only` in Version 1 enthalten sein?

Beispiel:

- Arbeitgeber zahlt komplett alleine 100 EUR pro Monat.

Empfehlung:

- Ja, wenn es kaum Zusatzaufwand ist.
- Fachlich ist es dieselbe nicht kontowirksame Beitragslogik mit Arbeitnehmeranteil 0.

### 18.3 Soll die Netto-Minderung in Sparquote einfließen?

Empfehlung:

- Nein für bestehende Sparquote.
- Ja als separate ergänzende Vorsorgekennzahl.

### 18.4 Soll Arbeitgeberförderung als Rendite/Free Money ausgewiesen werden?

Empfehlung:

- Ja, aber vorsichtig.
- Nicht als Investmentrendite des Vertrags darstellen.
- Als Arbeitgeber-Benefit oder Zuschuss anzeigen.

### 18.5 Soll FinTrack steuerliche Hinweise geben?

Empfehlung:

- Nur generische Hinweise.
- Keine konkreten gesetzlichen Zuschuss-, Steuer- oder Sozialversicherungsregeln hardcoden, ohne separate aktuelle Prüfung.
- Keine Optimierungsempfehlung "lohnt sich / lohnt sich nicht" in Version 1.

## 19. Konkrete Nutzerflüsse

### 19.1 Neue bAV anlegen

1. Nutzer öffnet Rentenbereich.
2. Nutzer klickt "Rentenvertrag hinzufügen".
3. Nutzer wählt "Betriebliche Altersvorsorge".
4. Nutzer wählt "Über Gehaltsabrechnung / Entgeltumwandlung".
5. Nutzer trägt ein:
   - Name,
   - Anbieter,
   - Startdatum,
   - Arbeitnehmer-Brutto-Umwandlung,
   - Arbeitgeberförderung,
   - optional Netto-Minderung,
   - Rentenfaktor oder erwartete Monatsrente,
   - aktueller Vertragswert oder Vertragsstand.
6. FinTrack zeigt:
   - Gesamtbeitrag,
   - keine Kontobuchung,
   - prognostizierte Monatsrente.
7. Nutzer speichert.
8. Kontoseite bleibt unverändert.

### 19.2 Bestehende bAV auf Payroll umstellen

1. Nutzer öffnet bestehenden occupational-Vertrag.
2. UI zeigt Hinweis auf neues Beitragsmodell.
3. Nutzer wählt "Über Gehaltsabrechnung".
4. Kontoauswahl wird deaktiviert oder entfernt.
5. Nutzer teilt bisherigen Gesamtbeitrag auf Arbeitnehmer/Arbeitgeber auf.
6. FinTrack zeigt Differenz:
   - alter Gesamtbeitrag,
   - neuer berechneter Gesamtbeitrag.
7. Wenn bestehende Buchungen vorhanden sind, zeigt FinTrack Warnung.
8. Nutzer speichert.

### 19.3 Jahresmitteilung erfassen

1. Nutzer erhält bAV-Mitteilung.
2. Nutzer öffnet Vertrag.
3. Nutzer trägt neuen Vertragsstand ein.
4. FinTrack misst Rendite aus:
   - altem Vertragsstand,
   - neuem Vertragsstand,
   - internen bAV-Beiträgen,
   - Arbeitgeberförderung.
5. FinTrack zeigt:
   - gemessene Rendite,
   - Datenbasis,
   - Hinweis, dass Payroll-Beiträge nicht auf Konten gebucht wurden.

## 20. Risiken

### 20.1 Doppelzählung

Höchstes Risiko.

Beispiele:

- Nutzer bucht bAV zusätzlich manuell als Ausgabe.
- Nutzer setzt Netto-Minderung und FinTrack zieht sie später zusätzlich von geplantem Netto ab.
- Renditelogik nutzt echte Buchungen und synthetische Payroll-Beiträge gleichzeitig.

Gegenmaßnahmen:

- Klare `contributionSource`.
- Keine Payroll-Buchungen erzeugen.
- Warnung bei bestehenden `pensionContractId`-Buchungen.
- Netto-Minderung zunächst nur informativ.
- Tests gegen Doppelzählung.

### 20.2 Falsche Sparquote

Wenn bAV als normale Ausgabe oder normale Sparrate behandelt wird, werden KPI falsch.

Gegenmaßnahme:

- bAV-Payroll separat ausweisen.
- Bestehende Sparquote nicht still ändern.

### 20.3 Rechtliche Scheingenauigkeit

Wenn FinTrack Arbeitgeberzuschüsse, Steuerersparnis oder SV-Effekte automatisch berechnet, kann es falsch oder veraltet sein.

Gegenmaßnahme:

- Arbeitgeberförderung nutzerdefiniert.
- Netto-Minderung manuell.
- Generische Hinweise statt Rechts-/Steueraussagen.

### 20.4 Zu komplexes Formular

bAV kann schnell komplex werden.

Gegenmaßnahme:

- Progressive Disclosure:
  - zuerst Beitragsquelle,
  - dann nur relevante Felder.
- Zusammenfassung sofort sichtbar.
- Erweiterte Felder einklappbar.

### 20.5 Migration von Altdaten

Bestehende occupational-Verträge könnten unterschiedlich gemeint sein.

Gegenmaßnahme:

- Keine automatische harte Uminterpretation.
- Defaults konservativ.
- Nutzer entscheidet beim Bearbeiten.

## 21. Empfohlene finale Produktregel

Die wichtigste Regel sollte im Code, in Tests und in der UI konsequent gelten:

> Eine bAV per Gehaltsabrechnung ist ein Altersvorsorgezufluss, aber keine Kontobuchung.

Daraus folgen alle weiteren Regeln:

- Gesamtbeitrag erhöht Vertragsprojektion.
- Arbeitgeberförderung wird im Vertrag berechnet.
- Netto-Minderung ist nur eine manuelle Planungsnotiz.
- Konten zeigen weiterhin echte Nettozahlungen.
- Spending bleibt unverfälscht.
- FIRE/Rente nutzen die spätere Leistung aus dem Vertrag.

## 22. Kurzfassung für spätere Umsetzung

Wenn diese Planung später umgesetzt wird, sollte die Implementierung grob so aussehen:

1. `PensionContract` um Beitragsquelle und bAV-Komponenten erweitern.
2. Eine zentrale Beitrags-Breakdown-Funktion einführen.
3. Rentenprojektion und Vertragsrendite auf diese Funktion umstellen.
4. Payroll-bAV explizit von Konto-Buchungsreviews ausschließen.
5. Rentenvertragsformular für `occupational` erweitern.
6. Zusammenfassung und Warnungen einbauen.
7. Export/Import und Supabase/LocalStore erweitern.
8. Tests gegen Doppelzählung und falsche Kontobuchungen schreiben.

Die erste Version sollte absichtlich keine Lohnabrechnung nachbauen. Sie soll nur die wirtschaftliche Realität erfassen:

```text
Was fließt in den bAV-Vertrag?
Von wem kommt es?
Ist es kontowirksam?
Welche spätere Rente/Kapitalwirkung entsteht daraus?
```

Für FinTrack ist das die robuste, wartbare und fachlich ehrliche Lösung.
