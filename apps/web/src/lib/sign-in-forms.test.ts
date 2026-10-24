import { describe, expect, it } from "vitest";
import { magicLinkForm, passkeyNameForm, providerName, signInErrorMessage } from "./sign-in-forms";

describe("signInErrorMessage", () => {
  it("is null without an error", () => {
    expect(signInErrorMessage(null)).toBeNull();
    expect(signInErrorMessage("")).toBeNull();
  });

  it("explains closed sign-up from Google / GitHub and email links alike", () => {
    for (const code of ["SIGNUP_CLOSED", "signup_disabled", "new_user_signup_disabled"]) {
      expect(signInErrorMessage(code)).toMatch(/by invitation/);
    }
  });

  it("points an unlinked existing account at Settings › Profile", () => {
    expect(signInErrorMessage("account_not_linked")).toMatch(/Settings › Profile/);
  });

  it("covers expired links and has a fallback", () => {
    expect(signInErrorMessage("INVALID_TOKEN")).toMatch(/expired/);
    expect(signInErrorMessage("something_new")).toMatch(/Couldn't sign you in/);
  });
});

describe("sign-in forms", () => {
  it("validates the email-link address", () => {
    expect(magicLinkForm.safeParse({ email: "dana@example.com" }).success).toBe(true);
    expect(magicLinkForm.safeParse({ email: "nope" }).success).toBe(false);
  });

  it("trims and bounds passkey names", () => {
    expect(passkeyNameForm.parse({ name: "  Laptop " })).toEqual({ name: "Laptop" });
    expect(passkeyNameForm.safeParse({ name: "   " }).success).toBe(false);
    expect(passkeyNameForm.safeParse({ name: "x".repeat(61) }).success).toBe(false);
  });

  it("names sign-in methods", () => {
    expect(providerName("credential")).toBe("Password");
    expect(providerName("github")).toBe("GitHub");
    expect(providerName("okta")).toBe("okta");
  });
});
