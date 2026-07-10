"use client";

// Manage tag groups: rename in place, delete (with confirmation, since it
// purges every assignment in that group across all assets), or add a new one.
// Mirrors the portfolio picker's inline-rename pattern.

import { useState } from "react";
import { useTags, type TagGroup } from "@/lib/tags/tags-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Button, Card } from "@/components/ui/primitives";

export function TagGroupsManager({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { groups, renameGroup, deleteGroup, createGroup } = useTags();
  const { t } = useI18n();

  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [deleting, setDeleting] = useState<TagGroup | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  function startRename(group: TagGroup) {
    setRenaming(group.id);
    setRenameVal(group.name);
  }

  function commitRename(groupId: string) {
    const name = renameVal.trim();
    if (name) renameGroup(groupId, name);
    setRenaming(null);
  }

  function commitNew() {
    const name = newName.trim();
    if (name) createGroup(name);
    setNewName("");
    setAdding(false);
  }

  return (
    <>
      <Modal open={open} onClose={onClose} maxWidthClass="max-w-md">
        <Card>
          <h2 className="text-lg font-semibold">{t("tags.manageGroups")}</h2>

          {groups.length > 0 && (
            <ul className="mt-3 divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {groups.map((group) => (
                <li key={group.id} className="flex items-center gap-2 py-2">
                  {renaming === group.id ? (
                    <input
                      autoFocus
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(group.id);
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      onBlur={() => commitRename(group.id)}
                      className="flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => startRename(group)}
                      className="flex-1 truncate rounded-md px-2 py-1 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    >
                      {group.name}
                    </button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    onClick={() => setDeleting(group)}
                  >
                    {t("tags.deleteGroup")}
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            {adding ? (
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitNew();
                  if (e.key === "Escape") setAdding(false);
                }}
                onBlur={commitNew}
                placeholder={t("tags.groupNamePlaceholder")}
                aria-label={t("tags.groupNamePlaceholder")}
                className="w-full rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700"
              />
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="w-full rounded-md px-2 py-1.5 text-left text-sm font-medium text-emerald-600 hover:bg-zinc-100 dark:text-emerald-400 dark:hover:bg-zinc-800"
              >
                {t("tags.newGroup")}
              </button>
            )}
          </div>
        </Card>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title={t("tags.deleteGroup")}
        message={deleting ? t("tags.deleteGroupConfirm", { name: deleting.name }) : undefined}
        confirmLabel={t("tags.deleteGroup")}
        onConfirm={() => {
          if (deleting) deleteGroup(deleting.id);
          setDeleting(null);
        }}
        onCancel={() => setDeleting(null)}
      />
    </>
  );
}
