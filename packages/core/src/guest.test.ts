import { describe, expect, it } from "vitest";
import { guestPortalAccess, guestReplyCreate } from "./guest";

describe("guest portal wire boundaries", () => {
  it("cannot smuggle feedback ids, author identities or internal visibility into requests", () => {
    expect(guestPortalAccess.safeParse({ feedbackIds: ["guessed-id"] }).success).toBe(false);
    expect(guestReplyCreate.safeParse({ body: "hello", visibility: "internal" }).success).toBe(false);
    expect(guestReplyCreate.safeParse({ body: "hello", author: { name: "Admin" } }).success).toBe(false);
  });
  it("caps mixed access lists rather than accepting fifty of each", () => {
    expect(
      guestPortalAccess.safeParse({
        reporterTokens: Array(26).fill("abcdefghijklmnop"),
        pageTokens: Array(25).fill("encoded.signature"),
      }).success,
    ).toBe(false);
  });
  it("does not accept blank or oversized replies", () => {
    expect(guestReplyCreate.safeParse({ body: " \n\t " }).success).toBe(false);
    expect(guestReplyCreate.safeParse({ body: "x".repeat(10_001) }).success).toBe(false);
    expect(guestReplyCreate.parse({ body: "  hello  " })).toEqual({ body: "hello" });
  });
});
