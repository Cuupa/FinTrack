import { describe, expect, it } from "vitest";
import { ownershipVisible, resolveOwnerName } from "@/lib/household/owner";

describe("ownershipVisible", () => {
  it("hides for a solo user or an empty household", () => {
    expect(ownershipVisible(true, 1)).toBe(false);
    expect(ownershipVisible(true, 0)).toBe(false);
  });

  it("shows once the household shares across more than one member", () => {
    expect(ownershipVisible(true, 2)).toBe(true);
  });

  it("hides while sharing is paused, even with several members", () => {
    expect(ownershipVisible(false, 3)).toBe(false);
  });
});

describe("resolveOwnerName", () => {
  const ctx = {
    currentUserId: "me",
    memberEmails: { me: "me@example.com", peer: "peer@example.com" },
    you: "you",
    fallback: "Member",
  };

  it("has nothing to attribute for guest data", () => {
    expect(resolveOwnerName(null, ctx)).toBeNull();
    expect(resolveOwnerName(undefined, ctx)).toBeNull();
  });

  it("reads the current user as 'you'", () => {
    expect(resolveOwnerName("me", ctx)).toBe("you");
  });

  it("names a peer by their email", () => {
    expect(resolveOwnerName("peer", ctx)).toBe("peer@example.com");
  });

  it("falls back to the generic member label for an unknown id", () => {
    expect(resolveOwnerName("ghost", ctx)).toBe("Member");
  });
});
