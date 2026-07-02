// Broker CSV transaction parsing. Four German broker exports are supported;
// the format is auto-detected from the header. Everything runs in the browser —
// the CSV never leaves the device. No cash logic yet: pure deposits/withdrawals
// and non-trade rows are dropped.

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
  /** ISO datetime, e.g. 2025-04-16T20:53:24. */
  date: string;
  currency: string;
  assetType: AssetType;
}

export type BrokerFormat = "zero" | "fnz" | "traderepublic" | "deutschebank";

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
  if (h.includes("ausführung kurs") || h.includes("ausf") && h.includes("richtung")) return "zero";
  if (h.includes("bestand") && h.includes("einstandskurs")) return "deutschebank";
  return null;
}

// --- parsers ----------------------------------------------------------------

function assetTypeFromClass(s: string): AssetType {
  const t = (s || "").toLowerCase();
  if (t.includes("crypto")) return "CRYPTO";
  if (t.includes("stock") || t.includes("aktie")) return "STOCK";
  return "ETF";
}

/** Finanzen.net zero — order history. Only executed orders become transactions. */
function parseZero(text: string): ParsedTx[] {
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
  };
  const out: ParsedTx[] = [];
  for (let i = 1; i < lines.length; i++) {
    const r = splitLine(lines[i], ";");
    const qty = deNum(r[c.execQty]);
    const price = deNum(r[c.execPrice]);
    // Skip cancelled/unexecuted orders (no executed qty or price).
    if (!(qty > 0) || !(price > 0) || !r[c.execDate]) continue;
    out.push({
      isin: r[c.isin] || null,
      wkn: r[c.wkn] || null,
      symbol: null,
      name: r[c.name] || r[c.isin] || "",
      type: /verkauf/i.test(r[c.richtung]) ? "SELL" : "BUY",
      quantity: qty,
      price,
      fee: c.fee >= 0 ? deNum(r[c.fee]) || 0 : 0,
      date: deDate(r[c.execDate], r[c.execTime]),
      currency: "EUR",
      assetType: "STOCK",
    });
  }
  return out;
}

/** FNZ fund savings plan. "vermögenswirksame Leistungen" rows are BOOKINGs. */
function parseFnz(text: string): ParsedTx[] {
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
  };
  const out: ParsedTx[] = [];
  for (let i = 1; i < lines.length; i++) {
    const r = splitLine(lines[i], ";");
    const shares = deNum(r[c.anteile]);
    const amount = deNum(r[c.betrag]);
    if (!(shares > 0) || !r[c.isin]) continue;
    const art = (r[c.art] || "").toLowerCase();
    if (!art.includes("kauf") && !art.includes("verkauf")) continue; // skip fees/taxes
    // Employer VL contributions are a cost-free crediting → BOOKING.
    const isVL = /verm.genswirksame/i.test(r[c.teil] ?? "");
    const price = shares > 0 ? Math.abs(amount) / shares : 0;
    out.push({
      isin: r[c.isin] || null,
      wkn: null,
      symbol: null,
      name: r[c.fonds] || r[c.isin] || "",
      type: isVL ? "BOOKING" : art.includes("verkauf") ? "SELL" : "BUY",
      quantity: shares,
      price,
      fee: 0,
      date: deDate(r[c.date]),
      currency: "EUR",
      assetType: "ETF",
    });
  }
  return out;
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
      date: (r[c.date] || "").slice(0, 10) + "T00:00:00",
      currency: r[c.currency] || "EUR",
      assetType,
    });
  }
  return out;
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
    type: find(["type", "art", "richtung", "side", "umsatz", "transaction", "direction"]),
    isin: find(["isin"]),
    wkn: find(["wkn"]),
    symbol: find(["symbol", "ticker"]),
    name: find(["name", "bezeichnung", "fonds", "instrument", "security", "wertpapier", "description"]),
    qty: find(["quantity", "anzahl", "shares", "anteile", "stück", "stueck", "menge", "nominal", "bestand", "units"]),
    price: find(["price", "kurs", "preis", "rate"]),
    fee: find(["fee", "gebühr", "gebuehr", "provision", "kosten", "commission"]),
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
    out.push({
      isin,
      wkn,
      symbol,
      name: (c.name >= 0 && r[c.name]) || isin || symbol || wkn || "",
      type: (c.type >= 0 ? anyType(r[c.type]) : null) ?? "BUY",
      quantity: qty,
      price,
      fee: c.fee >= 0 ? Math.abs(anyNum(r[c.fee]) || 0) : 0,
      date: c.date >= 0 ? anyDate(r[c.date]) : new Date().toISOString().slice(0, 19),
      currency: (c.currency >= 0 && r[c.currency]) || "EUR",
      assetType: "ETF",
    });
  }
  return out;
}

export function parseCsv(text: string, format?: BrokerFormat): { format: BrokerFormat | null; rows: ParsedTx[] } {
  const fmt = format ?? detectFormat(text);
  // Known broker formats parse precisely; anything else falls back to the
  // generic header-driven parser so files from other brokers still import.
  const rows = !fmt
    ? parseGeneric(text)
    : fmt === "zero"
      ? parseZero(text)
      : fmt === "fnz"
        ? parseFnz(text)
        : fmt === "traderepublic"
          ? parseTradeRepublic(text)
          : parseDeutscheBank(text);
  return { format: fmt, rows };
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
