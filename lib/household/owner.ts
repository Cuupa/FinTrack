// Who, inside a household, owns a portfolio / account / asset. Pure so the
// display rule is unit-tested; the hook in `use-owner-label.ts` wires it to the
// household + auth contexts.

/**
 * Ownership is only worth showing when the household actually shares data
 * across more than one person: a solo user (or a paused/unshared household)
 * owns everything, so the label would be noise on every row.
 */
export function ownershipVisible(sharingActive: boolean, memberCount: number): boolean {
  return sharingActive && memberCount > 1;
}

/**
 * The display name for an owner id: the current user reads as "you", a peer as
 * their display name (falling back to email, then the generic member label),
 * and a missing owner as null (guest data). A real person's name beats their
 * email address wherever we know it.
 */
export function resolveOwnerName(
  ownerId: string | null | undefined,
  ctx: {
    currentUserId: string | null;
    memberNames?: Record<string, string>;
    memberEmails: Record<string, string>;
    you: string;
    fallback: string;
  },
): string | null {
  if (!ownerId) return null;
  if (ownerId === ctx.currentUserId) return ctx.you;
  return ctx.memberNames?.[ownerId] ?? ctx.memberEmails[ownerId] ?? ctx.fallback;
}
