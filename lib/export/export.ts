// Client-side portfolio export. Serialises the full PortfolioData to a JSON
// snapshot or to CSV (assets + transactions in two sections) and triggers a
// browser download. No server round-trip — the data already lives in memory.

import type { PortfolioData } from "../types";

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
    ["id", "date", "asset", "isin", "type", "quantity", "price", "fee"],
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
        ];
      }),
  ];

  return [
    `# FinTrack export — base currency ${data.profile.currency}`,
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
