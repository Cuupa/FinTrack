"use client";

// CSV transaction import (Add-asset modal → Import tab). Parses a broker export
// entirely in the browser, reconciles each row against the portfolio (new /
// conflict / already-imported), lets the user resolve conflicts git-merge style,
// then creates the assets + transactions and records what was merged.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { parseCsv, type BrokerFormat, type ParsedTx } from "@/lib/import/csv";
import { reconcile, type ReconciledRow } from "@/lib/import/reconcile";
import { formatCurrency, formatNumber } from "@/lib/format";
import { formatDateTime } from "@/lib/format";
import { Button } from "@/components/ui/primitives";
import { useI18n } from "@/lib/i18n/i18n-context";
import type { AssetType } from "@/lib/types";

const FORMAT_LABEL: Record<BrokerFormat, string> = {
  zero: "Finanzen.net Zero",
  fnz: "FNZ",
  traderepublic: "Trade Republic",
  deutschebank: "Deutsche Bank",
};

type Decision = "import" | "skip" | "replace";

async function readFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const utf8 = new TextDecoder("utf-8").decode(buf);
  // Fall back to Windows-1252 for latin-1 exports (umlauts came through broken).
  if (utf8.includes("�")) {
    try {
      return new TextDecoder("windows-1252").decode(buf);
    } catch {
      return utf8;
    }
  }
  return utf8;
}

export function ImportTransactions({ onDone }: { onDone?: () => void }) {
  const {
    data,
    allTransactions,
    portfolios,
    selectedPortfolioIds,
    addAsset,
    addTransaction,
    updateTransaction,
    loadImportedFingerprints,
    addImportedFingerprints,
  } = usePortfolio();
  const { t } = useI18n();

  const [format, setFormat] = useState<BrokerFormat | null>(null);
  const [rows, setRows] = useState<ParsedTx[] | null>(null);
  const [reconciled, setReconciled] = useState<ReconciledRow[]>([]);
  const [decisions, setDecisions] = useState<Record<number, Decision>>({});
  const [portfolioId, setPortfolioId] = useState(
    selectedPortfolioIds[0] ?? portfolios[0]?.id ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setError(null);
    try {
      const text = await readFile(file);
      const { format: fmt, rows: parsed } = parseCsv(text);
      if (!fmt) {
        setError(t("import.unknownFormat"));
        setRows(null);
        return;
      }
      const imported = new Set(await loadImportedFingerprints());
      const rec = reconcile(parsed, data.assets, allTransactions, imported);
      setFormat(fmt);
      setRows(parsed);
      setReconciled(rec);
      // Default: import new rows, skip conflicts and already-imported ones.
      const d: Record<number, Decision> = {};
      rec.forEach((r, i) => (d[i] = r.status === "new" ? "import" : "skip"));
      setDecisions(d);
    } catch {
      setError(t("import.readError"));
    }
  }

  const counts = useMemo(() => {
    let neu = 0;
    let conflict = 0;
    let imported = 0;
    for (const r of reconciled) {
      if (r.status === "new") neu++;
      else if (r.status === "conflict") conflict++;
      else imported++;
    }
    return { neu, conflict, imported };
  }, [reconciled]);

  const willApply = reconciled.filter((_, i) => decisions[i] && decisions[i] !== "skip").length;

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      // Cache asset ids by identifier so repeated rows reuse one asset (and
      // assets created earlier in this same import).
      const key = (isin: string | null, wkn: string | null, symbol: string | null) =>
        (isin || wkn || symbol || "").toUpperCase();
      const cache = new Map<string, string>();
      for (const a of data.assets) {
        const k = key(a.isin, a.wkn, a.symbol);
        if (k) cache.set(k, a.id);
      }

      const recorded: string[] = [];
      for (let i = 0; i < reconciled.length; i++) {
        const decision = decisions[i] ?? "skip";
        if (decision === "skip") continue;
        const r = reconciled[i];
        const p = r.parsed;
        const k = key(p.isin, p.wkn, p.symbol);
        let assetId = cache.get(k);
        if (!assetId) {
          const created = await addAsset({
            isin: p.isin,
            wkn: p.wkn,
            symbol: p.symbol,
            name: p.name,
            type: p.assetType as AssetType,
            currency: p.currency,
            notes: null,
          });
          assetId = created.id;
          if (k) cache.set(k, assetId);
        }
        const payload = {
          assetId,
          portfolioId,
          type: p.type,
          quantity: p.quantity,
          price: p.price,
          fee: p.fee,
          date: p.date,
        };
        if (decision === "replace" && r.existing) {
          await updateTransaction(r.existing.id, payload);
        } else {
          await addTransaction(payload);
        }
        recorded.push(r.fingerprint);
      }
      await addImportedFingerprints(recorded);
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("import.applyError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
          {t("import.selectFile")}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
            }}
          />
        </label>
        {format && (
          <span className="text-sm text-zinc-500">
            {t("import.detected")}: <span className="font-medium">{FORMAT_LABEL[format]}</span>
          </span>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {rows && reconciled.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-zinc-500">{t("import.portfolio")}</label>
            <select
              value={portfolioId}
              onChange={(e) => setPortfolioId(e.target.value)}
              className="rounded-lg border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
            >
              {portfolios.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-zinc-500">
              {counts.neu} {t("import.new")} · {counts.conflict} {t("import.conflicts")} ·{" "}
              {counts.imported} {t("import.alreadyImported")}
            </span>
          </div>

          <div className="max-h-[45vh] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
                <tr className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                  <th className="px-3 py-2">{t("import.status")}</th>
                  <th className="px-3 py-2">{t("import.asset")}</th>
                  <th className="px-3 py-2">{t("import.row")}</th>
                  <th className="px-3 py-2 text-right">{t("import.action")}</th>
                </tr>
              </thead>
              <tbody>
                {reconciled.map((r, i) => (
                  <ImportRow
                    key={i}
                    row={r}
                    decision={decisions[i] ?? "skip"}
                    onDecision={(d) => setDecisions((prev) => ({ ...prev, [i]: d }))}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-end gap-3">
            <span className="text-sm text-zinc-500">
              {willApply} {t("import.willImport")}
            </span>
            <Button variant="primary" onClick={apply} disabled={busy || willApply === 0}>
              {busy ? t("import.importing") : t("import.apply")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function ImportRow({
  row,
  decision,
  onDecision,
}: {
  row: ReconciledRow;
  decision: Decision;
  onDecision: (d: Decision) => void;
}) {
  const { t } = useI18n();
  const p = row.parsed;
  const cur = p.currency || "EUR";
  const badge =
    row.status === "new"
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
      : row.status === "conflict"
        ? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
        : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400";

  return (
    <tr className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
      <td className="px-3 py-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge}`}>
          {t(`import.${row.status}`)}
        </span>
      </td>
      <td className="px-3 py-2">
        <div className="max-w-[16rem] truncate font-medium">{p.name}</div>
        <div className="font-mono text-xs text-zinc-500">{p.isin || p.wkn || p.symbol}</div>
      </td>
      <td className="px-3 py-2 text-xs text-zinc-500">
        <span
          className={
            p.type === "BUY"
              ? "text-emerald-600 dark:text-emerald-400"
              : p.type === "BOOKING"
                ? "text-indigo-600 dark:text-indigo-400"
                : "text-red-600 dark:text-red-400"
          }
        >
          {p.type}
        </span>{" "}
        {formatNumber(p.quantity, 4)} @ {formatCurrency(p.price, cur)} · {formatDateTime(p.date)}
        {row.status === "conflict" && row.existing && (
          <div className="mt-0.5 text-amber-600 dark:text-amber-400">
            {t("import.existing")}: {formatNumber(row.existing.quantity, 4)} @{" "}
            {formatCurrency(row.existing.price, cur)}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {row.status === "imported" ? (
          <span className="text-xs text-zinc-400">—</span>
        ) : (
          <select
            value={decision}
            onChange={(e) => onDecision(e.target.value as Decision)}
            className="rounded-md border border-zinc-300 bg-transparent px-1.5 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700"
          >
            <option value="skip">{t("import.skip")}</option>
            <option value="import">{t("import.doImport")}</option>
            {row.status === "conflict" && <option value="replace">{t("import.replace")}</option>}
          </select>
        )}
      </td>
    </tr>
  );
}
