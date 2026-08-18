"use client";

// Owner picker for a household-ownable entity (account or portfolio). Lists
// every household member plus a "Gemeinsam" (joint) option that assigns the
// row to the household itself. Self-gating: renders nothing outside a sharing
// household, so callers can drop it in unconditionally and it only appears when
// there is actually someone to share with (the same gate as the owner column,
// `useOwnerLabel().shared`).

import { useAuth } from "@/lib/auth/auth-context";
import { useHousehold } from "@/lib/household/household-context";
import { useOwnerLabel } from "@/lib/household/use-owner-label";
import { useI18n } from "@/lib/i18n/i18n-context";
import { SelectMenu } from "@/components/ui/select-menu";
import type { OwnerTarget } from "@/lib/store/types";

/** Sentinel value for the joint option; not a real user id. */
const JOINT = "__household__";

export function OwnerSelect({
  value,
  onChange,
  ariaLabel,
  className,
}: {
  /** The entity's current owner state. */
  value: { ownerId?: string | null; shared?: boolean };
  onChange: (target: OwnerTarget) => void;
  ariaLabel: string;
  className?: string;
}) {
  const { user } = useAuth();
  const { household, members, memberEmails, memberNames } = useHousehold();
  const { shared } = useOwnerLabel();
  const { t } = useI18n();

  // Nothing to reassign to outside a sharing household.
  if (!shared || !household) return null;

  const selected = value.shared ? JOINT : (value.ownerId ?? user?.id ?? "");
  const options = [
    ...members.map((m) => ({
      value: m.userId,
      label:
        m.userId === user?.id
          ? t("household.you")
          : (memberNames[m.userId] ?? memberEmails[m.userId] ?? t("household.roleMember")),
    })),
    { value: JOINT, label: t("household.joint") },
  ];

  return (
    <SelectMenu
      className={className}
      ariaLabel={ariaLabel}
      value={selected}
      onChange={(v) =>
        onChange(
          v === JOINT
            ? { kind: "household", householdId: household.id }
            : { kind: "member", userId: v },
        )
      }
      options={options}
    />
  );
}

/** Whether the owner picker will render for the current household state. Lets a
 *  parent decide whether to show the surrounding labelled field at all. */
export function useOwnerSelectVisible(): boolean {
  const { household } = useHousehold();
  const { shared } = useOwnerLabel();
  return shared && !!household;
}
