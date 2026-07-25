// Client-side portfolio export. Serialises the full PortfolioData to a JSON
// snapshot or to CSV (assets + transactions in two sections) and triggers a
// browser download. No server round-trip — the data already lives in memory.

import type { PortfolioData } from "../types";
import type { TaxYearBreakdown } from "../finance/tax";
import type { TaxPackYear } from "../finance/tax-pack";

/** Quote a CSV field per RFC 4180 when it contains a comma, quote, or newline. */
function csvCell(value: unknown): string {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsvRows(rows: (string | number | null)[][]): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\n");
}

/** Build a CSV with an assets section and a transactions section. */
export function portfolioToCsv(data: PortfolioData): string {
  const assetById = new Map(data.assets.map((a) => [a.id, a]));

  const assetRows: (string | number | null)[][] = [
    ["# Assets"],
    ["id", "name", "type", "isin", "wkn", "symbol", "currency", "notes"],
    ...data.assets.map((a) => [
      a.id,
      a.name,
      a.type,
      a.isin,
      a.wkn,
      a.symbol,
      a.currency,
      a.notes,
    ]),
  ];

  const txRows: (string | number | null)[][] = [
    ["# Transactions"],
    ["id", "date", "asset", "isin", "type", "quantity", "price", "fee", "tax"],
    ...data.transactions
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((t) => {
        const a = assetById.get(t.assetId);
        return [
          t.id,
          t.date,
          a?.name ?? t.assetId,
          a?.isin ?? "",
          t.type,
          t.quantity,
          t.price,
          t.fee,
          t.tax,
        ];
      }),
  ];

  return [
    `# FinTrack export: base currency ${data.profile.currency}`,
    toCsvRows(assetRows),
    "",
    toCsvRows(txRows),
    "",
  ].join("\n");
}

/** Pretty-printed JSON snapshot with a small metadata envelope. */
export function portfolioToJson(data: PortfolioData): string {
  return JSON.stringify(
    { app: "FinTrack", version: 1, exportedAt: new Date().toISOString(), data },
    null,
    2,
  );
}

/** Trigger a client-side file download of `content`. */
export function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function stamp(): string {
  return new Date().toISOString().slice(0, 10);
}

export function exportPortfolioJson(data: PortfolioData): void {
  downloadFile(`fintrack-${stamp()}.json`, portfolioToJson(data), "application/json");
}

export function exportPortfolioCsv(data: PortfolioData): void {
  downloadFile(`fintrack-${stamp()}.csv`, portfolioToCsv(data), "text/csv;charset=utf-8");
}

/**
 * Advisor/Elster-prep export for one tax year (ROADMAP item #11): the
 * capital-gains waterfall (`TaxYearBreakdown`) plus deductible expenses and
 * income context from the spending ledger (`TaxPackYear`), in the profile's
 * base currency. `pack` is undefined when the spending ledger has no rows
 * for the year -- the deductible/income sections are then empty, not absent.
 */
export function taxPackYearToCsv(
  breakdown: TaxYearBreakdown,
  pack: TaxPackYear | undefined,
  currency: string,
): string {
  const capitalRows: (string | number | null)[][] = [
    ["# Capital income", breakdown.year],
    ["item", "amount", "currency"],
    ["Stock gains", breakdown.stockGains, currency],
    ["Fund gains", breakdown.fundGains, currency],
    ["Dividends (stock)", breakdown.dividendsStock, currency],
    ["Dividends (fund)", breakdown.dividendsFund, currency],
    ["Interest", breakdown.interest, currency],
    ["Vorabpauschale", breakdown.vorabpauschale, currency],
    ["Kapitalerträge (taxable pots)", breakdown.kapitalertraege, currency],
    ["Allowance used (Sparerpauschbetrag)", breakdown.allowanceUsed, currency],
    ["Taxable after allowance", breakdown.taxableAfterAllowance, currency],
    ["Estimated tax", breakdown.estimatedTax, currency],
    ["Tax withheld by broker", breakdown.taxWithheld, currency],
    ["Private sale gains (crypto/commodities, informational)", breakdown.privateSale, currency],
  ];

  const deductibleRows: (string | number | null)[][] = [
    ["# Deductible expenses", breakdown.year],
    ["group", "category", "amount", "currency"],
    ...(pack?.deductibleByCategory ?? []).map((c) => [c.groupName, c.name, c.amount, currency]),
    ["Total", "", pack?.deductibleTotal ?? 0, currency],
  ];

  const incomeRows: (string | number | null)[][] = [
    ["# Other income & expense (spending ledger)", breakdown.year],
    ["item", "amount", "currency"],
    ["Income", pack?.income ?? 0, currency],
    ["Expense", pack?.expense ?? 0, currency],
  ];

  return [
    `# FinTrack tax pack ${breakdown.year}: base currency ${currency}. Estimate for orientation only, not tax advice.`,
    toCsvRows(capitalRows),
    "",
    toCsvRows(deductibleRows),
    "",
    toCsvRows(incomeRows),
    "",
  ].join("\n");
}

export function exportTaxPackYear(
  breakdown: TaxYearBreakdown,
  pack: TaxPackYear | undefined,
  currency: string,
): void {
  downloadFile(
    `fintrack-tax-pack-${breakdown.year}.csv`,
    taxPackYearToCsv(breakdown, pack, currency),
    "text/csv;charset=utf-8",
  );
}
