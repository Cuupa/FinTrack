"use client";

// Household collaboration (ROADMAP item #13, flag `household`). Household
// membership is per-user, not per-portfolio, so this is its own context --
// mounted parallel to BillingProvider, not folded into PortfolioData -- and
// like billing it talks to Supabase directly with no LocalStore/OfflineStore
// equivalent: sharing another registered user's data is inherently a
// registered-mode-only feature (a guest has no account for a peer to join).
//
// v1 caps membership at one household per user (enforced in the DB, see
// migration 0091_households.sql), so this context exposes at most one
// household, not a list to switch between.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getSupabaseClient, isSupabaseConfigured } from "../supabase/client";
import { useAuth } from "../auth/auth-context";
import type { Household, HouseholdInvite, HouseholdMember, HouseholdRole } from "../types";

interface HouseholdRow {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
}
function householdFromRow(r: HouseholdRow): Household {
  return { id: r.id, name: r.name, createdBy: r.created_by, createdAt: r.created_at };
}

interface MemberRow {
  id: string;
  household_id: string;
  user_id: string;
  role: HouseholdRole;
  joined_at: string;
}
function memberFromRow(r: MemberRow): HouseholdMember {
  return { id: r.id, householdId: r.household_id, userId: r.user_id, role: r.role, joinedAt: r.joined_at };
}

interface InviteRow {
  id: string;
  household_id: string;
  email: string;
  invited_by: string;
  role: HouseholdRole;
  status: HouseholdInvite["status"];
  created_at: string;
}
function inviteFromRow(r: InviteRow): HouseholdInvite {
  return {
    id: r.id,
    householdId: r.household_id,
    email: r.email,
    invitedBy: r.invited_by,
    role: r.role,
    status: r.status,
    createdAt: r.created_at,
  };
}

interface HouseholdState {
  userId: string;
  household: Household | null;
  members: HouseholdMember[];
  memberEmails: Record<string, string>;
  /** Display name per member (profile name or OAuth metadata), when known. */
  memberNames: Record<string, string>;
  /** Invites sent by this household, pending. */
  sentInvites: HouseholdInvite[];
  /** Invites addressed to the signed-in user's own email, pending. */
  receivedInvites: HouseholdInvite[];
  /**
   * Whether RLS is actually sharing data across this household right now
   * (`household_sharing_active()`, migration 0101). False when the `household`
   * flag is tiered to Pro and nobody here has it: sharing then collapses back
   * to self-ownership, which is invisible from the client otherwise, so the
   * view can say so instead of showing two silently disconnected datasets.
   * True for anyone not in a household, and on a DB predating the migration.
   */
  sharingActive: boolean;
  extraSeats: number;
  seatPriceDisplay: string | null;
}

interface HouseholdContextValue extends Omit<HouseholdState, "userId"> {
  loading: boolean;
  createHousehold(name: string): Promise<void>;
  renameHousehold(name: string): Promise<void>;
  inviteMember(email: string): Promise<void>;
  revokeInvite(inviteId: string): Promise<void>;
  acceptInvite(invite: HouseholdInvite): Promise<void>;
  declineInvite(inviteId: string): Promise<void>;
  removeMember(memberId: string): Promise<void>;
  leaveHousehold(): Promise<void>;
  refresh(): Promise<void>;
  addSeat(): Promise<void>;
}

const EMPTY_STATE: Omit<HouseholdState, "userId"> = {
  household: null,
  members: [],
  memberEmails: {},
  memberNames: {},
  sentInvites: [],
  receivedInvites: [],
  sharingActive: true,
  extraSeats: 0,
  seatPriceDisplay: null,
};

const HouseholdContext = createContext<HouseholdContextValue>({
  ...EMPTY_STATE,
  loading: false,
  createHousehold: async () => {},
  renameHousehold: async () => {},
  inviteMember: async () => {},
  revokeInvite: async () => {},
  acceptInvite: async () => {},
  declineInvite: async () => {},
  removeMember: async () => {},
  leaveHousehold: async () => {},
  refresh: async () => {},
  addSeat: async () => {},
});

async function loadState(userId: string, email: string | null): Promise<Omit<HouseholdState, "userId">> {
  const supabase = getSupabaseClient();
  if (!supabase) return EMPTY_STATE;

  const [membersRes, emailsRes, receivedRes, seatRes, configRes] = await Promise.all([
    supabase
      .from("household_members")
      .select("id, household_id, user_id, role, joined_at")
      .returns<MemberRow[]>(),
    supabase.rpc("household_member_emails"),
    // Guarded by a never-matching filter (rather than branching promise
    // types) when there's no signed-in email yet.
    supabase
      .from("household_invites")
      .select("id, household_id, email, invited_by, role, status, created_at")
      .ilike("email", email ?? "")
      .eq("status", "pending")
      .returns<InviteRow[]>(),
    supabase.from("household_seat_addons").select("quantity, status").maybeSingle<{ quantity: number; status: string }>(),
    supabase.from("billing_config").select("household_member_price_display").eq("id", 1).maybeSingle<{ household_member_price_display: string | null }>(),
  ]);

  const members = (membersRes.data ?? []).map(memberFromRow);
  const memberEmails: Record<string, string> = {};
  const memberNames: Record<string, string> = {};
  const emailRows = (emailsRes.data ?? []) as {
    user_id: string;
    email: string;
    display_name?: string | null;
  }[];
  for (const row of emailRows) {
    memberEmails[row.user_id] = row.email;
    if (row.display_name) memberNames[row.user_id] = row.display_name;
  }
  const receivedInvites = (receivedRes.data ?? []).map(inviteFromRow);

  const own = members.find((m) => m.userId === userId);
  if (!own) return { ...EMPTY_STATE, receivedInvites, seatPriceDisplay: configRes.data?.household_member_price_display ?? null };

  const [householdRes, sentInvitesRes, sharingRes] = await Promise.all([
    supabase.from("households").select("id, name, created_by, created_at").eq("id", own.householdId).maybeSingle<HouseholdRow>(),
    supabase
      .from("household_invites")
      .select("id, household_id, email, invited_by, role, status, created_at")
      .eq("household_id", own.householdId)
      .eq("status", "pending")
      .returns<InviteRow[]>(),
    supabase.rpc("household_sharing_active"),
  ]);

  return {
    household: householdRes.data ? householdFromRow(householdRes.data) : null,
    members,
    memberEmails,
    memberNames,
    sentInvites: (sentInvitesRes.data ?? []).map(inviteFromRow),
    receivedInvites,
    // Anything other than an explicit `false` counts as sharing (a DB that
    // predates migration 0101 has no such function and errors) — the same
    // fail-open direction the flag and limit resolution take.
    sharingActive: sharingRes.data !== false,
    extraSeats: seatRes.data?.status === "active" || seatRes.data?.status === "trialing" ? seatRes.data.quantity : 0,
    seatPriceDisplay: configRes.data?.household_member_price_display ?? null,
  };
}

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const email = user?.email ?? null;
  const [loaded, setLoaded] = useState<HouseholdState | null>(null);

  // Fetch + setState both live inside the promise continuation (never
  // synchronously in the effect body), same shape as BillingProvider's
  // `fetchSubscription(...).then(...)`.
  useEffect(() => {
    if (!userId || !isSupabaseConfigured) return;
    let active = true;
    loadState(userId, email).then((state) => {
      if (active) setLoaded({ userId, ...state });
    });
    return () => {
      active = false;
    };
  }, [userId, email]);

  const load = useCallback(async () => {
    if (!userId || !isSupabaseConfigured) return;
    const state = await loadState(userId, email);
    setLoaded({ userId, ...state });
  }, [userId, email]);

  const createHousehold = useCallback(
    async (name: string) => {
      const supabase = getSupabaseClient();
      if (!supabase || !userId) return;
      const { data, error } = await supabase
        .from("households")
        .insert({ name, created_by: userId })
        .select("id")
        .single<{ id: string }>();
      if (error) throw error;
      const { error: memberErr } = await supabase
        .from("household_members")
        .insert({ household_id: data.id, user_id: userId, role: "owner" });
      if (memberErr) throw memberErr;
      await load();
    },
    [userId, load],
  );

  const renameHousehold = useCallback(
    async (name: string) => {
      const supabase = getSupabaseClient();
      if (!supabase || !loaded?.household) return;
      const { error } = await supabase.from("households").update({ name }).eq("id", loaded.household.id);
      if (error) throw error;
      await load();
    },
    [loaded, load],
  );

  const inviteMember = useCallback(
    async (inviteEmail: string) => {
      const supabase = getSupabaseClient();
      if (!supabase || !userId || !loaded?.household) return;
      const { error } = await supabase.from("household_invites").insert({
        household_id: loaded.household.id,
        email: inviteEmail.trim(),
        invited_by: userId,
        role: "member",
      });
      if (error) throw error;
      await load();
    },
    [userId, loaded, load],
  );

  const revokeInvite = useCallback(
    async (inviteId: string) => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { error } = await supabase
        .from("household_invites")
        .update({ status: "revoked" })
        .eq("id", inviteId);
      if (error) throw error;
      await load();
    },
    [load],
  );

  const acceptInvite = useCallback(
    async (invite: HouseholdInvite) => {
      const supabase = getSupabaseClient();
      if (!supabase || !userId) return;
      const { error: memberErr } = await supabase
        .from("household_members")
        .insert({ household_id: invite.householdId, user_id: userId, role: "member" });
      if (memberErr) throw memberErr;
      const { error: inviteErr } = await supabase
        .from("household_invites")
        .update({ status: "accepted" })
        .eq("id", invite.id);
      if (inviteErr) throw inviteErr;
      await load();
    },
    [userId, load],
  );

  const declineInvite = useCallback(
    async (inviteId: string) => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { error } = await supabase
        .from("household_invites")
        .update({ status: "declined" })
        .eq("id", inviteId);
      if (error) throw error;
      await load();
    },
    [load],
  );

  const removeMember = useCallback(
    async (memberId: string) => {
      const supabase = getSupabaseClient();
      if (!supabase) return;
      const { error } = await supabase.from("household_members").delete().eq("id", memberId);
      if (error) throw error;
      await load();
    },
    [load],
  );

  const leaveHousehold = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase || !userId) return;
    const { error } = await supabase.from("household_members").delete().eq("user_id", userId);
    if (error) throw error;
    await load();
  }, [userId, load]);

  const addSeat = useCallback(async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error("not authenticated");
    const response = await fetch("/api/billing/household-seat", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "{}",
    });
    if (!response.ok) throw new Error("seat purchase failed");
    await load();
  }, [load]);

  const state = loaded?.userId === userId ? loaded : null;
  const loading = userId != null && isSupabaseConfigured && loaded?.userId !== userId;

  const value = useMemo<HouseholdContextValue>(
    () => ({
      household: state?.household ?? null,
      members: state?.members ?? [],
      memberEmails: state?.memberEmails ?? {},
      memberNames: state?.memberNames ?? {},
      sentInvites: state?.sentInvites ?? [],
      receivedInvites: state?.receivedInvites ?? [],
      sharingActive: state?.sharingActive ?? true,
      extraSeats: state?.extraSeats ?? 0,
      seatPriceDisplay: state?.seatPriceDisplay ?? null,
      loading,
      createHousehold,
      renameHousehold,
      inviteMember,
      revokeInvite,
      acceptInvite,
      declineInvite,
      removeMember,
      leaveHousehold,
      refresh: load,
      addSeat,
    }),
    [
      state,
      loading,
      createHousehold,
      renameHousehold,
      inviteMember,
      revokeInvite,
      acceptInvite,
      declineInvite,
      removeMember,
      leaveHousehold,
      addSeat,
      load,
    ],
  );

  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold(): HouseholdContextValue {
  return useContext(HouseholdContext);
}
