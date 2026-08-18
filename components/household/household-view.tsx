"use client";

// Household collaboration (ROADMAP item #13, flag `household`): create or
// join a household, invite/accept members, manage roles. Registered-mode
// only -- household-context.tsx has no LocalStore/OfflineStore equivalent,
// same as billing.
//
// Pro gating is per SUB-SURFACE, not per page (family plan, migration 0101:
// one Pro subscription per household, members free). Forming or growing a
// household -- the create card and the invite card -- is what Pro buys, so
// only those two sit behind <ProGate>. Seeing your invitations, your household,
// its members and the button to leave stays open to everyone: a free partner
// who cannot accept an invitation makes a family plan pointless, and a member
// locked out of "leave household" would be stuck in it.

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth/auth-context";
import { useHousehold } from "@/lib/household/household-context";
import { useI18n } from "@/lib/i18n/i18n-context";
import { useFeature, useFeatureFlag, usePlanLimit } from "@/lib/flags/flags-context";
import { ProGate } from "@/components/billing/pro-teaser";
import { atLimit } from "@/lib/billing/limits";
import { Button, Card } from "@/components/ui/primitives";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { HouseholdInvite, HouseholdMember } from "@/lib/types";

const inputCls =
  "flex-1 rounded-sm border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700";

export function HouseholdView() {
  const { user } = useAuth();
  const {
    household,
    members,
    memberEmails,
    memberNames,
    sentInvites,
    receivedInvites,
    loading,
    createHousehold,
    renameHousehold,
    inviteMember,
    revokeInvite,
    acceptInvite,
    declineInvite,
    removeMember,
    leaveHousehold,
    sharingActive,
    extraSeats,
    seatPriceDisplay,
    addSeat,
  } = useHousehold();
  const { t } = useI18n();
  // `locked` = the flag is visible but this user's plan doesn't unlock it.
  const { locked } = useFeature("household");
  const billingEnabled = useFeatureFlag("billing");
  const { limit: planMemberLimit } = usePlanLimit("householdMembers");

  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<HouseholdMember | null>(null);
  const [busy, setBusy] = useState(false);

  const isOwner = members.some((m) => m.userId === user?.id && m.role === "owner");
  // A pending invitation already reserves its seat, otherwise the cap could be
  // walked past by sending several at once.
  const memberLimit = (planMemberLimit ?? 2) + extraSeats;
  const seatsCapped = atLimit(memberLimit, members.length + sentInvites.length);

  async function run(action: () => Promise<void>) {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch {
      setError(t("household.actionError"));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <Skeleton className="h-6 w-40" />
        <div className="mt-4 space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {receivedInvites.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold">{t("household.invitesReceived")}</h2>
          <ul className="mt-3 space-y-2">
            {receivedInvites.map((invite: HouseholdInvite) => (
              <li
                key={invite.id}
                className="flex items-center justify-between gap-3 rounded-sm border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
              >
                <span>{t("household.invitedYou")}</span>
                <span className="flex gap-2">
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => run(() => acceptInvite(invite))}>
                    {t("household.accept")}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => declineInvite(invite.id))}>
                    {t("household.decline")}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!household ? (
        <ProGate locked={locked} feature="household">
        <Card data-tour="household-create">
          <h2 className="text-lg font-semibold">{t("household.createTitle")}</h2>
          <p className="mt-1 text-sm text-zinc-500">{t("household.createSubtitle")}</p>
          <div className="mt-3 flex gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("household.namePlaceholder")}
              aria-label={t("household.namePlaceholder")}
              className={inputCls}
            />
            <Button
              variant="primary"
              disabled={busy || !newName.trim()}
              onClick={() =>
                run(async () => {
                  await createHousehold(newName.trim());
                  setNewName("");
                })
              }
            >
              {t("household.create")}
            </Button>
          </div>
        </Card>
        </ProGate>
      ) : (
        <>
          <Card data-tour="household-members">
            <div className="flex items-center justify-between gap-3">
              <input
                defaultValue={household.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== household.name) void run(() => renameHousehold(v));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                aria-label={t("household.namePlaceholder")}
                disabled={!isOwner}
                className="flex-1 rounded-sm px-2 py-1 text-lg font-semibold outline-none hover:bg-zinc-100 focus:border focus:border-zinc-500 disabled:hover:bg-transparent dark:hover:bg-zinc-800"
              />
              <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirmLeave(true)}>
                {t("household.leave")}
              </Button>
            </div>

            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-zinc-400">
              {t("household.members")}
            </h3>
            <ul className="mt-2 divide-y divide-zinc-100 dark:divide-zinc-800/60">
              {members.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate">
                    {memberNames[m.userId] ?? memberEmails[m.userId] ?? m.userId}
                    {m.userId === user?.id && ` (${t("household.you")})`}
                    {" · "}
                    {t(m.role === "owner" ? "household.roleOwner" : "household.roleMember")}
                  </span>
                  {isOwner && m.userId !== user?.id && (
                    <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirmRemove(m)}>
                      {t("household.remove")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>

            {/* Sharing collapsed back to self-ownership because nobody here
                carries the plan. Without this the two members would simply see
                their own data and think the household never worked. */}
            {!sharingActive && (
              <p className="mt-4 border-t border-zinc-200 pt-3 text-sm text-amber-700 dark:border-zinc-800 dark:text-amber-500">
                {t("household.sharingPaused")}
                {billingEnabled && (
                  <>
                    {" "}
                    <Link
                      href="/pricing"
                      className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
                    >
                      {t("common.proFeatureUpgrade")}
                    </Link>
                  </>
                )}
              </p>
            )}
          </Card>

          <ProGate locked={locked} feature="household">
          <Card data-tour="household-invite">
            <h2 className="text-lg font-semibold">{t("household.inviteTitle")}</h2>
            <div className="mt-3 flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={t("household.emailPlaceholder")}
                aria-label={t("household.emailPlaceholder")}
                className={inputCls}
              />
              <Button
                variant="primary"
                disabled={busy || !inviteEmail.trim() || seatsCapped}
                onClick={() =>
                  run(async () => {
                    await inviteMember(inviteEmail.trim());
                    setInviteEmail("");
                  })
                }
              >
                {t("household.invite")}
              </Button>
            </div>
            {seatsCapped && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
                {t("household.limitHint", { n: String(memberLimit), price: seatPriceDisplay ?? "1,99 €" })}
                {billingEnabled && (
                  <>
                    {" "}
                    <Link
                      href="/pricing"
                      className="font-medium text-emerald-600 hover:underline dark:text-emerald-400"
                    >
                      {t("common.proFeatureUpgrade")}
                    </Link>
                  </>
                )}
                {isOwner && billingEnabled && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(addSeat)}>
                    {t("household.addSeat", { price: seatPriceDisplay ?? "1,99 €" })}
                  </Button>
                )}
              </div>
            )}
            {sentInvites.length > 0 && (
              <ul className="mt-4 space-y-2">
                {sentInvites.map((invite) => (
                  <li
                    key={invite.id}
                    className="flex items-center justify-between gap-3 rounded-sm border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800"
                  >
                    <span className="truncate">{invite.email}</span>
                    <Button size="sm" variant="secondary" disabled={busy} onClick={() => run(() => revokeInvite(invite.id))}>
                      {t("household.revoke")}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          </ProGate>
        </>
      )}

      <ConfirmDialog
        open={confirmLeave}
        title={t("household.leave")}
        message={t("household.leaveConfirm")}
        confirmLabel={t("household.leave")}
        onConfirm={() => {
          setConfirmLeave(false);
          void run(() => leaveHousehold());
        }}
        onCancel={() => setConfirmLeave(false)}
      />
      <ConfirmDialog
        open={confirmRemove !== null}
        title={t("household.remove")}
        message={
          confirmRemove
            ? t("household.removeConfirm", { email: memberEmails[confirmRemove.userId] ?? confirmRemove.userId })
            : undefined
        }
        confirmLabel={t("household.remove")}
        onConfirm={() => {
          const m = confirmRemove;
          setConfirmRemove(null);
          if (m) void run(() => removeMember(m.id));
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}
