// Broker CSV transaction parsing. Five German broker exports are supported,
// plus FinTrack's own CSV export (lib/export/export.ts) so a downloaded
// portfolio can be re-imported elsewhere; the format is auto-detected from
// the header. Everything runs in the browser — the CSV never leaves the
// device. No cash logic yet: pure deposits/withdrawals and non-trade rows are
// dropped (and, for formats that can tell them apart from real trades,
// counted in `skipped`).

import type { AssetType, TransactionType } from "../types";

export interface ParsedTx {
  isin: string | null;
  wkn: string | null;
  symbol: string | null;
  name: string;
  type: TransactionType;
  quantity: number;
  price: number;
  fee: number;
  /** Tax withheld on the transaction (0 when the export has no tax column). */
  tax: number;
  /** ISO datetime, e.g. 2025-04-16T20:53:24. */
  date: string;
  currency: string;
  assetType: AssetType;
}

export type BrokerFormat =
  | "zeroorders"
  | "fnz"
  | "traderepublic"
  | "deutschebank"
  | "dbtransactions"
  | "bitpanda"
  | "fintrack"
  | "portfolioperformance";

// --- helpers ----------------------------------------------------------------

/** Quote-aware split of a single CSV line. */
function splitLine(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (c === delim && !inQuotes) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function toLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim().length > 0);
}

/** German number: "." thousands, "," decimal. "2.407,48" → 2407.48. */
function deNum(s: string): number {
  const cleaned = (s ?? "").trim().replace(/\./g, "").replace(",", ".");
  if (cleaned === "" || cleaned === "-") return NaN;
  return parseFloat(cleaned);
}

/** "dd.mm.yyyy" or "dd.mm.yy" (+ optional "HH:mm:ss") → ISO datetime. */
function deDate(d: string, time?: string): string {
  const m = d.trim().match(/^(\d{2})\.(\d{2})\.(\d{2,4})$/);
  if (!m) return d;
  const [, dd, mm, yRaw] = m;
  const yyyy = yRaw.length === 2 ? `20${yRaw}` : yRaw;
  const t = time && /^\d{2}:\d{2}/.test(time.trim()) ? time.trim() : "00:00:00";
  const tt = t.length === 5 ? `${t}:00` : t;
  return `${yyyy}-${mm}-${dd}T${tt}`;
}

/** "2021-02-01T19:27:22.290Z" or "2021-02-01" → local ISO datetime (no zone). */
function isoDate(dt: string, dateOnly: string): string {
  const day = (dateOnly || dt).slice(0, 10);
  const tm = dt.match(/T(\d{2}:\d{2}:\d{2})/);
  return `${day}T${tm ? tm[1] : "00:00:00"}`;
}

const idx = (header: string[], name: string) =>
  header.findIndex((h) => h.toLowerCase().includes(name.toLowerCase()));

/** Exact (trimmed) column match — for headers with ambiguous substrings such as
 *  "Einstandskurs" vs "Hinweis Einstandskurs" / "Deviseneinstandskurs". */
const idxExact = (header: string[], name: string) =>
  header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase());

// --- format detection -------------------------------------------------------

export function detectFormat(text: string): BrokerFormat | null {
  const first = toLines(text)[0] ?? "";
  const h = first.toLowerCase();
  if (h.includes("datetime") && h.includes("asset_class")) return "traderepublic";
  if (h.includes("depotnummer") && h.includes("umsatzart")) return "fnz";
  if (h.includes("richtung") && h.includes("ausführung kurs") && h.includes("anzahl ausgeführt")) {
    return "zeroorders";
  }
  if (h.includes("bestand") && h.includes("einstandskurs")) return "deutschebank";
  // FinTrack's own export (lib/export/export.ts): a single marker line "#
  // FinTrack export: ...". Scanned across the first few lines like the
  // Bitpanda preamble below, for robustness, even though today it's always
  // line 0.
  if (toLines(text).slice(0, 3).join("\n").toLowerCase().includes("# fintrack export")) {
    return "fintrack";
  }
  // Deutsche Bank "PrivatDepot" transaction export (distinct from the
  // Bestandsaufstellung snapshot above): a real Umsatzart-keyed history.
  if (h.includes("umsatzart") && h.includes("ausmachender betrag")) return "dbtransactions";
  // Portfolio Performance (github.com/portfolio-performance/portfolio) CSV
  // transaction export ("File > Export > CSV", account or portfolio — both
  // write the identical header via CSVExporter#writeHeader). Column labels
  // follow the running UI's language (German or English; other UI languages
  // fall through to the generic parser below). "WKN" plus the German
  // hyphenated "Ticker-Symbol"/"Buchungswährung" pair, or the English
  // "Ticker Symbol"/"Transaction Currency" pair, is unique to this export
  // among the formats above.
  if (
    h.includes("wkn") &&
    ((h.includes("ticker-symbol") && h.includes("buchungswährung")) ||
      (h.includes("ticker symbol") && h.includes("transaction currency")))
  ) {
    return "portfolioperformance";
  }
  // Bitpanda export: a personal-data preamble (name, email, account info,
  // venue) precedes the real header, so the signature is scanned across the
  // first several lines rather than assumed to be line 0.
  const preamble = toLines(text).slice(0, 8).join("\n").toLowerCase();
  if (
    (preamble.includes("transaction id") && preamble.includes("asset market price")) ||
    preamble.includes("venue: bitpanda")
  ) {
    return "bitpanda";
  }
  return null;
}

// --- parsers ----------------------------------------------------------------

function assetTypeFromClass(s: string): AssetType {
  const t = (s || "").toLowerCase();
  if (t.includes("crypto")) return "CRYPTO";
  if (t.includes("metal")) return "COMMODITY";
  if (t.includes("stock") || t.includes("aktie")) return "STOCK";
  return "ETF";
}

/** Guess ETF vs STOCK from the instrument name — used by parsers whose export
 *  carries no reliable type/Gattung column of its own. */
function inferAssetType(name: string): "ETF" | "STOCK" {
  return /\bETF\b|UCITS|Fonds|Fund/i.test(name || "") ? "ETF" : "STOCK";
}

/**
 * Scalable Capital "ZERO" order history export. Every row is an order
 * *attempt* — only the ones whose "Status" is "ausgeführt" (executed) ever
 * became a real trade; the rest (gestrichen/abgelaufen/zurückgewiesen) are
 * recognised non-transactions and counted as `skipped`, not invalid. Side
 * comes from "Richtung" (Kauf/Verkauf) — never from "Orderart" (Limit/
 * Market), which says nothing about direction and would otherwise silently
 * default every row to BUY, mis-importing real sells as buys.
 */
function parseZeroOrders(text: string): { rows: ParsedTx[]; skipped: number } {
  const lines = toLines(text);
  const header = splitLine(lines[0], ";");
  const c = {
    name: idx(header, "Name"),
    isin: idx(header, "ISIN"),
    wkn: idx(header, "WKN"),
    status: idx(header, "Status"),
    richtung: idx(header, "Richtung"),
    execDate: idx(header, "Ausführung Datum"),
    execTime: idx(header, "Ausführung Zeit"),
    execPrice: idx(header, "Ausführung Kurs"),
    execQty: idx(header, "Anzahl ausgeführt"),
    fee: idx(header, "Mindermengenzuschlag"),
    tax: idx(header, "Steuern"),
  };
  const out: ParsedTx[] = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const r = splitLine(lines[i], ";");
    if ((r[c.status] || "").trim().toLowerCase() !== "ausgeführt") {
      skipped++; // cancelled / expired / rejected order — never executed
      continue;
    }
    const name = r[c.name] || r[c.isin] || "";
    out.push({
      isin: r[c.isin] || null,
      wkn: r[c.wkn] || null,
      symbol: null,
      name,
      type: /verkauf/i.test(r[c.richtung]) ? "SELL" : "BUY",
      quantity: deNum(r[c.execQty]),
      price: deNum(r[c.execPrice]),
      fee: c.fee >= 0 ? Math.abs(deNum(r[c.fee])) || 0 : 0,
      tax: c.tax >= 0 ? Math.abs(deNum(r[c.tax])) || 0 : 0,
      date: deDate(r[c.execDate], r[c.execTime]),
      currency: "EUR",
      assetType: inferAssetType(name),
    });
  }
  return { rows: out, skipped };
}

/**
 * FNZ fund transaction export. "Anteile" (shares) is SIGNED — negative for
 * every share-reducing Umsatzart (Verkauf, Entgeltbelastung Verkauf, Verkauf
 * wegen Vorabpauschale, Fondsumschichtung (Abgang), Interner Übertrag
 * (Abgang), ...), positive for every share-adding one. Any row that actually
 * moves shares becomes a transaction; pure-cash rows (Anteile is zero/blank —
 * fees and cash-only entries with no unit movement) are skipped and counted.
 * "vermögenswirksame Leistungen" (employer VL contributions) and the
 * "Ansparplan" / "Wiederanlage Fondsertrag" Umsatzarten are cost-free
 * creditings → BOOKING; everything else follows the sign of Anteile.
 */
function parseFnz(text: string): { rows: ParsedTx[]; skipped: number } {
  const lines = toLines(text);
  const header = splitLine(lines[0], ";");
  const c = {
    date: idx(header, "Buchungsdatum"),
    art: idx(header, "Umsatzart"),
    teil: idx(header, "Teilumsatz"),
    fonds: idx(header, "Fonds"),
    isin: idx(header, "ISIN"),
    betrag: idx(header, "Zahlungsbetrag"),
    anteile: idx(header, "Anteile"),
    kurs: idx(header, "Abrechnungskurs"),
    // "Devisenkurs (ZW/FW)" — matched by the parenthesised pair alone because
    // real exports vary the spacing ("Devisenkurs  (ZW/FW)") and the header
    // also carries "Devisenkurs (ZW/EW)" and "Devisenkurs (EUR/ZW)" columns.
    fx: idx(header, "ZW/FW"),
  };
  const out: ParsedTx[] = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const r = splitLine(lines[i], ";");
    if (!r[c.isin]) continue;
    const shares = deNum(r[c.anteile]);
    if (!Number.isFinite(shares) || shares === 0) {
      skipped++; // pure-cash row: no unit movement (fee/tax/cash dividend)
      continue;
    }
    const amount = deNum(r[c.betrag]);
    const art = (r[c.art] || "").toLowerCase();
    // Employer VL contributions and cost-free plan creditings → BOOKING.
    const isVL = /verm.genswirksame/i.test(r[c.teil] ?? "");
    const isPlanCredit = art.includes("ansparplan") || art.includes("wiederanlage fondsertrag");
    // Primary price: the actually settled EUR value per share. Some rows book
    // a zero Zahlungsbetrag (fee-covering "Entgeltbelastung Verkauf" sells,
    // in-kind Übertrag legs) — fall back to the settlement price columns:
    // Abrechnungskurs in FW ÷ Devisenkurs (ZW/FW), or Abrechnungskurs alone
    // when the fund already trades in the payment currency (Devisenkurs blank).
    let price = Math.abs(amount) / Math.abs(shares);
    if (!Number.isFinite(price) || price === 0) {
      const kurs = c.kurs >= 0 ? deNum(r[c.kurs]) : NaN;
      const fx = c.fx >= 0 ? deNum(r[c.fx]) : NaN;
      if (Number.isFinite(kurs) && kurs > 0) {
        price = Number.isFinite(fx) && fx > 0 ? kurs / fx : kurs;
      }
    }
    out.push({
      isin: r[c.isin] || null,
      wkn: null,
      symbol: null,
      name: r[c.fonds] || r[c.isin] || "",
      type: isVL || isPlanCredit ? "BOOKING" : shares > 0 ? "BUY" : "SELL",
      quantity: Math.abs(shares),
      price,
      fee: 0,
      tax: 0,
      date: deDate(r[c.date]),
      currency: "EUR",
      assetType: "ETF",
    });
  }
  return { rows: out, skipped };
}

/** Trade Republic transaction export (comma-delimited, "." decimals). */
function parseTradeRepublic(text: string): ParsedTx[] {
  const lines = toLines(text);
  const header = splitLine(lines[0], ",");
  // Exact matches — the TR header has overlapping names (type/account_type,
  // date/datetime, name/counterparty_name) that substring matching confuses.
  const c = {
    dt: idxExact(header, "datetime"),
    date: idxExact(header, "date"),
    type: idxExact(header, "type"),
    assetClass: idxExact(header, "asset_class"),
    name: idxExact(header, "name"),
    symbol: idxExact(header, "symbol"),
    shares: idxExact(header, "shares"),
    price: idxExact(header, "price"),
    fee: idxExact(header, "fee"),
    tax: idxExact(header, "tax"),
    currency: idxExact(header, "currency"),
  };
  const out: ParsedTx[] = [];
  for (let i = 1; i < lines.length; i++) {
    const r = splitLine(lines[i], ",");
    const type = (r[c.type] || "").toUpperCase();
    if (type !== "BUY" && type !== "SELL") continue; // skip cash/other rows
    const shares = parseFloat(r[c.shares]);
    const price = parseFloat(r[c.price]);
    if (!(shares > 0) || !(price > 0)) continue;
    out.push({
      isin: /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(r[c.symbol]) ? r[c.symbol] : null,
      wkn: null,
      symbol: /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(r[c.symbol]) ? null : r[c.symbol] || null,
      name: r[c.name] || r[c.symbol] || "",
      type: type as TransactionType,
      quantity: shares,
      price,
      fee: Math.abs(parseFloat(r[c.fee]) || 0),
      tax: c.tax >= 0 ? Math.abs(parseFloat(r[c.tax]) || 0) : 0,
      date: isoDate(r[c.dt], r[c.date]),
      currency: r[c.currency] || "EUR",
      assetType: assetTypeFromClass(r[c.assetClass]),
    });
  }
  return out;
}

/** Deutsche Bank Bestandsaufstellung — a holdings snapshot. Each position
 *  becomes one opening BUY at its average cost (Einstandskurs). */
function parseDeutscheBank(text: string): ParsedTx[] {
  const lines = toLines(text);
  const header = splitLine(lines[0], ";");
  const c = {
    bestand: idx(header, "Bestand"),
    name: idx(header, "Bezeichnung"),
    wkn: idx(header, "WKN"),
    isin: idx(header, "ISIN"),
    currency: idx(header, "Währung"),
    einstand: idxExact(header, "Einstandskurs"),
    date: idx(header, "Datum letzte Bewegung"),
    gattung: idx(header, "Gattung"),
  };
  const out: ParsedTx[] = [];
  for (let i = 1; i < lines.length; i++) {
    const r = splitLine(lines[i], ";");
    const qty = deNum(r[c.bestand]);
    const price = deNum(r[c.einstand]);
    if (!(qty > 0) || !(price > 0) || !(r[c.isin] || r[c.wkn])) continue;
    const gattung = (r[c.gattung] || "").toLowerCase();
    const assetType: AssetType = gattung.includes("aktie") && !gattung.includes("fonds") ? "STOCK" : "ETF";
    out.push({
      isin: r[c.isin] || null,
      wkn: r[c.wkn] || null,
      symbol: null,
      name: r[c.name] || r[c.isin] || "",
      type: "BUY",
      quantity: qty,
      price,
      fee: 0,
      tax: 0,
      date: (r[c.date] || "").slice(0, 10) + "T00:00:00",
      currency: r[c.currency] || "EUR",
      assetType,
    });
  }
  return out;
}

/**
 * Deutsche Bank "PrivatDepot" transaction export (Umsätze) — a real booking
 * history, one row per Umsatzart. "Nominal / Stück" is SIGNED for Kauf/
 * Verkauf/Zeichnung (negative = sell) but for Dividende/Ausschüttung and
 * Kapitalrückzahlung it reflects the position size on record, not a share
 * movement — those Umsatzarten never change the holding here, so they're
 * skipped as cash-only rows regardless of that field's sign. "Kurs" is blank
 * on cash-only rows; when it's missing on a real trade row it's derived from
 * the settlement amount ("Ausmachender Betrag") divided by the quantity.
 */
function parseDbTransactions(text: string): { rows: ParsedTx[]; skipped: number } {
  const lines = toLines(text);
  const header = splitLine(lines[0], ";");
  const c = {
    date: idx(header, "Buchungsdatum"),
    art: idx(header, "Umsatzart"),
    nominal: idx(header, "Nominal"),
    name: idx(header, "Bezeichnung"),
    wkn: idx(header, "WKN"),
    isin: idx(header, "ISIN"),
    currency: idx(header, "Handelswährung"),
    kurs: idxExact(header, "Kurs"),
    betrag: idx(header, "Ausmachender Betrag"),
    feeOwn: idx(header, "Eigene Spesen"),
    feeForeign: idx(header, "Fremde Spesen"),
    tax: idx(header, "Steuern"),
  };
  const out: ParsedTx[] = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const r = splitLine(lines[i], ";");
    if (!r[c.isin] && !r[c.wkn]) continue;
    const art = (r[c.art] || "").toLowerCase();
    // Dividends and capital repayments never move units here — cash-only.
    if (art.includes("dividende") || art.includes("ausschüttung") || art.includes("kapitalrückzahlung")) {
      skipped++;
      continue;
    }
    let type: TransactionType;
    if (art.includes("verkauf")) type = "SELL";
    else if (art.includes("kauf") || art.includes("zeichnung")) type = "BUY";
    else {
      skipped++; // unrecognised Umsatzart — treat as an unbooked cash row
      continue;
    }
    const nominal = deNum(r[c.nominal]);
    if (!Number.isFinite(nominal) || nominal === 0) {
      skipped++;
      continue;
    }
    const quantity = Math.abs(nominal);
    const amount = deNum(r[c.betrag]);
    let price = deNum(r[c.kurs]);
    if (!Number.isFinite(price) || price === 0) {
      price = Number.isFinite(amount) ? Math.abs(amount) / quantity : 0;
    }
    const fee =
      (c.feeOwn >= 0 ? Math.abs(deNum(r[c.feeOwn])) || 0 : 0) +
      (c.feeForeign >= 0 ? Math.abs(deNum(r[c.feeForeign])) || 0 : 0);
    out.push({
      isin: r[c.isin] || null,
      wkn: r[c.wkn] || null,
      symbol: null,
      name: r[c.name] || r[c.isin] || "",
      type,
      quantity,
      price,
      fee,
      tax: c.tax >= 0 ? Math.abs(deNum(r[c.tax])) || 0 : 0,
      date: (r[c.date] || "").slice(0, 10) + "T00:00:00",
      currency: r[c.currency] || "EUR",
      assetType: "ETF",
    });
  }
  return { rows: out, skipped };
}

/**
 * Bitpanda transaction export. The file carries a personal-data preamble
 * (name, email, account-opened date, venue) before the real header, so the
 * header row is located by content rather than assumed to be line 0. Only
 * "Cryptocurrency" and "Metal" (gold) rows become transactions; "Fiat" rows
 * are pure cash deposits/withdrawals (Asset = EUR, Amount Asset = "-") and
 * are skipped, counted like the other parsers' cash-only rows. Direction
 * comes from Transaction Type: buy/deposit increase the holding (BUY),
 * sell/withdrawal decrease it (SELL). A fee denominated in the row's own
 * asset (e.g. a small BTC fee on a BTC deposit) is converted to fiat via the
 * row's market price; a fee already in fiat (EUR) is used as-is. Gold is
 * booked under the catalog's "XAU" symbol at its native gram quantity — no
 * unit conversion, since the market price is already EUR per gram.
 */
function parseBitpanda(text: string): { rows: ParsedTx[]; skipped: number } {
  const lines = toLines(text);
  const headerIdx = lines.findIndex((l) => {
    const h = l.toLowerCase();
    return h.includes("transaction id") && h.includes("asset market price");
  });
  if (headerIdx < 0) return { rows: [], skipped: 0 };
  const header = splitLine(lines[headerIdx], ",");
  const c = {
    timestamp: idxExact(header, "Timestamp"),
    type: idxExact(header, "Transaction Type"),
    amountAsset: idxExact(header, "Amount Asset"),
    asset: idxExact(header, "Asset"),
    marketPrice: idxExact(header, "Asset market price"),
    marketPriceCurrency: idxExact(header, "Asset market price currency"),
    assetClass: idxExact(header, "Asset class"),
    fee: idxExact(header, "Fee"),
    feeAsset: idxExact(header, "Fee asset"),
    tax: idxExact(header, "Tax Fiat"),
  };
  const out: ParsedTx[] = [];
  let skipped = 0;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const r = splitLine(lines[i], ",");
    if (r.length <= 1) continue;
    const assetClass = (r[c.assetClass] || "").toLowerCase();
    if (assetClass.includes("fiat")) {
      skipped++; // pure cash deposit/withdrawal — no unit movement
      continue;
    }
    const txTypeRaw = (r[c.type] || "").toLowerCase();
    let type: TransactionType;
    if (txTypeRaw === "buy" || txTypeRaw === "deposit") type = "BUY";
    else if (txTypeRaw === "sell" || txTypeRaw === "withdrawal") type = "SELL";
    else {
      skipped++; // unrecognised transaction type — treat as an unbooked row
      continue;
    }
    const assetSymbol = r[c.asset] || "";
    const isGold = assetClass.includes("metal");
    const price = anyNum(r[c.marketPrice]);
    const feeAmount = Math.abs(anyNum(r[c.fee])) || 0;
    const feeAssetSym = (r[c.feeAsset] || "").trim().toUpperCase();
    const fee =
      feeAssetSym && feeAssetSym === assetSymbol.toUpperCase()
        ? feeAmount * (Number.isFinite(price) ? price : 0)
        : feeAmount;
    const taxRaw = anyNum(r[c.tax]);
    out.push({
      isin: null,
      wkn: null,
      symbol: isGold ? "XAU" : assetSymbol,
      name: isGold ? "Gold" : assetSymbol,
      type,
      quantity: anyNum(r[c.amountAsset]),
      price,
      fee,
      tax: Number.isFinite(taxRaw) ? taxRaw : 0,
      date: isoDate(r[c.timestamp], r[c.timestamp]),
      currency: r[c.marketPriceCurrency] || "EUR",
      assetType: assetTypeFromClass(r[c.assetClass]),
    });
  }
  return { rows: out, skipped };
}

const VALID_TX_TYPES = new Set<TransactionType>(["BUY", "SELL", "BOOKING", "INTEREST", "SPLIT"]);

/**
 * FinTrack's own CSV export (lib/export/export.ts), re-imported. The file has
 * an assets section (`# Assets`, columns id,name,type,isin,wkn,symbol,
 * currency,notes) followed by a transactions section (`# Transactions`,
 * columns id,date,asset,isin,type,quantity,price,fee,tax) — the transaction
 * row's own "isin" column only ever carries an ISIN, so the assets section is
 * used to enrich every row with wkn, symbol, currency and assetType. The
 * "asset" column holds the asset's name, except when the export itself had no
 * name to write (a lookup miss) — then it falls back to the raw asset id — so
 * rows are matched against the assets section by id first, then by name.
 * Transaction types map 1:1 onto `TransactionType`; a row with any other
 * value (e.g. a type added by a future export version) is unrecognised and
 * skipped, counted like the other parsers' cash-only/unusable rows.
 */
function parseFinTrack(text: string): { rows: ParsedTx[]; skipped: number } {
  const lines = toLines(text);
  const assetsIdx = lines.findIndex((l) => l.trim() === "# Assets");
  const txIdx = lines.findIndex((l) => l.trim() === "# Transactions");
  if (assetsIdx < 0 || txIdx < 0) return { rows: [], skipped: 0 };

  interface FinTrackAsset {
    name: string;
    type: string;
    isin: string | null;
    wkn: string | null;
    symbol: string | null;
    currency: string | null;
  }
  const assetsById = new Map<string, FinTrackAsset>();
  const assetsByName = new Map<string, FinTrackAsset>();
  const assetHeader = splitLine(lines[assetsIdx + 1] ?? "", ",");
  const ac = {
    id: idxExact(assetHeader, "id"),
    name: idxExact(assetHeader, "name"),
    type: idxExact(assetHeader, "type"),
    isin: idxExact(assetHeader, "isin"),
    wkn: idxExact(assetHeader, "wkn"),
    symbol: idxExact(assetHeader, "symbol"),
    currency: idxExact(assetHeader, "currency"),
  };
  for (let i = assetsIdx + 2; i < txIdx; i++) {
    const r = splitLine(lines[i], ",");
    const row: FinTrackAsset = {
      name: r[ac.name] || "",
      type: r[ac.type] || "",
      isin: r[ac.isin] || null,
      wkn: r[ac.wkn] || null,
      symbol: r[ac.symbol] || null,
      currency: r[ac.currency] || null,
    };
    const id = r[ac.id] || "";
    if (id) assetsById.set(id, row);
    if (row.name) assetsByName.set(row.name, row);
  }

  const txHeader = splitLine(lines[txIdx + 1] ?? "", ",");
  const tc = {
    date: idxExact(txHeader, "date"),
    asset: idxExact(txHeader, "asset"),
    isin: idxExact(txHeader, "isin"),
    type: idxExact(txHeader, "type"),
    quantity: idxExact(txHeader, "quantity"),
    price: idxExact(txHeader, "price"),
    fee: idxExact(txHeader, "fee"),
    tax: idxExact(txHeader, "tax"),
  };
  const out: ParsedTx[] = [];
  let skipped = 0;
  for (let i = txIdx + 2; i < lines.length; i++) {
    const r = splitLine(lines[i], ",");
    const assetField = r[tc.asset] || "";
    const asset = assetsById.get(assetField) ?? assetsByName.get(assetField);
    const rawType = (r[tc.type] || "").toUpperCase() as TransactionType;
    if (!VALID_TX_TYPES.has(rawType)) {
      skipped++; // unrecognised transaction type — not one this app writes
      continue;
    }
    out.push({
      isin: r[tc.isin] || asset?.isin || null,
      wkn: asset?.wkn || null,
      symbol: asset?.symbol || null,
      name: asset?.name || assetField,
      type: rawType,
      quantity: Number(r[tc.quantity]),
      price: Number(r[tc.price]),
      fee: Number(r[tc.fee]) || 0,
      tax: Number(r[tc.tax]) || 0,
      date: r[tc.date] || "",
      currency: asset?.currency || "EUR",
      assetType: (asset?.type as AssetType) || inferAssetType(assetField),
    });
  }
  return { rows: out, skipped };
}

/**
 * Portfolio Performance (github.com/portfolio-performance/portfolio) CSV
 * transaction export. Verified against `CSVExporter.java`
 * (`writeHeader`/`writeTransaction`, shared by the account- and
 * portfolio-transaction export) and the `Messages`/`labels` resource
 * bundles: the header is, in order, Date, Type, Value, Transaction Currency,
 * Gross Amount, Currency Gross Amount, Exchange Rate, Fees, Taxes, Shares,
 * ISIN, WKN, Ticker Symbol, Security Name, Note — column labels (and the
 * type strings below) switch to German with the running UI locale, and so
 * does the delimiter (`TextUtil.getListSeparatorChar`: ';' for German,
 * decimal comma; ',' for English, decimal point). Numbers are parsed with
 * the locale-tolerant `anyNum` regardless (it already disambiguates
 * "1.234,56" from "1,234.56" by the right-most separator), and the Date
 * column is always Java's locale-independent `LocalDateTime.toString()`
 * (ISO, seconds omitted when zero) — so only the header lookup and the
 * delimiter actually depend on the detected language.
 *
 * There is no per-share price column. "Value" is the transaction's *net*
 * amount — fees/taxes already applied — exactly like `Transaction.getAmount()`
 * in PP itself; the price is recovered with the same formula PP's own
 * `PortfolioTransaction.getGrossValueAmount()` uses: gross = Value − Fees −
 * Taxes for a purchase-type row (Buy, Einlieferung/Delivery (Inbound)),
 * gross = Value + Fees + Taxes for a sale, then price = gross / Shares. When
 * the optional Gross Amount + Currency Gross Amount columns are populated
 * (a cross-currency trade, where the account/transaction currency differs
 * from the security's own), they already hold that gross value precomputed
 * in the security's real currency (PP's GROSS_VALUE unit, itself net of
 * fees/taxes) — used directly instead, and its currency wins over
 * Transaction Currency, which would otherwise be the account's currency,
 * not the security's.
 *
 * Type mapping: Kauf/Buy → BUY, Verkauf/Sell → SELL, Einlieferung/Delivery
 * (Inbound) → BOOKING (an in-kind transfer booked at a cost basis). Every
 * other type PP can export — Dividende/Dividend, Zinsen/Interest,
 * Auslieferung/Delivery (Outbound), Einlage/Deposit, Entnahme/Withdrawal,
 * Umbuchung/Transfer (Inbound/Outbound), and fee-/tax-only rows — has no
 * FinTrack `TransactionType` counterpart (dividends come from real market
 * events, and mapping an outbound delivery to SELL would fabricate realised
 * P&L) and is skipped and counted, same as the other parsers' cash-only rows.
 */
function parsePortfolioPerformance(text: string): { rows: ParsedTx[]; skipped: number } {
  const lines = toLines(text);
  if (lines.length < 2) return { rows: [], skipped: 0 };
  const firstLower = lines[0].toLowerCase();
  const isGerman = firstLower.includes("ticker-symbol") || firstLower.includes("buchungswährung");
  const delim = isGerman ? ";" : ",";
  const header = splitLine(lines[0], delim);
  const c = isGerman
    ? {
        date: idxExact(header, "Datum"),
        type: idxExact(header, "Typ"),
        value: idxExact(header, "Wert"),
        currency: idxExact(header, "Buchungswährung"),
        grossAmount: idxExact(header, "Bruttobetrag"),
        grossCurrency: idxExact(header, "Währung Bruttobetrag"),
        fees: idxExact(header, "Gebühren"),
        taxes: idxExact(header, "Steuern"),
        shares: idxExact(header, "Stück"),
        isin: idxExact(header, "ISIN"),
        wkn: idxExact(header, "WKN"),
        symbol: idxExact(header, "Ticker-Symbol"),
        name: idxExact(header, "Wertpapiername"),
      }
    : {
        date: idxExact(header, "Date"),
        type: idxExact(header, "Type"),
        value: idxExact(header, "Value"),
        currency: idxExact(header, "Transaction Currency"),
        grossAmount: idxExact(header, "Gross Amount"),
        grossCurrency: idxExact(header, "Currency Gross Amount"),
        fees: idxExact(header, "Fees"),
        taxes: idxExact(header, "Taxes"),
        shares: idxExact(header, "Shares"),
        isin: idxExact(header, "ISIN"),
        wkn: idxExact(header, "WKN"),
        symbol: idxExact(header, "Ticker Symbol"),
        name: idxExact(header, "Security Name"),
      };
  const out: ParsedTx[] = [];
  let skipped = 0;
  for (let i = 1; i < lines.length; i++) {
    const r = splitLine(lines[i], delim);
    const typeRaw = (r[c.type] || "").trim();
    let type: TransactionType;
    if (typeRaw === "Kauf" || typeRaw === "Buy") type = "BUY";
    else if (typeRaw === "Verkauf" || typeRaw === "Sell") type = "SELL";
    else if (typeRaw === "Einlieferung" || typeRaw === "Delivery (Inbound)") type = "BOOKING";
    else {
      skipped++; // Dividend/Interest/Delivery (Outbound)/Deposit/Withdrawal/Transfer/... — no counterpart
      continue;
    }
    const quantity = Math.abs(anyNum(r[c.shares]));
    const fee = Math.abs(anyNum(r[c.fees])) || 0;
    const tax = Math.abs(anyNum(r[c.taxes])) || 0;
    const amount = Math.abs(anyNum(r[c.value]));
    const grossAmountRaw = r[c.grossAmount] || "";
    const grossCurrencyRaw = r[c.grossCurrency] || "";
    let price: number;
    let currency: string;
    if (grossAmountRaw && grossCurrencyRaw) {
      price = anyNum(grossAmountRaw) / quantity;
      currency = grossCurrencyRaw;
    } else {
      const grossValue = type === "SELL" ? amount + fee + tax : amount - fee - tax;
      price = grossValue / quantity;
      currency = r[c.currency] || "EUR";
    }
    const isin = r[c.isin] || null;
    const wkn = r[c.wkn] || null;
    const symbol = r[c.symbol] || null;
    const name = r[c.name] || isin || wkn || symbol || "";
    out.push({
      isin,
      wkn,
      symbol,
      name,
      type,
      quantity,
      price,
      fee,
      tax,
      date: anyDate(r[c.date]),
      currency,
      assetType: inferAssetType(name),
    });
  }
  return { rows: out, skipped };
}

// --- generic (any-broker) parser --------------------------------------------

/** Number tolerant of both decimal comma and decimal point, plus thousands
 *  separators and stray currency symbols. "1.234,50" and "1,234.50" → 1234.5. */
function anyNum(s: string): number {
  let v = (s ?? "").trim().replace(/["']/g, "").replace(/\s/g, "");
  v = v.replace(/[^0-9.,-]/g, "");
  if (v === "" || v === "-") return NaN;
  const lastComma = v.lastIndexOf(",");
  const lastDot = v.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    // The right-most separator is the decimal; the other groups thousands.
    if (lastComma > lastDot) v = v.replace(/\./g, "").replace(",", ".");
    else v = v.replace(/,/g, "");
  } else if (lastComma >= 0) {
    v = v.replace(",", "."); // lone comma → decimal comma (European default)
  }
  return parseFloat(v);
}

/** Date tolerant of ISO, dd.mm.yyyy and dd/mm/yyyy, each with optional time. */
function anyDate(s: string): string {
  const v = (s ?? "").trim();
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?/);
  if (m) {
    const time = m[4] ? (m[4].length === 5 ? `${m[4]}:00` : m[4]) : "00:00:00";
    return `${m[1]}-${m[2]}-${m[3]}T${time}`;
  }
  m = v.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    const time = m[4] ? (m[4].length === 5 ? `${m[4]}:00` : m[4]) : "00:00:00";
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}T${time}`;
  }
  return `${v.slice(0, 10)}T00:00:00`;
}

/** Map a free-text side/type column to a transaction type. */
function anyType(s: string): TransactionType | null {
  const t = (s || "").toLowerCase();
  if (/verkauf|sell|sale|sold|redemption/.test(t)) return "SELL";
  if (/kauf|buy|purchase|bought|savings|sparplan/.test(t)) return "BUY";
  if (/einbuchung|booking|transfer|deposit|einlieferung/.test(t)) return "BOOKING";
  return null;
}

/** Best delimiter for a header line (the one that yields the most columns). */
function detectDelim(headerLine: string): string {
  let best = ",";
  let bestCount = -1;
  for (const d of [";", "\t", ","]) {
    const n = headerLine.split(d).length;
    if (n > bestCount) {
      bestCount = n;
      best = d;
    }
  }
  return best;
}

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

/**
 * Header-driven parser for any broker's CSV, used when none of the known
 * formats match. Columns are located by fuzzy header names (English + German);
 * numbers and dates are parsed leniently. Rows without a usable quantity, price
 * and identifier are skipped. Not every export will map perfectly, but this lets
 * arbitrary broker files be imported instead of being rejected outright.
 */
export function parseGeneric(text: string): ParsedTx[] {
  const lines = toLines(text);
  if (lines.length < 2) return [];
  const delim = detectDelim(lines[0]);
  const header = splitLine(lines[0], delim);
  const find = (names: string[]) => {
    for (const n of names) {
      const i = header.findIndex((h) => h.toLowerCase().includes(n));
      if (i >= 0) return i;
    }
    return -1;
  };
  const c = {
    date: find(["datetime", "date", "datum", "buchung", "valuta", "trade"]),
    type: find(["type", "richtung", "art", "side", "umsatz", "transaction", "direction"]),
    isin: find(["isin"]),
    wkn: find(["wkn"]),
    symbol: find(["symbol", "ticker"]),
    name: find(["name", "bezeichnung", "fonds", "instrument", "security", "wertpapier", "description"]),
    qty: find(["quantity", "anzahl", "shares", "anteile", "stück", "stueck", "menge", "nominal", "bestand", "units"]),
    price: find(["price", "kurs", "preis", "rate"]),
    fee: find(["fee", "gebühr", "gebuehr", "provision", "kosten", "commission"]),
    tax: find(["tax", "steuer", "kest", "abgeltung"]),
    currency: find(["currency", "währung", "waehrung", "ccy"]),
  };
  // Needs at least a quantity, a price and some identifier column to be a trade
  // export we can meaningfully import.
  if (c.qty < 0 || c.price < 0 || (c.isin < 0 && c.wkn < 0 && c.symbol < 0 && c.name < 0)) {
    return [];
  }
  const out: ParsedTx[] = [];
  for (let i = 1; i < lines.length; i++) {
    const r = splitLine(lines[i], delim);
    const qty = anyNum(r[c.qty]);
    const price = anyNum(r[c.price]);
    if (!(qty > 0) || !(price > 0)) continue;
    const symbolRaw = c.symbol >= 0 ? r[c.symbol] || null : null;
    const isin = (c.isin >= 0 ? r[c.isin] || null : null) ?? (symbolRaw && ISIN_RE.test(symbolRaw) ? symbolRaw : null);
    const symbol = symbolRaw && !ISIN_RE.test(symbolRaw) ? symbolRaw : null;
    const wkn = c.wkn >= 0 ? r[c.wkn] || null : null;
    if (!isin && !wkn && !symbol) continue;
    const name = (c.name >= 0 && r[c.name]) || isin || symbol || wkn || "";
    out.push({
      isin,
      wkn,
      symbol,
      name,
      type: (c.type >= 0 ? anyType(r[c.type]) : null) ?? "BUY",
      quantity: qty,
      price,
      fee: c.fee >= 0 ? Math.abs(anyNum(r[c.fee]) || 0) : 0,
      tax: c.tax >= 0 ? Math.abs(anyNum(r[c.tax]) || 0) : 0,
      date: c.date >= 0 ? anyDate(r[c.date]) : new Date().toISOString().slice(0, 19),
      currency: (c.currency >= 0 && r[c.currency]) || "EUR",
      assetType: inferAssetType(name),
    });
  }
  return out;
}

/**
 * Guardrail applied to every parsed row regardless of broker: a row may only
 * become a transaction if it carries a real identifier — ISIN or WKN, since
 * without one of those we can't reliably match it against the catalog or
 * existing holdings — a parseable date, a positive share count and a
 * positive, finite price. A bare `symbol` is not enough *unless* the row is
 * crypto or a commodity (`assetType === "CRYPTO" | "COMMODITY"`): neither has
 * an ISIN/WKN by nature, so a symbol (e.g. "BTC", "XAU") is the only
 * identifier they can ever carry. This runs centrally in `parseCsv` after
 * every per-broker parser, so no individual parser needs to duplicate it.
 */
export function isValidTx(tx: ParsedTx): boolean {
  const hasIdentifier =
    Boolean(tx.isin || tx.wkn) ||
    ((tx.assetType === "CRYPTO" || tx.assetType === "COMMODITY") && Boolean(tx.symbol));
  return (
    hasIdentifier &&
    /^\d{4}-\d{2}-\d{2}/.test(tx.date || "") &&
    Number.isFinite(tx.quantity) &&
    tx.quantity > 0 &&
    // SPLIT rows carry a ratio in `quantity` and always have price 0 — the
    // price guard only applies to real trades/creditings.
    (tx.type === "SPLIT" || (Number.isFinite(tx.price) && tx.price > 0))
  );
}

export function parseCsv(
  text: string,
  format?: BrokerFormat,
): { format: BrokerFormat | null; rows: ParsedTx[]; skipped: number; invalid: number } {
  const fmt = format ?? detectFormat(text);
  // Known broker formats parse precisely; anything else falls back to the
  // generic header-driven parser so files from other brokers still import.
  // Only the formats with recognised-but-cash-only or unexecuted rows (FNZ,
  // Deutsche Bank transactions, ZERO orders, Bitpanda, FinTrack, Portfolio
  // Performance) report a non-zero `skipped` count.
  let rows: ParsedTx[];
  let skipped: number;
  if (fmt === "fnz") {
    ({ rows, skipped } = parseFnz(text));
  } else if (fmt === "dbtransactions") {
    ({ rows, skipped } = parseDbTransactions(text));
  } else if (fmt === "zeroorders") {
    ({ rows, skipped } = parseZeroOrders(text));
  } else if (fmt === "bitpanda") {
    ({ rows, skipped } = parseBitpanda(text));
  } else if (fmt === "fintrack") {
    ({ rows, skipped } = parseFinTrack(text));
  } else if (fmt === "portfolioperformance") {
    ({ rows, skipped } = parsePortfolioPerformance(text));
  } else {
    rows = !fmt
      ? parseGeneric(text)
      : fmt === "traderepublic"
        ? parseTradeRepublic(text)
        : parseDeutscheBank(text);
    skipped = 0;
  }
  // Central, parser-agnostic guardrail: rows the parser emitted but that fail
  // basic sanity (no ISIN/WKN, bad date, non-positive quantity/price) never
  // become transactions — they're rejected and counted, not silently dropped.
  const valid = rows.filter(isValidTx);
  const invalid = rows.length - valid.length;
  return { format: fmt, rows: valid, skipped, invalid };
}

/** Fuzzy fingerprint: identifier + type + day + rounded qty/price, so a row
 *  recorded at slightly different precision maps to the same key. */
export function fingerprint(tx: {
  isin: string | null;
  wkn: string | null;
  symbol: string | null;
  type: string;
  date: string;
  quantity: number;
  price: number;
}): string {
  const key = (tx.isin || tx.wkn || tx.symbol || "").toUpperCase();
  const day = tx.date.slice(0, 10);
  const qty = tx.quantity.toFixed(3);
  const price = Math.round(tx.price).toString();
  return `${key}|${tx.type}|${day}|${qty}|${price}`;
}
