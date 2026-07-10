import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv, detectFormat, fingerprint, isValidTx, type ParsedTx } from "../lib/import/csv";
import { reconcile } from "../lib/import/reconcile";
import { portfolioToCsv } from "../lib/export/export";
import type { Asset, Transaction, PortfolioData } from "../lib/types";

const ZERO = [
  "Name;ISIN;WKN;Anzahl;Anzahl storniert;Status;Orderart;Limit;Stop;Erstellt Datum;Erstellt Zeit;Gültig bis;Richtung;Wert;Wert storniert;Mindermengenzuschlag;Ausführung Datum;Ausführung Zeit;Ausführung Kurs;Anzahl ausgeführt;Anzahl offen;Gestrichen Datum;Gestrichen Zeit",
  "Apple;US0378331005;865985;2;;ausgeführt;Market;;;01.03.2025;10:00:00;;Kauf;-460,00;;1,00;03.03.2025;09:30:00;230,00;2;0;;",
  "GameStop;US36467W1099;A0HGDX;3;;gestrichen;Limit;21,00;;29.05.2025;16:16:24;22.05.2026;Kauf;-63,00;;1,00;;;;0;0;02.06.2025;09:12:33",
].join("\n");

// Small anonymized excerpt covering an executed Kauf, an executed Verkauf and
// a gestrichen (cancelled) row, used to exercise direction and the
// execution-date-not-creation-date distinction: the Verkauf row's "Erstellt
// Datum" (05.03.2025) differs from its "Ausführung Datum" (06.03.2025), and
// only the latter must land in the parsed transaction.
const ZERO_ORDERS = [
  "Name;ISIN;WKN;Anzahl;Anzahl storniert;Status;Orderart;Limit;Stop;Erstellt Datum;Erstellt Zeit;Gültig bis;Richtung;Wert;Wert storniert;Mindermengenzuschlag;Ausführung Datum;Ausführung Zeit;Ausführung Kurs;Anzahl ausgeführt;Anzahl offen;Gestrichen Datum;Gestrichen Zeit",
  "Apple;US0378331005;865985;2;;ausgeführt;Market;;;01.03.2025;10:00:00;;Kauf;-460,00;;1,00;03.03.2025;09:30:00;230,00;2;0;;",
  "Apple;US0378331005;865985;1;;ausgeführt;Market;;;05.03.2025;11:00:00;;Verkauf;120,00;;1,00;06.03.2025;15:45:00;125,00;1;0;;",
  "GameStop;US36467W1099;A0HGDX;3;;gestrichen;Limit;21,00;;29.05.2025;16:16:24;22.05.2026;Kauf;-63,00;;1,00;;;;0;0;02.06.2025;09:12:33",
].join("\n");

const FNZ = [
  "Depotnummer;Depotposition;Ref. Nr.;Buchungsdatum;Umsatzart;Teilumsatz;Fonds;ISIN;Zahlungsbetrag in ZW;Zahlungswährung (ZW);Anteile;Abrechnungskurs in FW;Fondswährung (FW);Kursdatum;Devisenkurs (ZW/FW);Anlagebetrag in ZW",
  "99134053488;26;0400059167/29052026;01.06.26;Kauf;vermögenswirksame Leistungen;Vanguard FTSE All-World UCITS ETF USD Acc;IE00BK5BQT80;40;EUR;0,242496;190,6;USD;29.05.26;1,157811;39,92",
].join("\n");

const TR = [
  '"datetime","date","account_type","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","currency"',
  '"2021-02-01T19:18:46.768131Z","2021-02-01","DEFAULT","CASH","CUSTOMER_INBOUND","","SIMON","","","","200.000000","","","EUR"',
  '"2021-02-01T19:27:22.290Z","2021-02-01","DEFAULT","TRADING","BUY","STOCK","AMC Entertainment","US00165C1045","5.0000000000","11.800000","-59.00","-1.00","","EUR"',
].join("\n");

const DB = [
  "Bankleistungsnummer;Bestand;Bezeichnung;WKN;ISIN;Währung;Hinweis Einstandskurs;Einstandskurs;Deviseneinstandskurs;Kurs;Devisenkurs;Gewinn/Verlust in EUR;Gewinn/Verlust in %;Marktwert in EUR inkl. Stückzinsen;Stückzinsen in EUR;Anteil in %;Datum letzte Bewegung;Gattung;Branche/Sektoren/Restlaufzeit;",
  "310 1383611 00;22,00;DWS EUROPEAN OPPORTUNITIES;847415;DE0008474156;EUR;;434,93909;1,00;544,37;1,00;2.407,48;25,16;11.976,14;;6,46;2026-06-25;Investmentfonds;Aktien;4;",
].join("\n");

// Real FNZ export excerpt (Depotnummer anonymized). Anteile is SIGNED: negative
// for every share-reducing Umsatzart. The penultimate row is a synthetic
// cash-only variant (Anteile = 0) to exercise the skipped-row counting — the
// real export has no such rows, but other FNZ exports do. Two rows in here
// (Entgeltbelastung Verkauf and Interner Übertrag (Abgang)) book a zero
// "Zahlungsbetrag in ZW" — the parser falls back to the settlement price
// (Abrechnungskurs in FW ÷ Devisenkurs (ZW/FW)), which both of these rows
// have, so they still resolve to a valid price. The last row is a further
// synthetic variant of the same zero-Zahlungsbetrag situation but *without*
// Abrechnungskurs either, so no fallback is possible — it exercises the
// validation guardrail's invalid-row counting, which the real export
// otherwise no longer hits after the settlement-price fallback was added.
const FNZ_FULL = [
  "Depotnummer;Depotposition;Ref. Nr.;Buchungsdatum;Umsatzart;Teilumsatz;Fonds;ISIN;Zahlungsbetrag in ZW;Zahlungswährung (ZW);Anteile;Abrechnungskurs in FW;Fondswährung (FW);Kursdatum;Devisenkurs  (ZW/FW);Anlagebetrag in ZW;Vertriebsprovision in ZW (im Abrechnungskurs enthalten);KVG Einbehalt in ZW (im Abrechnungskurs enthalten);Gegenwert der Anteile in ZW;Anteile zum Bestandsdatum;Barausschüttung/Steuerliquidität je Anteil in EW;Ertragswährung (EW);Bestandsdatum;Devisenkurs (ZW/EW);Barausschüttung/Steuerliquidität in ZW;Bruttobetrag VAP je Anteil in EUR;Entgelt in ZW;Entgelt in EUR;Steuern in ZW;Steuern in EUR;Devisenkurs (EUR/ZW);Art des Steuereinbehalts;Steuereinbehalt in EUR",
  "99000000000;26;0400059167/29052026;01.06.26;Kauf;vermögenswirksame Leistungen;Vanguard FTSE All-World UCITS ETF USD Acc;IE00BK5BQT80;40;EUR;0,242496;190,6;USD;29.05.26;1,157811;39,92;0;0;0;0;0;;;;0;0;0,08;0,08;0;0;;Steuereinbehalt direkt am Umsatz;0",
  "99000000000;26;0400229632/07102025;09.10.25;Kauf;;Vanguard FTSE All-World UCITS ETF USD Acc;IE00BK5BQT80;9,12;EUR;0,063282;166,08;USD;08.10.25;1,154929;9,1;0;0;0;0;0;;;;0;0;0,02;0,02;0;0;;Steuereinbehalt direkt am Umsatz;0",
  "99000000000;10;0400060397/06032026;09.03.26;Verkauf;Verkauf;DWS Top Dividende LD;DE0009848119;1.545,03;EUR;-9,631951;166,03;EUR;09.03.26;;1.599,19;0;0;0;0;0;;;;0;0;0;0;54,16;54,16;;Steuereinbehalt direkt am Umsatz;0",
  "99000000000;10;0400182326/30052025;02.06.25;Ansparplan;;DWS Top Dividende LD;DE0009848119;40;EUR;0,264866;151,02;EUR;02.06.25;;40;1,9;0;0;0;0;;;;0;0;0;0;0;0;;Steuereinbehalt direkt am Umsatz;0",
  "99000000000;10;0400221494/05122025;08.12.25;Wiederanlage Fondsertrag;;DWS Top Dividende LD;DE0009848119;47,9;EUR;0,32023;149,58;EUR;08.12.25;;47,9;0;0;0;0;0;;;;0;0;0;0;0;0;;Steuereinbehalt direkt am Umsatz;0",
  "99000000000;26;0400331797/05012026;07.01.26;Entgeltbelastung Verkauf;Verkauf;Vanguard FTSE All-World UCITS ETF USD Acc;IE00BK5BQT80;0;EUR;-0,082514;172,88;USD;06.01.26;1,176014;12,13;0;0;0;0;0;;;;0;0;12;12;0,13;0,13;;Steuereinbehalt direkt am Umsatz;0",
  "99000000000;27;0400067527/13082025;18.08.25;Fondsumschichtung (Zugang);;Vanguard FTSE All-World UCITS ETF USD Acc;IE00BK5BQT80;4,9;EUR;0,035881;158,32;USD;14.08.25;1,161688;4,89;0;0;0;0;0;;;;0;0;0,01;0,01;0;0;;Steuereinbehalt direkt am Umsatz;0",
  "99000000000;16;0400067527/13082025;18.08.25;Fondsumschichtung (Abgang);Verkauf;Vontobel Fund - Global Equity A-USD;LU0218910023;4,9;EUR;-0,012359;465,93;USD;14.08.25;1,175712;4,9;0;0;0;0;0;;;;0;0;0;0;0;0;;Steuereinbehalt direkt am Umsatz;0",
  "99000000000;27;0400363302/02102025;06.10.25;Interner Übertrag (Abgang);Übertrag der Anteile;Vanguard FTSE All-World UCITS ETF USD Acc;IE00BK5BQT80;0;EUR;-0,049516;165,36;USD;02.10.25;1,1664;0;0;0;7,02;0;0;;;;0;0;0;0;0;0;;Steuereinbehalt direkt am Umsatz;0",
  "99000000000;10;0400000000/01012026;02.01.26;Entgeltbelastung;;DWS Top Dividende LD;DE0009848119;-12;EUR;0;;EUR;02.01.26;;0;0;0;0;0;0;;;;0;0;12;12;0;0;;Steuereinbehalt direkt am Umsatz;0",
  "99000000000;10;0400999999/01022026;03.02.26;Entgeltbelastung Verkauf;Verkauf;DWS Top Dividende LD;DE0009848119;0;EUR;-0,01;;EUR;03.02.26;;0;0;0;0;0;0;;;;0;0;5;5;0;0;;Steuereinbehalt direkt am Umsatz;0",
].join("\n");

// Real Deutsche Bank PrivatDepot Umsätze excerpt (Depot-/Konto-Nr. anonymized),
// BOM-prefixed like the real export. "Nominal / Stück" is signed; "Kurs" is
// blank on cash rows. The last Kauf row is a variant of a real row with Kurs
// blanked to exercise the derived-price path (|Ausmachender Betrag| / |Stück|).
const DB_TX = "\uFEFF" + [
  "Buchungsdatum;Schlusstag / Zahltag;Valuta;Depot-Nr.;Konto-Nr.;Umsatzart;Nominal / Stück;Bezeichnung;WKN;ISIN;Handelswährung;Kurs;Devisenkurs;Stückzinsen;Kapitalertragssteuer inkl. Solidaritätszuschlag;Ausländische Quellensteuer;Vergütete Steuern;Transaktionspreis inkl. sonstiger Kosten;Eigene Spesen;Fremde Spesen;Ausmachender Betrag;Depot-/Portfolioname",
  "2026-05-12;2026-05-12;2026-05-15;310 0000000 00;310 0000000 01 (EUR);Kauf;400,00;SISF EURO CORP.BD ADEOSF FUNDS;A0RMZQ;LU0425487740;EUR;15,40;1,00;0,00;0,00;;;0,00;0,00;0,00;-6.160,64;PrivatDepot Comfort",
  "2026-05-12;2026-05-12;2026-05-15;310 0000000 00;310 0000000 01 (EUR);Verkauf;-17,00;AGIF-A.GL.ART.INTEL.A EO FUNDS;A2DKAR;LU1548497186;EUR;364,22;1,00;0,00;-160,38;;;0,00;0,00;0,00;6.031,36;PrivatDepot Comfort",
  "2025-01-21;2025-01-21;2025-01-23;310 0000000 00;310 0000000 00 (EUR);Zeichnung;100,00;EXPRESS Z 23.01.30 RUSSELL (DT.BANK)GK.23.01.26;DB2FTD;XS0460099756;USD;101,50;1,04;0,00;0,00;;;0,00;0,00;0,00;-9.721,76;PrivatDepot Comfort",
  "2026-07-01;;2026-07-01;310 0000000 00;310 0000000 01 (EUR);Dividende/Ausschüttung;754,00;VAN.-L.40EQ ETF EOD FUNDS;A2P7TL;IE00BMVB5N38;EUR;;1,00;;-66,14;0,00;0,00;;0,00;0,00;228,93;PrivatDepot Comfort",
  "2026-01-28;2026-01-28;2026-01-28;310 0000000 00;310 0000000 01 (EUR);Kapitalrückzahlung;-100,00;EXPRESS Z28.01.30 SX7E (BNP PARIBAS)GK.28.01.26;PC99BR;DE000PC99BR3;EUR;108,55;1,00;0,00;0,00;;;0,00;0,00;0,00;10.855,00;PrivatDepot Comfort",
  "2026-05-04;2026-05-04;2026-05-06;310 0000000 00;310 0000000 01 (EUR);Kauf;400,00;SISF EURO CORP.BD ADEOSF FUNDS;A0RMZQ;LU0425487740;EUR;;1,00;0,00;0,00;;;0,00;0,00;0,00;-6.160,64;PrivatDepot Comfort",
].join("\n");

// Anonymized excerpt of a real Bitpanda transaction export. The six-line
// preamble (disclaimer, name+birthdate, email, account-opened, venue) is
// reproduced with the two PII lines replaced by placeholders — the real
// header only appears on line 6, which is exactly what forces detectFormat
// to scan rather than assume line 0. Rows: a crypto deposit whose fee is
// denominated in the asset itself (BTC, not EUR), a crypto buy with a plain
// EUR fee, a crypto sell, a gold buy (Metal asset class), and a Fiat deposit
// + withdrawal pair (pure cash movements with no asset amount).
const BITPANDA = [
  '"Disclaimer: All data is without guarantee, errors and changes are reserved."',
  '"Anon User, 1900-01-01"',
  "anon@example.com",
  '"Account opened at: 2024-02-29T12:14:38+01:00"',
  '"Venue: Bitpanda"',
  '"Transaction ID",Timestamp,"Transaction Type",In/Out,"Amount Fiat",Fiat,"Amount Asset",Asset,"Asset market price","Asset market price currency","Asset class","Product ID",Fee,"Fee asset","Fee percent",Spread,"Spread Currency","Tax Fiat"',
  "C1,2025-05-05T09:22:18+02:00,deposit,incoming,15.03,EUR,0.00017939,BTC,83770.76,EUR,Cryptocurrency,1,0.00006000,BTC,-,-,-,-",
  "T1,2025-05-31T08:20:41+02:00,buy,outgoing,25.00,EUR,0.00026887,BTC,92981.74,EUR,Cryptocurrency,1,0.25000000,EUR,0.99,-,-,0.00",
  "T2,2025-05-05T10:04:41+02:00,sell,incoming,355.74,EUR,0.00430285,BTC,82675.44,EUR,Cryptocurrency,1,3.51000000,EUR,0.99,-,-,0.00",
  "T3,2025-12-05T09:07:15+01:00,buy,outgoing,25.00,EUR,0.21283109,Gold,117.46,EUR,Metal,28,-,-,-,-,-,0.00",
  "F1,2025-05-22T07:46:00+02:00,deposit,incoming,20.00,EUR,-,EUR,-,-,Fiat,-,0.00000000,EUR,-,-,-,0.00",
  "F2,2025-05-05T17:50:09+02:00,withdrawal,outgoing,355.74,EUR,-,EUR,-,-,Fiat,-,0.00000000,EUR,-,-,-,0.00",
].join("\n");

// Minimal FinTrack self-export sample (see lib/export/export.ts), used to
// exercise detectFormat and the parser without going through a full
// PortfolioData round trip.
const FINTRACK_SAMPLE = [
  "# FinTrack export: base currency EUR",
  "# Assets",
  "id,name,type,isin,wkn,symbol,currency,notes",
  "a1,Apple,STOCK,US0378331005,,,USD,",
  "",
  "# Transactions",
  "id,date,asset,isin,type,quantity,price,fee,tax",
  "t1,2024-01-15T10:30:00,Apple,US0378331005,BUY,2,150,1,0",
  "t2,2024-01-20T10:30:00,Apple,US0378331005,DIVIDEND,1,150,0,0",
  "",
].join("\n");

describe("csv detectFormat", () => {
  it("identifies each broker", () => {
    expect(detectFormat(ZERO)).toBe("zeroorders");
    expect(detectFormat(FNZ)).toBe("fnz");
    expect(detectFormat(TR)).toBe("traderepublic");
    expect(detectFormat(DB)).toBe("deutschebank");
    expect(detectFormat(DB_TX)).toBe("dbtransactions"); // despite the BOM
    expect(detectFormat(BITPANDA)).toBe("bitpanda"); // header on line 6, not 0
    expect(detectFormat(FINTRACK_SAMPLE)).toBe("fintrack");
    expect(detectFormat("a,b,c\n1,2,3")).toBeNull();
  });
});

describe("csv parsers", () => {
  it("zeroorders: only executed orders, comma decimals", () => {
    const { rows, skipped } = parseCsv(ZERO);
    expect(rows).toHaveLength(1); // the cancelled order is dropped
    expect(skipped).toBe(1); // ...and counted, not silently discarded
    expect(rows[0]).toMatchObject({
      isin: "US0378331005",
      type: "BUY",
      quantity: 2,
      price: 230,
      fee: 1,
      date: "2025-03-03T09:30:00",
    });
  });

  it("zeroorders: direction from Richtung, date from execution not creation", () => {
    const { format, rows, skipped, invalid } = parseCsv(ZERO_ORDERS);
    expect(format).toBe("zeroorders");
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(1); // the gestrichen GameStop order
    expect(invalid).toBe(0);
    const [buy, sell] = rows;
    expect(buy).toMatchObject({
      type: "BUY",
      quantity: 2,
      price: 230,
      date: "2025-03-03T09:30:00", // Ausführung Datum/Zeit, not Erstellt
    });
    expect(sell).toMatchObject({
      type: "SELL",
      quantity: 1,
      price: 125,
      date: "2025-03-06T15:45:00", // Ausführung Datum/Zeit, not Erstellt
    });
  });

  it("fnz: VL contributions become BOOKING with EUR price", () => {
    const { rows } = parseCsv(FNZ);
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("BOOKING");
    expect(rows[0].isin).toBe("IE00BK5BQT80");
    expect(rows[0].quantity).toBeCloseTo(0.242496, 6);
    expect(rows[0].price).toBeCloseTo(40 / 0.242496, 2); // EUR paid / shares
    expect(rows[0].date).toBe("2026-06-01T00:00:00");
  });

  it("trade republic: skips cash rows, keeps trades", () => {
    const { rows } = parseCsv(TR);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      isin: "US00165C1045",
      type: "BUY",
      quantity: 5,
      price: 11.8,
      fee: 1,
    });
    expect(rows[0].date.startsWith("2021-02-01T19:27:22")).toBe(true);
  });

  it("deutsche bank: snapshot → opening BUY at Einstandskurs", () => {
    const { rows } = parseCsv(DB);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      isin: "DE0008474156",
      type: "BUY",
      quantity: 22,
      price: 434.93909,
    });
  });

  it("fnz: every share-moving Umsatzart parses; signed Anteile sets direction", () => {
    const { rows, skipped, invalid } = parseCsv(FNZ_FULL);
    // 11 data rows: 10 move shares, 1 synthetic cash-only row is skipped. Of
    // the 10, two (Entgeltbelastung Verkauf, Interner Übertrag (Abgang)) book
    // a zero Zahlungsbetrag but both carry Abrechnungskurs + Devisenkurs, so
    // the settlement-price fallback resolves them; the last synthetic row
    // reproduces the same zero-Zahlungsbetrag Entgeltbelastung Verkauf but
    // without Abrechnungskurs either, so no fallback is possible and it's the
    // one still rejected by the validation guardrail.
    expect(rows).toHaveLength(9);
    expect(skipped).toBe(1);
    expect(invalid).toBe(1);
    // Every quantity is stored positive; direction lives in the type.
    for (const r of rows) expect(r.quantity).toBeGreaterThan(0);
    const [vl, kauf, verkauf, plan, wieder, entgeltVerkauf, umschZu, umschAb, uebertragAbgang] = rows;
    // VL contribution and plan credits (Ansparplan, Wiederanlage) → BOOKING.
    expect(vl).toMatchObject({ type: "BOOKING", isin: "IE00BK5BQT80" });
    expect(vl.quantity).toBeCloseTo(0.242496, 6);
    expect(vl.price).toBeCloseTo(40 / 0.242496, 2);
    expect(vl.date).toBe("2026-06-01T00:00:00");
    expect(plan.type).toBe("BOOKING");
    expect(plan.quantity).toBeCloseTo(0.264866, 6);
    expect(plan.price).toBeCloseTo(40 / 0.264866, 2);
    expect(wieder.type).toBe("BOOKING");
    expect(wieder.quantity).toBeCloseTo(0.32023, 6);
    // Plain Kauf → BUY.
    expect(kauf.type).toBe("BUY");
    expect(kauf.quantity).toBeCloseTo(0.063282, 6);
    expect(kauf.price).toBeCloseTo(9.12 / 0.063282, 2);
    // Verkauf: negative Anteile → SELL with positive quantity.
    expect(verkauf).toMatchObject({ type: "SELL", isin: "DE0009848119" });
    expect(verkauf.quantity).toBeCloseTo(9.631951, 6);
    expect(verkauf.price).toBeCloseTo(1545.03 / 9.631951, 2);
    expect(verkauf.date).toBe("2026-03-09T00:00:00");
    // Entgeltbelastung Verkauf: zero Zahlungsbetrag → settlement-price
    // fallback (Abrechnungskurs in FW ÷ Devisenkurs (ZW/FW)).
    expect(entgeltVerkauf).toMatchObject({ type: "SELL", isin: "IE00BK5BQT80" });
    expect(entgeltVerkauf.quantity).toBeCloseTo(0.082514, 6);
    expect(entgeltVerkauf.price).toBeCloseTo(172.88 / 1.176014, 2);
    // Fondsumschichtung: Zugang → BUY, Abgang → SELL.
    expect(umschZu.type).toBe("BUY");
    expect(umschAb.type).toBe("SELL");
    // Interner Übertrag (Abgang): same zero-Zahlungsbetrag fallback path.
    expect(uebertragAbgang).toMatchObject({ type: "SELL", isin: "IE00BK5BQT80" });
    expect(uebertragAbgang.quantity).toBeCloseTo(0.049516, 6);
    expect(uebertragAbgang.price).toBeCloseTo(165.36 / 1.1664, 2);
  });

  it("deutsche bank transactions: BOM stripped, trades parse, cash rows skipped", () => {
    const { format, rows, skipped, invalid } = parseCsv(DB_TX);
    expect(format).toBe("dbtransactions");
    // 6 data rows: Kauf + Verkauf + Zeichnung + derived-price Kauf parse;
    // Dividende/Ausschüttung and Kapitalrückzahlung are cash-only → skipped.
    expect(rows).toHaveLength(4);
    expect(skipped).toBe(2);
    expect(invalid).toBe(0);
    const [kauf, verkauf, zeichnung, derived] = rows;
    expect(kauf).toMatchObject({
      isin: "LU0425487740",
      wkn: "A0RMZQ",
      type: "BUY",
      quantity: 400,
      price: 15.4,
      currency: "EUR",
      date: "2026-05-12T00:00:00",
    });
    // Signed Nominal / Stück: -17 → SELL with positive quantity.
    expect(verkauf).toMatchObject({ isin: "LU1548497186", type: "SELL", quantity: 17, price: 364.22 });
    // Zeichnung (subscription) is a BUY; native currency preserved.
    expect(zeichnung).toMatchObject({ isin: "XS0460099756", type: "BUY", quantity: 100, price: 101.5, currency: "USD" });
    // Kurs blank on a trade → price derived from |Ausmachender Betrag| / |Stück|.
    expect(derived.type).toBe("BUY");
    expect(derived.price).toBeCloseTo(6160.64 / 400, 4);
  });

  it("bitpanda: fiat rows skipped, crypto/gold rows mapped with fee conversion", () => {
    const { format, rows, skipped, invalid } = parseCsv(BITPANDA);
    expect(format).toBe("bitpanda");
    expect(rows).toHaveLength(4); // deposit, buy, sell (BTC) + buy (Gold)
    expect(skipped).toBe(2); // the Fiat deposit + withdrawal
    expect(invalid).toBe(0);
    const byType = { BUY: 0, SELL: 0, BOOKING: 0, INTEREST: 0 };
    for (const r of rows) byType[r.type]++;
    expect(byType).toEqual({ BUY: 3, SELL: 1, BOOKING: 0, INTEREST: 0 });

    const [deposit, buy, sell, gold] = rows;
    // Deposit: fee is denominated in BTC itself (the row's own asset) →
    // converted to fiat via the row's market price (0.00006 * 83770.76).
    expect(deposit).toMatchObject({ symbol: "BTC", assetType: "CRYPTO", type: "BUY" });
    expect(deposit.quantity).toBeCloseTo(0.00017939, 8);
    expect(deposit.price).toBeCloseTo(83770.76, 2);
    expect(deposit.fee).toBeCloseTo(0.00006 * 83770.76, 4);
    expect(deposit.date).toBe("2025-05-05T09:22:18");

    // Buy: plain EUR fee, used as-is.
    expect(buy).toMatchObject({ symbol: "BTC", assetType: "CRYPTO", type: "BUY", fee: 0.25 });
    expect(buy.quantity).toBeCloseTo(0.00026887, 8);
    expect(buy.price).toBeCloseTo(92981.74, 2);

    expect(sell).toMatchObject({ symbol: "BTC", assetType: "CRYPTO", type: "SELL", fee: 3.51 });

    // Gold: mapped to the catalog's XAU symbol, COMMODITY asset type, no
    // unit conversion (grams stay grams).
    expect(gold).toMatchObject({ symbol: "XAU", name: "Gold", assetType: "COMMODITY", type: "BUY", fee: 0 });
    expect(gold.quantity).toBeCloseTo(0.21283109, 8);
    expect(gold.price).toBeCloseTo(117.46, 2);
  });
});

// Full real broker exports sitting (uncommitted) in the repo root. These run
// only on machines that have the files; CI without them skips gracefully.
describe("csv parsers — full real exports", () => {
  const fnzPath = join(__dirname, "..", "Umsatzdaten_99134053488.csv");
  const dbTxPath = join(__dirname, "..", "Umsaetze_20260702_161243.csv");
  const zeroOrdersPath = join(__dirname, "..", "ZERO-orders-29.06.2026.csv");
  const bitpandaPath = join(__dirname, "..", "bitpanda_export_1783021441399.csv");

  it.skipIf(!existsSync(fnzPath))("fnz: all 382 share-moving rows import", () => {
    // The export is Windows-1252; the app's file reader decodes it the same way.
    const text = new TextDecoder("windows-1252").decode(readFileSync(fnzPath));
    const { format, rows, skipped, invalid } = parseCsv(text);
    expect(format).toBe("fnz");
    // Every one of the 382 data rows moves shares — none are cash-only. 18 of
    // them book a zero "Zahlungsbetrag in ZW" (fee-covering Entgeltbelastung
    // Verkauf sells and an in-kind Übertrag pair) but all 18 carry an
    // Abrechnungskurs + Devisenkurs, so the settlement-price fallback
    // resolves every one of them — none are rejected as invalid.
    expect(rows.length + skipped + invalid).toBe(382);
    expect(skipped).toBe(0);
    expect(invalid).toBe(0);
    expect(rows).toHaveLength(382);
    // Verified distribution: BOOKING = 9 VL + 134 Ansparplan + 34
    // Wiederanlage, SELL = 159 Verkauf + 18 fee/transfer legs (settlement-
    // price fallback) + 2 Umschichtung-Abgang, BUY = 22 Kauf + 2
    // Umschichtung-Zugang + 2 Übertrag-Zugang.
    const byType = { BUY: 0, SELL: 0, BOOKING: 0, INTEREST: 0 };
    for (const r of rows) {
      byType[r.type]++;
      expect(r.quantity).toBeGreaterThan(0);
      expect(r.price).toBeGreaterThan(0);
      expect(r.isin).toBeTruthy();
    }
    expect(byType).toEqual({ BUY: 26, SELL: 179, BOOKING: 177, INTEREST: 0 });
  });

  it.skipIf(!existsSync(zeroOrdersPath))(
    "zeroorders: real export — 119 executed orders (88 buy, 31 sell), 38 skipped",
    () => {
      // BOM-prefixed UTF-8, like the app's file reader decodes it.
      const text = new TextDecoder("utf-8").decode(readFileSync(zeroOrdersPath));
      const { format, rows, skipped, invalid } = parseCsv(text);
      expect(format).toBe("zeroorders");
      // 157 data rows: 119 with Status "ausgeführt" become transactions (88
      // Kauf, 31 Verkauf); the rest (gestrichen/abgelaufen/zurückgewiesen)
      // are recognised non-transactions, counted as skipped not invalid.
      expect(rows.length + skipped + invalid).toBe(157);
      expect(skipped).toBe(38);
      expect(invalid).toBe(0);
      expect(rows).toHaveLength(119);
      const byType = { BUY: 0, SELL: 0, BOOKING: 0, INTEREST: 0 };
      for (const r of rows) {
        byType[r.type]++;
        expect(r.quantity).toBeGreaterThan(0);
        expect(r.price).toBeGreaterThan(0);
        expect(r.isin || r.wkn).toBeTruthy();
      }
      expect(byType).toEqual({ BUY: 88, SELL: 31, BOOKING: 0, INTEREST: 0 });
    },
  );

  it.skipIf(!existsSync(dbTxPath))("deutsche bank transactions: 28 trades, 22 cash rows", () => {
    const text = readFileSync(dbTxPath, "utf8"); // keeps the BOM, like the app
    const { format, rows, skipped, invalid } = parseCsv(text);
    expect(format).toBe("dbtransactions");
    // 50 data rows: 24 Kauf + 2 Verkauf + 2 Zeichnung = 28 trades;
    // 20 Dividende/Ausschüttung + 2 Kapitalrückzahlung = 22 cash rows. Every
    // trade row carries a usable ISIN/WKN, date, quantity and price, so the
    // guardrail rejects none of them.
    expect(rows.length + skipped + invalid).toBe(50);
    expect(rows).toHaveLength(28);
    expect(skipped).toBe(22);
    expect(invalid).toBe(0);
    const byType = { BUY: 0, SELL: 0, BOOKING: 0, INTEREST: 0 };
    for (const r of rows) {
      byType[r.type]++;
      expect(r.quantity).toBeGreaterThan(0);
      expect(r.price).toBeGreaterThan(0);
      expect(r.isin).toBeTruthy();
    }
    expect(byType).toEqual({ BUY: 26, SELL: 2, BOOKING: 0, INTEREST: 0 });
  });

  it.skipIf(!existsSync(bitpandaPath))(
    "bitpanda: real export — 24 valid (23 buy, 1 sell), 22 fiat rows skipped",
    () => {
      const text = readFileSync(bitpandaPath, "utf8");
      const { format, rows, skipped, invalid } = parseCsv(text);
      expect(format).toBe("bitpanda");
      // 46 data rows: 22 Fiat deposit/withdrawal rows carry no asset amount
      // and are skipped; the remaining 24 are real crypto/gold trades, all
      // of which pass the validation guardrail (symbol-only identifier is
      // allowed for CRYPTO/COMMODITY).
      expect(rows.length + skipped + invalid).toBe(46);
      expect(skipped).toBe(22);
      expect(invalid).toBe(0);
      expect(rows).toHaveLength(24);
      const byType = { BUY: 0, SELL: 0, BOOKING: 0, INTEREST: 0 };
      const byAssetType: Record<string, number> = {};
      for (const r of rows) {
        byType[r.type]++;
        byAssetType[r.assetType] = (byAssetType[r.assetType] || 0) + 1;
        expect(r.quantity).toBeGreaterThan(0);
        expect(r.price).toBeGreaterThan(0);
        expect(r.symbol).toBeTruthy();
      }
      expect(byType).toEqual({ BUY: 23, SELL: 1, BOOKING: 0, INTEREST: 0 });
      // 3 Gold buys (COMMODITY) + 21 BTC trades (20 buy + 1 sell, CRYPTO).
      expect(byAssetType).toEqual({ COMMODITY: 3, CRYPTO: 21 });
    },
  );
});

describe("csv parsers — fintrack (self re-import)", () => {
  it("maps known transaction types 1:1 and skips+counts an unknown type", () => {
    const { format, rows, skipped, invalid } = parseCsv(FINTRACK_SAMPLE);
    expect(format).toBe("fintrack");
    expect(rows).toHaveLength(1); // the DIVIDEND row is unrecognised
    expect(skipped).toBe(1);
    expect(invalid).toBe(0);
    expect(rows[0]).toMatchObject({
      isin: "US0378331005",
      name: "Apple",
      type: "BUY",
      quantity: 2,
      price: 150,
      fee: 1,
      tax: 0,
      currency: "USD",
      assetType: "STOCK",
      date: "2024-01-15T10:30:00",
    });
  });

  it("round-trips a PortfolioData through portfolioToCsv and back", () => {
    const assets: Asset[] = [
      {
        id: "a1",
        isin: "US0378331005",
        wkn: null,
        symbol: null,
        name: "Apple Inc.",
        type: "STOCK",
        currency: "USD",
        notes: null,
      },
      {
        id: "a2",
        isin: "IE00BK5BQT80",
        wkn: null,
        symbol: null,
        // Comma in the name exercises RFC 4180 quoting on export + parsing.
        name: "Vanguard, FTSE All-World UCITS ETF",
        type: "ETF",
        currency: "EUR",
        notes: null,
      },
      {
        id: "a3",
        isin: null,
        wkn: null,
        symbol: "BTC",
        name: "Bitcoin",
        type: "CRYPTO",
        currency: "EUR",
        notes: null,
      },
    ];
    const transactions: Transaction[] = [
      {
        id: "t1",
        assetId: "a1",
        portfolioId: "p1",
        type: "BUY",
        quantity: 2,
        price: 150,
        fee: 1,
        tax: 0,
        date: "2024-01-15T10:30:00",
      },
      {
        id: "t2",
        assetId: "a1",
        portfolioId: "p1",
        type: "SELL",
        quantity: 1,
        price: 160,
        fee: 0.5,
        tax: 2,
        date: "2024-02-20T09:00:00",
      },
      {
        id: "t3",
        assetId: "a2",
        portfolioId: "p1",
        type: "BUY",
        quantity: 5,
        price: 100,
        fee: 0,
        tax: 0,
        date: "2024-03-01T00:00:00",
      },
      {
        id: "t4",
        assetId: "a3",
        portfolioId: "p1",
        type: "BUY",
        quantity: 0.01,
        price: 50000,
        fee: 5,
        tax: 0,
        date: "2024-04-10T12:00:00",
      },
    ];
    const data: PortfolioData = {
      profile: { currency: "EUR", name: null, locale: null },
      portfolios: [{ id: "p1", name: "Main" }],
      assets,
      transactions,
      watchlist: [],
      savingsPlans: [],
    };

    const csv = portfolioToCsv(data);
    const { format, rows, skipped, invalid } = parseCsv(csv);
    expect(format).toBe("fintrack");
    expect(skipped).toBe(0);
    expect(invalid).toBe(0);
    expect(rows).toHaveLength(4);

    // portfolioToCsv sorts transactions by date ascending, which already
    // matches the order they were declared in above.
    for (let i = 0; i < transactions.length; i++) {
      const original = transactions[i];
      const asset = assets.find((a) => a.id === original.assetId)!;
      expect(rows[i]).toMatchObject({
        date: original.date,
        type: original.type,
        quantity: original.quantity,
        price: original.price,
        fee: original.fee,
        tax: original.tax,
        assetType: asset.type,
      });
      expect(rows[i].isin).toBe(asset.isin);
      expect(rows[i].symbol).toBe(asset.symbol);
    }
  });
});

describe("reconcile", () => {
  const asset: Asset = {
    id: "a1",
    isin: "US0378331005",
    wkn: "865985",
    symbol: null,
    name: "Apple",
    type: "STOCK",
    currency: "EUR",
    notes: null,
  };
  const existing: Transaction = {
    id: "t1",
    assetId: "a1",
    portfolioId: "p1",
    type: "BUY",
    quantity: 2,
    price: 230,
    fee: 1,
    tax: 0,
    date: "2025-03-03T09:30:00",
  };

  it("fuzzy-matches a near-identical row as a conflict, ignoring time", () => {
    const { rows } = parseCsv(
      [
        "Name;ISIN;WKN;Anzahl;Anzahl storniert;Status;Orderart;Limit;Stop;Erstellt Datum;Erstellt Zeit;Gültig bis;Richtung;Wert;Wert storniert;Mindermengenzuschlag;Ausführung Datum;Ausführung Zeit;Ausführung Kurs;Anzahl ausgeführt;Anzahl offen;Gestrichen Datum;Gestrichen Zeit",
        // slightly different time + price 230.20 vs 230 → still a conflict
        "Apple;US0378331005;865985;2;;ausgeführt;Market;;;01.03.2025;10:00:00;;Kauf;-460,40;;1,00;03.03.2025;14:00:00;230,20;2;0;;",
      ].join("\n"),
    );
    const rec = reconcile(rows, [asset], [existing], new Set());
    expect(rec[0].status).toBe("conflict");
    expect(rec[0].existing?.id).toBe("t1");
  });

  it("marks a row as imported when its fingerprint was recorded", () => {
    const { rows } = parseCsv(ZERO);
    const fp = fingerprint(rows[0]);
    const rec = reconcile(rows, [], [], new Set([fp]));
    expect(rec[0].status).toBe("imported");
  });

  it("marks an unseen row as new", () => {
    const { rows } = parseCsv(TR);
    const rec = reconcile(rows, [], [], new Set());
    expect(rec[0].status).toBe("new");
  });
});

describe("import validation guardrail (isValidTx)", () => {
  // A row satisfying every criterion — each test below breaks exactly one.
  const valid: ParsedTx = {
    isin: "US0378331005",
    wkn: null,
    symbol: null,
    name: "Apple",
    type: "BUY",
    quantity: 2,
    price: 230,
    fee: 1,
    tax: 0,
    date: "2025-03-03T09:30:00",
    currency: "EUR",
    assetType: "STOCK",
  };

  it("accepts a fully valid row", () => {
    expect(isValidTx(valid)).toBe(true);
  });

  it("rejects a row with neither ISIN nor WKN — a bare symbol is not enough, unless it's crypto", () => {
    expect(isValidTx({ ...valid, isin: null, wkn: null, symbol: "AAPL" })).toBe(false);
    // WKN alone (no ISIN) does satisfy the guardrail.
    expect(isValidTx({ ...valid, isin: null, wkn: "865985" })).toBe(true);
    // Crypto has no ISIN/WKN by nature — a bare symbol is enough for it.
    expect(
      isValidTx({ ...valid, isin: null, wkn: null, symbol: "BTC", assetType: "CRYPTO" }),
    ).toBe(true);
    // The relaxation is CRYPTO-specific: the same symbol-only row with any
    // other assetType still fails.
    expect(
      isValidTx({ ...valid, isin: null, wkn: null, symbol: "BTC", assetType: "STOCK" }),
    ).toBe(false);
  });

  it("rejects a row with an empty or unparseable date", () => {
    expect(isValidTx({ ...valid, date: "" })).toBe(false);
    expect(isValidTx({ ...valid, date: "not-a-date" })).toBe(false);
    expect(isValidTx({ ...valid, date: "03.03.2025" })).toBe(false); // not ISO
  });

  it("rejects a row with a non-positive or non-finite quantity", () => {
    expect(isValidTx({ ...valid, quantity: 0 })).toBe(false);
    expect(isValidTx({ ...valid, quantity: -2 })).toBe(false);
    expect(isValidTx({ ...valid, quantity: NaN })).toBe(false);
    expect(isValidTx({ ...valid, quantity: Infinity })).toBe(false);
  });

  it("rejects a row with a non-positive or non-finite price", () => {
    expect(isValidTx({ ...valid, price: 0 })).toBe(false);
    expect(isValidTx({ ...valid, price: -230 })).toBe(false);
    expect(isValidTx({ ...valid, price: NaN })).toBe(false);
    expect(isValidTx({ ...valid, price: Infinity })).toBe(false);
  });

  it("parseCsv rejects and counts invalid rows while valid siblings still import", () => {
    // Generic (unrecognised-broker) header-driven parse: one fully valid row,
    // one with only a symbol (no ISIN/WKN) and one with a blank date column.
    // The generic parser has no type column here, so it infers STOCK/ETF from
    // the name (never CRYPTO) — the symbol-only "Bitcoin" row therefore stays
    // invalid too, demonstrating the CRYPTO relaxation is CRYPTO-specific,
    // not a blanket "symbol is enough" rule.
    const generic = [
      "date,isin,symbol,name,type,shares,price",
      "2025-01-01,US0378331005,,Apple,BUY,2,150",
      "2025-01-02,,BTC,Bitcoin,BUY,1,50000",
      ",US0378331005,,Apple,BUY,1,150",
    ].join("\n");
    const { rows, invalid } = parseCsv(generic);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ isin: "US0378331005", name: "Apple", quantity: 2, price: 150 });
    expect(invalid).toBe(2);
  });
});
