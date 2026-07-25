"use client";

// Manage spending categories (ROADMAP #2, flag `spending`): a flat
// group_name + name taxonomy. Categories are grouped visually by groupName;
// renaming or deleting a group applies to every category that shares it.
// Mirrors components/assets/tag-groups-manager.tsx's CRUD-list pattern
// (that component is hardwired to useTags() and not itself reusable).

import { useMemo, useState } from "react";
import { usePortfolio } from "@/lib/portfolio/portfolio-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useFeatureFlag } from "@/lib/flags/flags-context";
import { isStorageFullError } from "@/lib/store/errors";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button, Card } from "@/components/ui/primitives";
import type { SpendingCategory } from "@/lib/types";

const inputCls =
  "flex-1 rounded-sm border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

export function CategoryManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, addSpendingCategory, updateSpendingCategory, deleteSpendingCategory } =
    usePortfolio();
  const { t } = useI18n();
  const taxPackEnabled = useFeatureFlag("taxPack");

  const [error, setError] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [deletingCategory, setDeletingCategory] = useState<SpendingCategory | null>(null);
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupFirstCategory, setNewGroupFirstCategory] = useState("");

  function reportError(err: unknown) {
    setError(isStorageFullError(err) ? t("common.storageFull") : t("spending.categories.actionError"));
  }

  const groups = useMemo(() => {
    const byGroup = new Map<string, SpendingCategory[]>();
    for (const c of data.spendingCategories) {
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
  }, [data.spendingCategories]);

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
    setNewGroupName("");
    setNewGroupFirstCategory("");
    setAddingGroup(false);
    if (!groupName || !name) return;
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

  async function deleteGroup(categories: SpendingCategory[]) {
    try {
      for (const c of categories) {
        await deleteSpendingCategory(c.id);
      }
    } catch (err) {
      reportError(err);
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} maxWidthClass="max-w-lg">
        <Card>
          <h2 className="text-lg font-semibold">{t("spending.categories.title")}</h2>
          {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}

          {groups.length === 0 ? (
            <p className="mt-3 text-sm text-zinc-500">{t("spending.categories.empty")}</p>
          ) : (
            <div className="mt-3 space-y-4">
              {groups.map(({ groupName, categories }) => (
                <div key={groupName}>
                  <div className="flex items-center gap-2">
                    <input
                      defaultValue={groupName}
                      onBlur={(e) => void renameGroup(groupName, categories, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                      }}
                      className="flex-1 rounded-sm px-2 py-1 text-sm font-semibold outline-none hover:bg-zinc-100 focus:border focus:border-zinc-500 dark:hover:bg-zinc-800"
                    />
                    <Button size="sm" variant="danger" onClick={() => setDeletingGroup(groupName)}>
                      {t("spending.categories.deleteGroup")}
                    </Button>
                  </div>
                  <ul className="mt-1 divide-y divide-zinc-100 pl-2 dark:divide-zinc-800/60">
                    {categories.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 py-1.5">
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
                            className={inputCls}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => startRename(c)}
                            className="flex-1 truncate rounded-sm px-2 py-1 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                          >
                            {c.name}
                          </button>
                        )}
                        {taxPackEnabled && (
                          <label className="flex shrink-0 items-center gap-1.5 text-xs text-zinc-500">
                            <input
                              type="checkbox"
                              checked={c.taxDeductible ?? false}
                              onChange={() => void toggleTaxDeductible(c)}
                            />
                            {t("taxPack.deductibleLabel")}
                          </label>
                        )}
                        <Button size="sm" variant="danger" onClick={() => setDeletingCategory(c)}>
                          {t("spending.categories.delete")}
                        </Button>
                      </li>
                    ))}
                  </ul>
                  <div className="pl-2">
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
                        className={`${inputCls} mt-1 w-full`}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAddingTo(groupName)}
                        className="mt-1 w-full rounded-sm px-2 py-1 text-left text-sm font-medium text-emerald-600 hover:bg-zinc-100 dark:text-emerald-400 dark:hover:bg-zinc-800"
                      >
                        {t("spending.categories.newCategory")}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            {addingGroup ? (
              <div className="space-y-2">
                <input
                  autoFocus
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder={t("spending.categories.groupNamePlaceholder")}
                  aria-label={t("spending.categories.groupNamePlaceholder")}
                  className={`${inputCls} w-full`}
                />
                <input
                  value={newGroupFirstCategory}
                  onChange={(e) => setNewGroupFirstCategory(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void commitNewGroup();
                    if (e.key === "Escape") setAddingGroup(false);
                  }}
                  placeholder={t("spending.categories.namePlaceholder")}
                  aria-label={t("spending.categories.namePlaceholder")}
                  className={`${inputCls} w-full`}
                />
                <Button
                  size="sm"
                  variant="primary"
                  disabled={!newGroupName.trim() || !newGroupFirstCategory.trim()}
                  onClick={() => void commitNewGroup()}
                >
                  {t("spending.categories.add")}
                </Button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingGroup(true)}
                className="w-full rounded-sm px-2 py-1.5 text-left text-sm font-medium text-emerald-600 hover:bg-zinc-100 dark:text-emerald-400 dark:hover:bg-zinc-800"
              >
                {t("spending.categories.newGroup")}
              </button>
            )}
          </div>
        </Card>
      </Modal>

      <ConfirmDialog
        open={deletingCategory !== null}
        title={t("spending.categories.delete")}
        message={
          deletingCategory
            ? t("spending.categories.deleteConfirm", { name: deletingCategory.name })
            : undefined
        }
        confirmLabel={t("spending.categories.delete")}
        onConfirm={() => {
          const c = deletingCategory;
          setDeletingCategory(null);
          if (c) void deleteSpendingCategory(c.id);
        }}
        onCancel={() => setDeletingCategory(null)}
      />

      <ConfirmDialog
        open={deletingGroup !== null}
        title={t("spending.categories.deleteGroup")}
        message={deletingGroup ? t("spending.categories.deleteGroupConfirm", { name: deletingGroup }) : undefined}
        confirmLabel={t("spending.categories.deleteGroup")}
        onConfirm={() => {
          const groupName = deletingGroup;
          setDeletingGroup(null);
          const group = groups.find((g) => g.groupName === groupName);
          if (group) void deleteGroup(group.categories);
        }}
        onCancel={() => setDeletingGroup(null)}
      />
    </>
  );
}
