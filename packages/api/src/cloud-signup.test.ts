import { beforeAll, describe, expect, it, vi } from "vitest";

// Cloud sign-up policy (design 2026-10-31): the pure rules and the counters behind the abuse controls.

const consume = vi.hoisted(() => vi.fn<(key: string, limit: number, seconds: number) => Promise<boolean>>());
vi.mock("./rate-limit", () => ({ consume }));

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unused";
  process.env.PINWREN_URL ??= "http://localhost:3100";
  process.env.PINWREN_SECRET ??= "x".repeat(48);
});

describe("isDisposableEmail", () => {
  it("flags throwaway mailbox domains, including subdomains and any case", async () => {
    const { isDisposableEmail } = await import("./cloud-signup");
    expect(isDisposableEmail("a@mailinator.com")).toBe(true);
    expect(isDisposableEmail("A@Mailinator.COM")).toBe(true);
    expect(isDisposableEmail("a@x.guerrillamail.com")).toBe(true);
  });

  it("accepts ordinary and look-alike domains", async () => {
    const { isDisposableEmail } = await import("./cloud-signup");
    expect(isDisposableEmail("a@example.com")).toBe(false);
    expect(isDisposableEmail("a@notmailinator.com")).toBe(false);
    expect(isDisposableEmail("not-an-email")).toBe(false);
  });
});

describe("cloudSignupRefusal", () => {
  const base = { email: "a@example.com", termsAccepted: true, ip: "203.0.113.9" };

  it("accepts a consented, ordinary sign-up within the caps", async () => {
    consume.mockResolvedValue(true);
    const { cloudSignupRefusal } = await import("./cloud-signup");
    expect(await cloudSignupRefusal(base)).toBeNull();
  });

  it("requires the Terms and Privacy consent before touching any counter", async () => {
    consume.mockClear();
    const { cloudSignupRefusal } = await import("./cloud-signup");
    expect(await cloudSignupRefusal({ ...base, termsAccepted: undefined })).toMatchObject({
      code: "TERMS_REQUIRED",
    });
    expect(await cloudSignupRefusal({ ...base, termsAccepted: "true" })).toMatchObject({
      code: "TERMS_REQUIRED",
    });
    expect(consume).not.toHaveBeenCalled();
  });

  it("refuses disposable addresses", async () => {
    consume.mockResolvedValue(true);
    const { cloudSignupRefusal } = await import("./cloud-signup");
    expect(await cloudSignupRefusal({ ...base, email: "x@mailinator.com" })).toMatchObject({
      code: "DISPOSABLE_EMAIL",
    });
  });

  it("limits each address and then the whole instance, with the same answer", async () => {
    const { cloudSignupRefusal } = await import("./cloud-signup");
    consume.mockImplementation((key) => Promise.resolve(!key.startsWith("signup:ip:")));
    const perIp = await cloudSignupRefusal(base);
    consume.mockImplementation((key) => Promise.resolve(key !== "signup:all"));
    const global = await cloudSignupRefusal(base);
    expect(perIp).toMatchObject({ code: "SIGNUP_RATE_LIMITED" });
    expect(global).toEqual(perIp);
  });

  it("keys the per-address counter by the trusted client address, one bucket for unknown ones", async () => {
    consume.mockReset();
    consume.mockResolvedValue(true);
    const { cloudSignupRefusal } = await import("./cloud-signup");
    await cloudSignupRefusal(base);
    await cloudSignupRefusal({ ...base, ip: undefined });
    const keys = consume.mock.calls.map(([k]) => k);
    expect(keys).toContain("signup:ip:203.0.113.9");
    expect(keys).toContain("signup:ip:unknown");
  });
});

describe("cloud sign-up mode", () => {
  it("defaults to closed and only opens on the exact word", async () => {
    const { cloudSignupsOpen } = await import("./cloud-signup");
    expect(cloudSignupsOpen({ PINWREN_CLOUD_SIGNUPS: undefined })).toBe(false);
    expect(cloudSignupsOpen({ PINWREN_CLOUD_SIGNUPS: "closed" })).toBe(false);
    expect(cloudSignupsOpen({ PINWREN_CLOUD_SIGNUPS: "open" })).toBe(true);
  });
});
