"use client";

// Header control to select/deselect which portfolios feed the app's numbers and
// charts, plus create / rename / delete portfolios (up to MAX_PORTFOLIOS).

import { useEffect, useRef, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { MAX_PORTFOLIOS } from "@/lib/types";
import { useI18n } from "@/lib/i18n/i18n-context";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export function PortfolioPicker() {
  const {
    portfolios,
    selectedPortfolioIds,
    setSelectedPortfolios,
    createPortfolio,
    renamePortfolio,
    deletePortfolio,
  } = usePortfolio();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  // Deleting cascades to the portfolio's transactions + solely-held assets,
  // so it always goes through a confirmation dialog first.
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
        setRenaming(null);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (portfolios.length === 0) return null;

  const allSelected = selectedPortfolioIds.length === portfolios.length;
  const summary = allSelected
    ? t("nav.allPortfolios")
    : selectedPortfolioIds.length === 1
      ? (portfolios.find((p) => p.id === selectedPortfolioIds[0])?.name ?? "1 selected")
      : `${selectedPortfolioIds.length} of ${portfolios.length}`;

  const toggle = (id: string) => {
    const next = selectedPortfolioIds.includes(id)
      ? selectedPortfolioIds.filter((x) => x !== id)
      : [...selectedPortfolioIds, id];
    setSelectedPortfolios(next);
  };

  const submitNew = async () => {
    const name = newName.trim();
    if (name) await createPortfolio(name);
    setNewName("");
    setAdding(false);
  };

  const submitRename = async (id: string) => {
    const name = renameVal.trim();
    if (name) await renamePortfolio(id, name);
    setRenaming(null);
  };

  return (
    <div className="relative min-w-0" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 w-full max-w-[8rem] items-center gap-2 rounded-lg border border-zinc-300 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 sm:max-w-[12rem] dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
        title="Portfolios"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4 shrink-0" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="7" width="18" height="13" rx="2" />
          <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
        <span className="truncate">{summary}</span>
        <span className="text-[10px] text-zinc-400">▾</span>
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-2 w-72 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 text-xs text-zinc-500 dark:border-zinc-800">
            <span>Portfolios</span>
            <button
              type="button"
              onClick={() => setSelectedPortfolios(portfolios.map((p) => p.id))}
              className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
            >
              {t("common.selectAll")}
            </button>
          </div>

          <ul className="max-h-72 overflow-y-auto py-1">
            {portfolios.map((p) => {
              const on = selectedPortfolioIds.includes(p.id);
              return (
                <li key={p.id} className="group flex items-center gap-2 px-2 py-1">
                  {renaming === p.id ? (
                    <input
                      autoFocus
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void submitRename(p.id);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      onBlur={() => void submitRename(p.id)}
                      className="flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => toggle(p.id)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <span
                          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
                            on ? "border-emerald-500 bg-emerald-500 text-white" : "border-zinc-300 dark:border-zinc-600"
                          }`}
                        >
                          {on ? "✓" : ""}
                        </span>
                        <span className="truncate">{p.name}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRenaming(p.id);
                          setRenameVal(p.name);
                        }}
                        className="shrink-0 px-1 text-xs text-zinc-400 opacity-0 hover:text-zinc-700 group-hover:opacity-100 dark:hover:text-zinc-200"
                        title="Rename"
                        aria-label="Rename portfolio"
                      >
                        ✎
                      </button>
                      {portfolios.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete({ id: p.id, name: p.name })}
                          className="shrink-0 px-1 text-xs text-zinc-400 opacity-0 hover:text-red-500 group-hover:opacity-100"
                          title="Delete"
                          aria-label="Delete portfolio"
                        >
                          ✕
                        </button>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          <div className="border-t border-zinc-100 p-2 dark:border-zinc-800">
            {adding ? (
              <input
                autoFocus
                value={newName}
                placeholder="Portfolio name"
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitNew();
                  if (e.key === "Escape") setAdding(false);
                }}
                onBlur={() => void submitNew()}
                className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                disabled={portfolios.length >= MAX_PORTFOLIOS}
                className="w-full rounded-md px-2 py-1.5 text-left text-sm font-medium text-emerald-600 hover:bg-zinc-100 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-zinc-800"
              >
                {t("nav.newPortfolio")}
              </button>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete !== null}
        title={t("nav.deletePortfolioTitle")}
        message={confirmDelete ? `“${confirmDelete.name}” — ${t("nav.deletePortfolioMsg")}` : undefined}
        confirmLabel={t("tx.deleteTitle")}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void deletePortfolio(confirmDelete.id);
          setConfirmDelete(null);
        }}
      />
    </div>
  );
}
