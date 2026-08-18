"use client";

import { useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth/auth-context";
import { useHousehold } from "@/lib/household/household-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { ownershipVisible, resolveOwnerName } from "./owner";

/**
 * `shared` gates every owner surface: an Owner column appears only in a
 * household that is actively sharing across more than one member. `label`
 * resolves an owner id to a display name (see {@link resolveOwnerName}).
 */
export function useOwnerLabel() {
  const { user } = useAuth();
  const { members, memberEmails, memberNames, sharingActive } = useHousehold();
  const { t } = useI18n();

  const shared = ownershipVisible(sharingActive, members.length);

  // `isShared` marks a row owned by the household itself (joint): it reads as
  // "Gemeinsam" regardless of which member created it (the row still carries a
  // creator in `ownerId`).
  const label = useCallback(
    (ownerId: string | null | undefined, isShared = false): string | null => {
      if (!shared) return null;
      if (isShared) return t("household.joint");
      return resolveOwnerName(ownerId, {
        currentUserId: user?.id ?? null,
        memberNames,
        memberEmails,
        you: t("household.you"),
        fallback: t("household.roleMember"),
      });
    },
    [shared, user?.id, memberNames, memberEmails, t],
  );

  return useMemo(() => ({ shared, label }), [shared, label]);
}
