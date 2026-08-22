"use client";

// Manage spending categories (ROADMAP #2, flag `spending`): a flat
// group_name + name taxonomy, grouped visually by groupName. Renaming or
// deleting a group applies to every category that shares it.
//
// Audit §4.6: a scalable management surface, not an ever-growing wall of red
// Delete buttons. A wide dialog with its own scroll area; search + collapsible
// groups; add via normal primary/secondary actions; edit/delete via row
// actions. A used category cannot be deleted without choosing a replacement,
// and a group delete states how many categories and bookings it touches.

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { isStorageFullError } from "@/lib/store/errors";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button, Card, Field, Input } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { FormActions } from "@/components/ui/form-actions";
import { DeleteAction, EditAction, RowActions } from "@/components/ui/row-actions";
import type { SpendingCategory } from "@/lib/types";
import { missingDefaults } from "@/lib/finance/default-categories";

/** Sentinel for the "move to Ohne Kategorie" replacement choice. */
const UNCATEGORIZED = "__uncat__";

export function CategoryManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const {
    data,
    addSpendingCategory,
    updateSpendingCategory,
    deleteSpendingCategory,
    updateSpendingTransaction,
  } = usePortfolio();
  const { t } = useI18n();
  const taxPackEnabled = useFeatureFlag("taxPack");

  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [deletingCategory, setDeletingCategory] = useState<SpendingCategory | null>(null);
  const [replacementId, setReplacementId] = useState<string>(UNCATEGORIZED);
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupFirstCategory, setNewGroupFirstCategory] = useState("");

  function reportError(err: unknown) {
    setError(isStorageFullError(err) ? t("common.storageFull") : t("spending.categories.actionError"));
  }

  /** Bookings per category id, so a delete can state its impact and offer a
   *  replacement. */
  const usageByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const tx of data.spendingTransactions) {
      if (tx.categoryId) m.set(tx.categoryId, (m.get(tx.categoryId) ?? 0) + 1);
    }
    return m;
  }, [data.spendingTransactions]);

  async function addDefaults() {
    setError(null);
    try {
      for (const c of missingDefaults(data.spendingCategories, t)) {
        await addSpendingCategory(c);
      }
    } catch (err) {
      reportError(err);
    }
  }

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const byGroup = new Map<string, SpendingCategory[]>();
    for (const c of data.spendingCategories) {
      // A group matches if its own name matches, so filtering by group keeps
      // all its categories; otherwise the individual category name matches.
      const groupMatch = c.groupName.toLowerCase().includes(q);
      if (q && !groupMatch && !c.name.toLowerCase().includes(q)) continue;
      const list = byGroup.get(c.groupName) ?? [];
      list.push(c);
      byGroup.set(c.groupName, list);
    }
    return [...byGroup.entries()]
      .map(([groupName, categories]) => ({
        groupName,
        categories: categories.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.groupName.localeCompare(b.groupName));
  }, [data.spendingCategories, query]);

  function toggleGroup(groupName: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupName)) next.delete(groupName);
      else next.add(groupName);
      return next;
    });
  }

  function startRename(c: SpendingCategory) {
    setRenamingId(c.id);
    setRenameVal(c.name);
  }

  async function commitRename(id: string) {
    const name = renameVal.trim();
    setRenamingId(null);
    if (!name) return;
    try {
      await updateSpendingCategory(id, { name });
    } catch (err) {
      reportError(err);
    }
  }

  async function commitNewCategory(groupName: string) {
    const name = newName.trim();
    setNewName("");
    setAddingTo(null);
    if (!name) return;
    try {
      await addSpendingCategory({ groupName, name });
    } catch (err) {
      reportError(err);
    }
  }

  async function toggleTaxDeductible(c: SpendingCategory) {
    try {
      await updateSpendingCategory(c.id, { taxDeductible: !c.taxDeductible });
    } catch (err) {
      reportError(err);
    }
  }

  async function commitNewGroup() {
    const groupName = newGroupName.trim();
    const name = newGroupFirstCategory.trim();
    if (!groupName || !name) return;
    setNewGroupName("");
    setNewGroupFirstCategory("");
    setAddingGroup(false);
    try {
      await addSpendingCategory({ groupName, name });
    } catch (err) {
      reportError(err);
    }
  }

  async function renameGroup(groupName: string, categories: SpendingCategory[], next: string) {
    const trimmed = next.trim();
    if (!trimmed || trimmed === groupName) return;
    try {
      for (const c of categories) {
        await updateSpendingCategory(c.id, { groupName: trimmed });
      }
    } catch (err) {
      reportError(err);
    }
  }

  /** Reassign every booking in `categoryId` to `replacement` (a category id, or
   *  null for Ohne Kategorie), so a delete never silently drops the bookings'
   *  history. */
  async function reassignBookings(categoryId: string, replacement: string | null) {
    for (const tx of data.spendingTransactions) {
      if (tx.categoryId === categoryId) {
        await updateSpendingTransaction(tx.id, { categoryId: replacement });
      }
    }
  }

  function requestDeleteCategory(c: SpendingCategory) {
    setReplacementId(UNCATEGORIZED);
    setDeletingCategory(c);
  }

  async function confirmDeleteCategory() {
    const c = deletingCategory;
    if (!c) return;
    setBusy(true);
    setError(null);
    try {
      if ((usageByCategory.get(c.id) ?? 0) > 0) {
        await reassignBookings(c.id, replacementId === UNCATEGORIZED ? null : replacementId);
      }
      await deleteSpendingCategory(c.id);
      setDeletingCategory(null);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteGroup() {
    const groupName = deletingGroup;
    if (!groupName) return;
    const group = groups.find((g) => g.groupName === groupName);
    setBusy(true);
    setError(null);
    try {
      for (const c of group?.categories ?? []) {
        if ((usageByCategory.get(c.id) ?? 0) > 0) await reassignBookings(c.id, null);
        await deleteSpendingCategory(c.id);
      }
      setDeletingGroup(null);
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(false);
    }
  }

  const deletingUsage = deletingCategory ? (usageByCategory.get(deletingCategory.id) ?? 0) : 0;
  const groupImpact = useMemo(() => {
    const group = groups.find((g) => g.groupName === deletingGroup);
    if (!group) return { categories: 0, bookings: 0 };
    return {
      categories: group.categories.length,
      bookings: group.categories.reduce((s, c) => s + (usageByCategory.get(c.id) ?? 0), 0),
    };
  }, [deletingGroup, groups, usageByCategory]);

  // Replacement options for a used-category delete: every OTHER category plus
  // the explicit Ohne Kategorie choice.
  const replacementOptions = useMemo(() => {
    const opts = [{ value: UNCATEGORIZED, label: t("spending.categories.uncategorized") }];
    for (const c of data.spendingCategories) {
      if (c.id !== deletingCategory?.id) {
        opts.push({ value: c.id, label: `${c.groupName} · ${c.name}` });
      }
    }
    return opts;
  }, [data.spendingCategories, deletingCategory, t]);

  return (
    <>
      <Modal open={open} onClose={onClose} maxWidthClass="max-w-3xl">
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{t("spending.categories.title")}</h2>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={addDefaults}>
                {t("spending.categories.addDefaults")}
              </Button>
              <Button size="sm" variant="primary" onClick={() => setAddingGroup(true)}>
                {t("spending.categories.newGroup")}
              </Button>
            </div>
          </div>
          {error && <p className="mt-2 text-sm text-negative">{error}</p>}

          {data.spendingCategories.length === 0 ? (
            <div className="mt-3">
              <p className="text-sm text-secondary">{t("spending.categories.empty")}</p>
              <Button className="mt-3" variant="primary" onClick={addDefaults}>
                {t("spending.categories.addDefaults")}
              </Button>
            </div>
          ) : (
            <>
              <Input
                className="mt-4"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("spending.categories.search")}
                aria-label={t("spending.categories.search")}
              />
              {/* Its own scroll area, so the header above and the "new group"
                  form below stay reachable however many groups exist. */}
              <div className="mt-3 max-h-[55vh] space-y-3 overflow-y-auto pr-1">
                {groups.map(({ groupName, categories }) => {
                  const isCollapsed = collapsed.has(groupName);
                  return (
                    <div key={groupName} className="rounded-control border border-subtle">
                      <div className="flex items-center gap-2 px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => toggleGroup(groupName)}
                          aria-expanded={!isCollapsed}
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-tertiary hover:bg-surface-hover"
                        >
                          <span aria-hidden className={isCollapsed ? "" : "rotate-90"}>
                            ▸
                          </span>
                        </button>
                        <input
                          defaultValue={groupName}
                          key={groupName}
                          onBlur={(e) => void renameGroup(groupName, categories, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") e.currentTarget.blur();
                          }}
                          aria-label={groupName}
                          className="flex-1 rounded-sm px-2 py-1 text-sm font-semibold outline-none hover:bg-surface-hover focus:border focus:border-strong"
                        />
                        <span className="shrink-0 text-xs text-tertiary">
                          {categories.length}
                        </span>
                        <RowActions>
                          <DeleteAction
                            label={t("spending.categories.deleteGroup")}
                            onClick={() => setDeletingGroup(groupName)}
                          />
                        </RowActions>
                      </div>
                      {!isCollapsed && (
                        <ul className="divide-y divide-subtle border-t border-subtle">
                          {categories.map((c) => {
                            const usage = usageByCategory.get(c.id) ?? 0;
                            return (
                              <li key={c.id} className="flex items-center gap-2 px-2 py-1.5">
                                {renamingId === c.id ? (
                                  <input
                                    autoFocus
                                    value={renameVal}
                                    onChange={(e) => setRenameVal(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") commitRename(c.id);
                                      if (e.key === "Escape") setRenamingId(null);
                                    }}
                                    onBlur={() => commitRename(c.id)}
                                    aria-label={t("spending.categories.rename")}
                                    className="flex-1 rounded-sm border border-strong bg-transparent px-2 py-1 text-sm outline-none focus:border-strong"
                                  />
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => startRename(c)}
                                    className="flex-1 truncate rounded-sm px-2 py-1 text-left text-sm hover:bg-surface-hover"
                                  >
                                    {c.name}
                                  </button>
                                )}
                                {usage > 0 && (
                                  <span className="shrink-0 text-xs text-tertiary">
                                    {t("spending.categories.usage", { count: usage })}
                                  </span>
                                )}
                                {taxPackEnabled && (
                                  <label className="flex shrink-0 items-center gap-1.5 text-xs text-tertiary">
                                    <input
                                      type="checkbox"
                                      checked={c.taxDeductible ?? false}
                                      onChange={() => void toggleTaxDeductible(c)}
                                    />
                                    {t("taxPack.deductibleLabel")}
                                  </label>
                                )}
                                <RowActions>
                                  <EditAction
                                    label={t("spending.categories.rename")}
                                    onClick={() => startRename(c)}
                                  />
                                  <DeleteAction
                                    label={t("spending.categories.delete")}
                                    onClick={() => requestDeleteCategory(c)}
                                  />
                                </RowActions>
                              </li>
                            );
                          })}
                          <li className="px-2 py-1">
                            {addingTo === groupName ? (
                              <input
                                autoFocus
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") commitNewCategory(groupName);
                                  if (e.key === "Escape") setAddingTo(null);
                                }}
                                onBlur={() => commitNewCategory(groupName)}
                                placeholder={t("spending.categories.namePlaceholder")}
                                aria-label={t("spending.categories.namePlaceholder")}
                                className="w-full rounded-sm border border-strong bg-transparent px-2 py-1 text-sm outline-none focus:border-strong"
                              />
                            ) : (
                              <button
                                type="button"
                                onClick={() => setAddingTo(groupName)}
                                className="w-full rounded-sm px-2 py-1 text-left text-sm font-medium text-brand hover:bg-surface-hover"
                              >
                                {t("spending.categories.newCategory")}
                              </button>
                            )}
                          </li>
                        </ul>
                      )}
                    </div>
                  );
                })}
                {groups.length === 0 && (
                  <p className="py-6 text-center text-sm text-tertiary">
                    {t("spending.categories.noMatch")}
                  </p>
                )}
              </div>
            </>
          )}

          {addingGroup && (
            <div className="mt-4 space-y-2 border-t border-subtle pt-3">
              <Field label={t("spending.categories.groupNamePlaceholder")}>
                <Input
                  autoFocus
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder={t("spending.categories.groupNamePlaceholder")}
                />
              </Field>
              <Field label={t("spending.categories.namePlaceholder")}>
                <Input
                  value={newGroupFirstCategory}
                  onChange={(e) => setNewGroupFirstCategory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitNewGroup();
                    if (e.key === "Escape") setAddingGroup(false);
                  }}
                  placeholder={t("spending.categories.namePlaceholder")}
                />
              </Field>
              <FormActions>
                <Button size="sm" variant="secondary" onClick={() => setAddingGroup(false)}>
                  {t("common.cancel")}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!newGroupName.trim() || !newGroupFirstCategory.trim()}
                  onClick={() => void commitNewGroup()}
                >
                  {t("spending.categories.add")}
                </Button>
              </FormActions>
            </div>
          )}
        </Card>
      </Modal>

      {/* An unused category deletes with a plain confirm; a used one demands a
          replacement so its bookings are moved, never orphaned (Audit §4.6). */}
      <Modal
        open={deletingCategory !== null && deletingUsage > 0}
        onClose={() => setDeletingCategory(null)}
        maxWidthClass="max-w-md"
      >
        <Card>
          <h2 className="text-lg font-semibold">{t("spending.categories.delete")}</h2>
          <p className="mt-2 text-sm text-secondary">
            {t("spending.categories.deleteUsedMsg", {
              name: deletingCategory?.name ?? "",
              count: deletingUsage,
            })}
          </p>
          <Field className="mt-4" label={t("spending.categories.replacementLabel")}>
            <SelectMenu
              className="mt-1 w-full"
              ariaLabel={t("spending.categories.replacementLabel")}
              value={replacementId}
              onChange={setReplacementId}
              searchable
              options={replacementOptions}
            />
          </Field>
          <FormActions error={error}>
            <Button variant="secondary" onClick={() => setDeletingCategory(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => void confirmDeleteCategory()}>
              {t("spending.categories.delete")}
            </Button>
          </FormActions>
        </Card>
      </Modal>

      <ConfirmDialog
        open={deletingCategory !== null && deletingUsage === 0}
        title={t("spending.categories.delete")}
        message={
          deletingCategory
            ? t("spending.categories.deleteConfirm", { name: deletingCategory.name })
            : undefined
        }
        confirmLabel={t("spending.categories.delete")}
        onConfirm={() => void confirmDeleteCategory()}
        onCancel={() => setDeletingCategory(null)}
      />

      <ConfirmDialog
        open={deletingGroup !== null}
        title={t("spending.categories.deleteGroup")}
        message={
          deletingGroup
            ? `${t("spending.categories.deleteGroupConfirm", { name: deletingGroup })} ${t(
                "spending.categories.deleteGroupImpact",
                { categories: groupImpact.categories, bookings: groupImpact.bookings },
              )}`
            : undefined
        }
        confirmLabel={t("spending.categories.deleteGroup")}
        onConfirm={() => void confirmDeleteGroup()}
        onCancel={() => setDeletingGroup(null)}
      />
    </>
  );
}
