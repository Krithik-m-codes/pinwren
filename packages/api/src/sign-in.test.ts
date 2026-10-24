import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Sign-in methods (wave 5): what the auth pages offer, which auth paths a switch refuses, which new
// accounts pass the sign-up policy, and the Google / GitHub environment.

const BASE_ENV = {
  DATABASE_URL: "postgres://unused",
  PINWREN_URL: "http://localhost:3100",
  PINWREN_SECRET: "x".repeat(48),
};

beforeAll(() => {
  process.env.DATABASE_URL ??= BASE_ENV.DATABASE_URL;
  process.env.PINWREN_URL ??= BASE_ENV.PINWREN_URL;
  process.env.PINWREN_SECRET ??= BASE_ENV.PINWREN_SECRET;
});

const NO_PROVIDERS = {
  GOOGLE_CLIENT_ID: undefined,
  GOOGLE_CLIENT_SECRET: undefined,
  GITHUB_CLIENT_ID: undefined,
  GITHUB_CLIENT_SECRET: undefined,
};

describe("resolveSignInMethods", () => {
  it("offers password, email links (with SMTP) and passkeys by default", async () => {
    const { resolveSignInMethods } = await import("./settings/sign-in");
    expect(resolveSignInMethods({ stored: {}, emailConfigured: true, env: NO_PROVIDERS })).toEqual({
      password: true,
      magicLink: true,
      passkey: true,
      google: false,
      github: false,
    });
  });

  it("never offers email links without SMTP, even with the switch on", async () => {
    const { resolveSignInMethods } = await import("./settings/sign-in");
    const m = resolveSignInMethods({
      stored: { magicLink: true },
      emailConfigured: false,
      env: NO_PROVIDERS,
    });
    expect(m.magicLink).toBe(false);
  });

  it("follows the admin's switches", async () => {
    const { resolveSignInMethods } = await import("./settings/sign-in");
    const m = resolveSignInMethods({
      stored: { magicLink: false, passkeys: false },
      emailConfigured: true,
      env: NO_PROVIDERS,
    });
    expect(m).toMatchObject({ magicLink: false, passkey: false, password: true });
  });

  it("offers a provider only when its id and secret are both set", async () => {
    const { resolveSignInMethods } = await import("./settings/sign-in");
    const m = resolveSignInMethods({
      stored: {},
      emailConfigured: false,
      env: { ...NO_PROVIDERS, GOOGLE_CLIENT_ID: "g", GOOGLE_CLIENT_SECRET: "gs", GITHUB_CLIENT_ID: "h" },
    });
    expect(m.google).toBe(true);
    expect(m.github).toBe(false);
  });
});

describe("socialProvidersFrom", () => {
  it("builds Better Auth providers for configured pairs only", async () => {
    const { socialProvidersFrom } = await import("./settings/sign-in");
    expect(socialProvidersFrom(NO_PROVIDERS)).toEqual({});
    const both = socialProvidersFrom({
      GOOGLE_CLIENT_ID: "g",
      GOOGLE_CLIENT_SECRET: "gs",
      GITHUB_CLIENT_ID: "h",
      GITHUB_CLIENT_SECRET: "hs",
    });
    expect(Object.keys(both).sort()).toEqual(["github", "google"]);
    expect(both.github).toEqual({ clientId: "h", clientSecret: "hs" });
    expect(both.google).toMatchObject({ clientId: "g", clientSecret: "gs", prompt: "select_account" });
  });
});

describe("refusedMethod", () => {
  const on = { magicLink: true, passkey: true };
  const off = { magicLink: false, passkey: false };

  it("lets everything through while the methods are on", async () => {
    const { refusedMethod } = await import("./settings/sign-in");
    for (const path of ["/sign-in/magic-link", "/passkey/verify-authentication", "/sign-in/email"]) {
      expect(refusedMethod(path, on)).toBeNull();
    }
  });

  it("refuses sending a link and every passkey ceremony when switched off", async () => {
    const { refusedMethod } = await import("./settings/sign-in");
    expect(refusedMethod("/sign-in/magic-link", off)?.code).toBe("MAGIC_LINK_DISABLED");
    for (const path of [
      "/passkey/generate-authenticate-options",
      "/passkey/verify-authentication",
      "/passkey/generate-register-options",
      "/passkey/verify-registration",
    ]) {
      expect(refusedMethod(path, off)?.code).toBe("PASSKEYS_DISABLED");
    }
  });

  it("keeps managing passkeys and other auth paths open", async () => {
    const { isMethodPath, refusedMethod } = await import("./settings/sign-in");
    for (const path of ["/passkey/list-user-passkeys", "/passkey/delete-passkey", "/sign-in/email"]) {
      expect(refusedMethod(path, off)).toBeNull();
      expect(isMethodPath(path)).toBe(false);
    }
    expect(isMethodPath("/sign-in/magic-link")).toBe(true);
  });
});

describe("signupPolicyApplies", () => {
  it("applies to accounts created through any auth endpoint, not to Add User", async () => {
    const { signupPolicyApplies } = await import("./settings/sign-in");
    for (const path of ["/sign-up/email", "/callback/:id", "/magic-link/verify", "/sign-in/social"]) {
      expect(signupPolicyApplies(path)).toBe(true);
    }
    // Users › Add User calls the internal adapter outside any Better Auth endpoint.
    expect(signupPolicyApplies(null)).toBe(false);
    expect(signupPolicyApplies(undefined)).toBe(false);
  });
});

describe("OAuth environment", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    vi.resetModules();
  });

  it("refuses a provider with only one half set", async () => {
    vi.resetModules();
    process.env = { ...saved, ...BASE_ENV, GITHUB_CLIENT_ID: "abc", GITHUB_CLIENT_SECRET: "" };
    const { env } = await import("./env");
    expect(() => env()).toThrow(/GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET/);
  });

  it("accepts both halves, or neither", async () => {
    vi.resetModules();
    process.env = { ...saved, ...BASE_ENV, GOOGLE_CLIENT_ID: " id ", GOOGLE_CLIENT_SECRET: "secret" };
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    const { env } = await import("./env");
    expect(env().GOOGLE_CLIENT_ID).toBe("id");
    expect(env().GITHUB_CLIENT_ID).toBeUndefined();
  });
});

describe("magic_link template", () => {
  it("is an account email with a sign-in button", async () => {
    const { ORG_TEMPLATE_KEYS, renderDefault, sampleVariables, TEMPLATES } =
      await import("./email/templates");
    expect(TEMPLATES.magic_link.account).toBe(true);
    expect(ORG_TEMPLATE_KEYS).not.toContain("magic_link");
    const out = renderDefault("magic_link", sampleVariables("magic_link"));
    expect(out.html).toContain("magic-link/verify");
    expect(out.subject).toContain("sign-in link");
  });
});
