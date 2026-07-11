// @vitest-environment jsdom
//
// useIsAdmin (lib/admin/use-is-admin.ts) settle/loading transitions. Mirrors
// the mocking approach in tests/use-dividends.test.ts: the Supabase client
// and auth hook are mocked so the test controls exactly what "admins" row
// lookup resolves to, without a real Supabase instance.

import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useIsAdmin } from "../lib/admin/use-is-admin";

const authMock = vi.hoisted(() => vi.fn());
const getSupabaseClientMock = vi.hoisted(() => vi.fn());
const isSupabaseConfiguredMock = vi.hoisted(() => ({ value: true }));

vi.mock("@/lib/auth/auth-context", () => ({
  useAuth: authMock,
}));
vi.mock("@/lib/supabase/client", () => ({
  getSupabaseClient: getSupabaseClientMock,
  get isSupabaseConfigured() {
    return isSupabaseConfiguredMock.value;
  },
}));

function fakeClient(row: { user_id: string } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: row, error: null }),
        }),
      }),
    }),
  };
}

describe("useIsAdmin", () => {
  it("settles false immediately when Supabase is not configured", () => {
    isSupabaseConfiguredMock.value = false;
    authMock.mockReturnValue({ user: { id: "u1" }, loading: false });
    getSupabaseClientMock.mockReturnValue(null);

    const { result } = renderHook(() => useIsAdmin());
    expect(result.current).toEqual({ isAdmin: false, loading: false });
    isSupabaseConfiguredMock.value = true;
  });

  it("settles false immediately when signed out", () => {
    authMock.mockReturnValue({ user: null, loading: false });
    getSupabaseClientMock.mockReturnValue(fakeClient(null));

    const { result } = renderHook(() => useIsAdmin());
    expect(result.current).toEqual({ isAdmin: false, loading: false });
  });

  it("reports loading:true while auth is still restoring the session, even with no user yet", () => {
    // The hard-navigation-to-/admin case: AuthProvider hasn't resolved the
    // session yet, so `user` is transiently null but `loading` is true. This
    // must not settle isAdmin:false, or app/admin/layout.tsx bounces a real
    // admin to "/" before auth even finishes restoring.
    authMock.mockReturnValue({ user: null, loading: true });
    getSupabaseClientMock.mockReturnValue(fakeClient(null));

    const { result } = renderHook(() => useIsAdmin());
    expect(result.current).toEqual({ isAdmin: false, loading: true });
  });

  it("reports loading then isAdmin:true when the admins row exists", async () => {
    authMock.mockReturnValue({ user: { id: "admin-1" }, loading: false });
    getSupabaseClientMock.mockReturnValue(fakeClient({ user_id: "admin-1" }));

    const { result } = renderHook(() => useIsAdmin());
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAdmin).toBe(true);
  });

  it("reports isAdmin:false once settled when no admins row exists", async () => {
    authMock.mockReturnValue({ user: { id: "regular-1" }, loading: false });
    getSupabaseClientMock.mockReturnValue(fakeClient(null));

    const { result } = renderHook(() => useIsAdmin());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isAdmin).toBe(false);
  });
});
