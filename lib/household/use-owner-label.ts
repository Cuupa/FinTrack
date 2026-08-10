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
  const { members, memberEmails, sharingActive } = useHousehold();
  const { t } = useI18n();

  const shared = ownershipVisible(sharingActive, members.length);

  const label = useCallback(
    (ownerId: string | null | undefined): string | null =>
      shared
        ? resolveOwnerName(ownerId, {
            currentUserId: user?.id ?? null,
            memberEmails,
            you: t("household.you"),
            fallback: t("household.roleMember"),
          })
        : null,
    [shared, user?.id, memberEmails, t],
  );

  return useMemo(() => ({ shared, label }), [shared, label]);
}
