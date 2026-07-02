import { describe, expect, it } from "vitest";
import { parseCsv, detectFormat, fingerprint } from "../lib/import/csv";
import { reconcile } from "../lib/import/reconcile";
import type { Asset, Transaction } from "../lib/types";

const ZERO = [
  "Name;ISIN;WKN;Anzahl;Anzahl storniert;Status;Orderart;Limit;Stop;Erstellt Datum;Erstellt Zeit;Gültig bis;Richtung;Wert;Wert storniert;Mindermengenzuschlag;Ausführung Datum;Ausführung Zeit;Ausführung Kurs;Anzahl ausgeführt;Anzahl offen;Gestrichen Datum;Gestrichen Zeit",
  "Apple;US0378331005;865985;2;;ausgeführt;Market;;;01.03.2025;10:00:00;;Kauf;-460,00;;1,00;03.03.2025;09:30:00;230,00;2;0;;",
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

describe("csv detectFormat", () => {
  it("identifies each broker", () => {
    expect(detectFormat(ZERO)).toBe("zero");
    expect(detectFormat(FNZ)).toBe("fnz");
    expect(detectFormat(TR)).toBe("traderepublic");
    expect(detectFormat(DB)).toBe("deutschebank");
    expect(detectFormat("a,b,c\n1,2,3")).toBeNull();
  });
});

describe("csv parsers", () => {
  it("zero: only executed orders, comma decimals", () => {
    const { rows } = parseCsv(ZERO);
    expect(rows).toHaveLength(1); // the cancelled order is dropped
    expect(rows[0]).toMatchObject({
      isin: "US0378331005",
      type: "BUY",
      quantity: 2,
      price: 230,
      fee: 1,
      date: "2025-03-03T09:30:00",
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
