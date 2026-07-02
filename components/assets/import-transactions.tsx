"use client";

// CSV transaction import (Add-asset modal → Import tab). Parses a broker export
// entirely in the browser, reconciles each row against the portfolio (new /
// conflict / already-imported), and lets the user resolve conflicts in a
// side-by-side (IntelliJ-style) merge view, then creates the assets +
// transactions and records what was merged. Known German brokers parse
// precisely; any other CSV falls back to a generic header-driven parser.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { parseCsv, type ParsedTx } from "@/lib/import/csv";
import { reconcile, type ReconciledRow } from "@/lib/import/reconcile";
import { formatCurrency, formatNumber, formatDateTime } from "@/lib/format";
import { Button, SegmentedControl } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { useI18n } from "@/lib/i18n/i18n-context";
import type { AssetType, TransactionType } from "@/lib/types";

// Per-conflict choice: keep what's already in the portfolio, or overwrite it
// with the incoming row. New rows use a simple include/exclude instead.
type ConflictChoice = "keep" | "use";

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

function txTypeColor(type: TransactionType): string {
  return type === "BUY"
    ? "text-emerald-600 dark:text-emerald-400"
    : type === "BOOKING"
      ? "text-indigo-600 dark:text-indigo-400"
      : "text-red-600 dark:text-red-400";
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
    createPortfolio,
    loadImportedFingerprints,
    addImportedFingerprints,
  } = usePortfolio();
  const { t } = useI18n();

  const [fileName, setFileName] = useState<string | null>(null);
  const [reconciled, setReconciled] = useState<ReconciledRow[]>([]);
  // New rows: included by index (default all). Conflicts: choice by index.
  const [included, setIncluded] = useState<Record<number, boolean>>({});
  const [choices, setChoices] = useState<Record<number, ConflictChoice>>({});
  const [portfolioId, setPortfolioId] = useState(
    selectedPortfolioIds[0] ?? portfolios[0]?.id ?? "",
  );
  const [addingPortfolio, setAddingPortfolio] = useState(false);
  const [newPortfolio, setNewPortfolio] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setError(null);
    try {
      const text = await readFile(file);
      const { rows: parsed } = parseCsv(text);
      if (parsed.length === 0) {
        setError(t("import.noRows"));
        setReconciled([]);
        setFileName(null);
        return;
      }
      const imported = new Set(await loadImportedFingerprints());
      const rec = reconcile(parsed, data.assets, allTransactions, imported);
      setFileName(file.name);
      setReconciled(rec);
      // Defaults: include every new row; keep the existing side for conflicts.
      const inc: Record<number, boolean> = {};
      const ch: Record<number, ConflictChoice> = {};
      rec.forEach((r, i) => {
        if (r.status === "new") inc[i] = true;
        else if (r.status === "conflict") ch[i] = "keep";
      });
      setIncluded(inc);
      setChoices(ch);
    } catch {
      setError(t("import.readError"));
    }
  }

  const newRows = useMemo(
    () => reconciled.map((r, i) => ({ r, i })).filter((x) => x.r.status === "new"),
    [reconciled],
  );
  const conflictRows = useMemo(
    () => reconciled.map((r, i) => ({ r, i })).filter((x) => x.r.status === "conflict"),
    [reconciled],
  );
  const importedCount = useMemo(
    () => reconciled.filter((r) => r.status === "imported").length,
    [reconciled],
  );

  const willApply =
    newRows.filter((x) => included[x.i]).length +
    conflictRows.filter((x) => choices[x.i] === "use").length;

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
        const r = reconciled[i];
        const replace = r.status === "conflict" && choices[i] === "use";
        const importNew = r.status === "new" && included[i];
        if (!replace && !importNew) continue;

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
        if (replace && r.existing) {
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

  const hasFile = reconciled.length > 0;

  return (
    <div className="space-y-4">
      {/* File chooser + (once loaded) target portfolio picker with inline create. */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800">
          {hasFile ? t("import.reselectFile") : t("import.selectFile")}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = ""; // allow re-selecting the same file
            }}
          />
        </label>
        {fileName && <span className="truncate text-sm text-zinc-500">{fileName}</span>}
        {hasFile && portfolios.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-zinc-500">{t("import.portfolio")}</span>
            <div className="w-48">
              <SelectMenu
                value={portfolioId}
                ariaLabel={t("import.portfolio")}
                onChange={setPortfolioId}
                options={portfolios.map((p) => ({ value: p.id, label: p.name }))}
                footer={(close) =>
                  addingPortfolio ? (
                    <input
                      autoFocus
                      value={newPortfolio}
                      placeholder={t("nav.newPortfolio")}
                      onChange={(e) => setNewPortfolio(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === "Enter") {
                          const name = newPortfolio.trim();
                          if (name) {
                            try {
                              const p = await createPortfolio(name);
                              setPortfolioId(p.id);
                            } catch {
                              /* at max portfolios — ignore */
                            }
                          }
                          setNewPortfolio("");
                          setAddingPortfolio(false);
                          close();
                        }
                        if (e.key === "Escape") {
                          setAddingPortfolio(false);
                          setNewPortfolio("");
                        }
                      }}
                      className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setAddingPortfolio(true)}
                      className="w-full rounded-md px-2 py-1.5 text-left text-sm font-medium text-emerald-600 hover:bg-zinc-100 dark:text-emerald-400 dark:hover:bg-zinc-800"
                    >re
                      {t("nav.newPortfolio")}
                    </button>
                  )
                }
              />
            </div>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {hasFile && (
        <>
          {/* New transactions: include/exclude with checkboxes. */}
          {newRows.length > 0 && (
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  {t("import.newSection")}{" "}
                  <span className="font-normal text-zinc-400">({newRows.length})</span>
                </h3>
                <div className="flex gap-3 text-xs">
                  <button
                    type="button"
                    onClick={() =>
                      setIncluded(Object.fromEntries(newRows.map((x) => [x.i, true])))
                    }
                    className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
                  >
                    {t("import.includeAll")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setIncluded(Object.fromEntries(newRows.map((x) => [x.i, false])))
                    }
                    className="font-medium text-zinc-500 hover:underline"
                  >
                    {t("import.includeNone")}
                  </button>
                </div>
              </div>
              <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800/60 dark:border-zinc-800">
                {newRows.map(({ r, i }) => (
                  <li key={i} className="flex items-center gap-3 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={included[i] ?? false}
                      onChange={(e) =>
                        setIncluded((prev) => ({ ...prev, [i]: e.target.checked }))
                      }
                      className="h-4 w-4 shrink-0 rounded border-zinc-300 dark:border-zinc-600"
                    />
                    <div className="min-w-0 flex-1">
                      <AssetLine parsed={r.parsed} />
                    </div>
                    <TxSummary parsed={r.parsed} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Conflicts: side-by-side existing vs incoming, pick a side. */}
          {conflictRows.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
                {t("import.conflictSection")}{" "}
                <span className="font-normal text-zinc-400">({conflictRows.length})</span>
              </h3>
              <div className="space-y-3">
                {conflictRows.map(({ r, i }) => (
                  <ConflictMerge
                    key={i}
                    row={r}
                    choice={choices[i] ?? "keep"}
                    onChoice={(ch) => setChoices((prev) => ({ ...prev, [i]: ch }))}
                  />
                ))}
              </div>
            </section>
          )}

          {importedCount > 0 && (
            <p className="text-xs text-zinc-400">
              {importedCount} {t("import.alreadyImported")}
            </p>
          )}

          <div className="flex items-center justify-end gap-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
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

function AssetLine({ parsed }: { parsed: ParsedTx }) {
  return (
    <>
      <div className="truncate font-medium">{parsed.name}</div>
      <div className="font-mono text-xs text-zinc-500">
        {parsed.isin || parsed.wkn || parsed.symbol}
      </div>
    </>
  );
}

/** Compact "TYPE qty @ price · date" summary of a parsed row. */
function TxSummary({ parsed }: { parsed: ParsedTx }) {
  const cur = parsed.currency || "EUR";
  return (
    <div className="shrink-0 text-right text-xs text-zinc-500">
      <span className={txTypeColor(parsed.type)}>{parsed.type}</span>{" "}
      {formatNumber(parsed.quantity, 4)} @ {formatCurrency(parsed.price, cur)}
      <div className="text-[11px] text-zinc-400">{formatDateTime(parsed.date)}</div>
    </div>
  );
}

/** IntelliJ-style two-pane conflict: current (left) vs incoming (right). */
function ConflictMerge({
  row,
  choice,
  onChoice,
}: {
  row: ReconciledRow;
  choice: ConflictChoice;
  onChoice: (c: ConflictChoice) => void;
}) {
  const { t } = useI18n();
  const p = row.parsed;
  const cur = p.currency || "EUR";
  const ex = row.existing;

  const paneCls = (active: boolean) =>
    `flex-1 rounded-lg border p-3 transition-colors ${
      active
        ? "border-emerald-400 bg-emerald-50/60 dark:border-emerald-700 dark:bg-emerald-950/30"
        : "border-zinc-200 opacity-60 dark:border-zinc-800"
    }`;

  return (
    <div className="rounded-xl border border-amber-300/60 bg-amber-50/40 p-3 dark:border-amber-900/40 dark:bg-amber-950/10">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{p.name}</div>
          <div className="font-mono text-xs text-zinc-500">
            {p.isin || p.wkn || p.symbol}
          </div>
        </div>
        <div className="w-44 shrink-0">
          <SegmentedControl<ConflictChoice>
            size="sm"
            value={choice}
            onChange={onChoice}
            options={[
              { label: t("import.keepCurrent"), value: "keep" },
              { label: t("import.useIncoming"), value: "use" },
            ]}
          />
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" onClick={() => onChoice("keep")} className={`${paneCls(choice === "keep")} text-left`}>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            {t("import.inPortfolio")}
          </div>
          {ex ? (
            <div className="text-sm tabular-nums">
              <span className={txTypeColor(ex.type)}>{ex.type}</span>{" "}
              {formatNumber(ex.quantity, 4)} @ {formatCurrency(ex.price, cur)}
              <div className="text-[11px] text-zinc-400">{formatDateTime(ex.date)}</div>
            </div>
          ) : (
            <div className="text-sm text-zinc-400">—</div>
          )}
        </button>
        <button type="button" onClick={() => onChoice("use")} className={`${paneCls(choice === "use")} text-left`}>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
            {t("import.fromFile")}
          </div>
          <div className="text-sm tabular-nums">
            <span className={txTypeColor(p.type)}>{p.type}</span>{" "}
            {formatNumber(p.quantity, 4)} @ {formatCurrency(p.price, cur)}
            <div className="text-[11px] text-zinc-400">{formatDateTime(p.date)}</div>
          </div>
        </button>
      </div>
    </div>
  );
}
