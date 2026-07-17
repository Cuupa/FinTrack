"use client";

// Per-asset key-value tags shown as coloured "Group: value" badges (colour
// keyed off the value, matching the asset's slice in the Analysis "Custom"
// pie for that group). Add via the group picker + value input; remove via
// the x on a badge. Groups themselves (rename/delete) are managed through the
// "Manage groups" modal. Stored client-side via the tags context.

import { useState } from "react";
import { useTags } from "@/lib/tags/tags-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { isStorageFullError } from "@/lib/store/errors";
import { colorForLabel } from "@/lib/colors";
import { Button } from "@/components/ui/primitives";
import { SelectMenu } from "@/components/ui/select-menu";
import { AssetTagsTour, TourReplayButton } from "@/components/onboarding/page-tours";
import { TagGroupsManager } from "./tag-groups-manager";

export function AssetTags({ assetId }: { assetId: string }) {
  const { groups, entriesFor, valuesInGroup, addValue, removeValue, createGroup } = useTags();
  const { t } = useI18n();

  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [value, setValue] = useState("");
  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [managing, setManaging] = useState(false);
  const [tourReplay, setTourReplay] = useState(0);
  const [error, setError] = useState<string | null>(null);

  function reportError(err: unknown) {
    setError(isStorageFullError(err) ? t("common.storageFull") : t("tags.actionError"));
  }

  const entries = entriesFor(assetId);
  // Derive rather than sync via effect: fall back to the first group once the
  // selection is empty or points at a group that no longer exists.
  const groupId = groups.some((g) => g.id === selectedGroupId)
    ? selectedGroupId
    : (groups[0]?.id ?? "");

  async function commitNewGroup() {
    const name = newGroupName.trim();
    setNewGroupName("");
    setAddingGroup(false);
    if (!name) return;
    try {
      const id = await createGroup(name);
      if (id) setSelectedGroupId(id);
    } catch (err) {
      reportError(err);
    }
  }

  async function commitValue() {
    const v = value.trim();
    setValue("");
    if (!v || !groupId) return;
    try {
      await addValue(assetId, groupId, v);
    } catch (err) {
      reportError(err);
    }
  }

  const datalistId = `asset-tag-values-${assetId}`;

  return (
    <div data-tour="asset-tags" className="space-y-2">
      <AssetTagsTour restartToken={tourReplay} />
      <h3 className="flex items-center gap-1.5 text-sm font-semibold">
        {t("tags.title")}
        <TourReplayButton onClick={() => setTourReplay((n) => n + 1)} />
      </h3>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {entries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {entries.flatMap(({ group, values }) =>
            values.map((v) => (
              <span
                key={`${group.id}:${v}`}
                className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-white"
                style={{ backgroundColor: colorForLabel(v) }}
              >
                {group.name}: {v}
                <button
                  type="button"
                  onClick={() => removeValue(assetId, group.id, v).catch(reportError)}
                  aria-label={`Remove tag ${group.name}: ${v}`}
                  className="text-white/80 hover:text-white"
                >
                  ✕
                </button>
              </span>
            )),
          )}
        </div>
      )}

      <div data-tour="asset-tags-add" className="flex flex-wrap items-center gap-2">
        {groups.length > 0 && (
          <>
            <SelectMenu
              value={groupId}
              ariaLabel={t("tags.group")}
              onChange={setSelectedGroupId}
              className="w-36"
              options={groups.map((g) => ({ value: g.id, label: g.name }))}
              footer={(close) => (
                <button
                  type="button"
                  onClick={() => {
                    close();
                    setAddingGroup(true);
                  }}
                  className="w-full rounded-md px-2 py-1.5 text-left text-sm font-medium text-emerald-600 hover:bg-zinc-100 dark:text-emerald-400 dark:hover:bg-zinc-800"
                >
                  {t("tags.newGroup")}
                </button>
              )}
            />
            <input
              list={datalistId}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitValue();
              }}
              placeholder={t("tags.valuePlaceholder")}
              aria-label={t("tags.valuePlaceholder")}
              className="w-32 rounded-full border border-zinc-300 bg-transparent px-2.5 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700"
            />
            <datalist id={datalistId}>
              {valuesInGroup(groupId).map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
            <Button type="button" size="sm" variant="secondary" onClick={commitValue}>
              {t("tags.addTag")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setManaging(true)}>
              {t("tags.manageGroups")}
            </Button>
          </>
        )}

        {addingGroup && (
          <input
            autoFocus
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitNewGroup();
              if (e.key === "Escape") {
                setNewGroupName("");
                setAddingGroup(false);
              }
            }}
            onBlur={commitNewGroup}
            placeholder={t("tags.groupNamePlaceholder")}
            aria-label={t("tags.groupNamePlaceholder")}
            className="w-36 rounded-full border border-zinc-300 bg-transparent px-2.5 py-1 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700"
          />
        )}

        {groups.length === 0 && !addingGroup && (
          <button
            type="button"
            onClick={() => setAddingGroup(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-600 dark:hover:text-zinc-300"
          >
            {t("tags.newGroup")}
          </button>
        )}
      </div>

      <TagGroupsManager open={managing} onClose={() => setManaging(false)} />
    </div>
  );
}
