// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { WidgetApi } from "./api";
import { identityFields } from "./form";

// Wave 5 — review links (docs/contracts/wave-5.md §3.5): once a review token checks out, every request carries
// it (so reports record the link as their source), and a guest who came through a link must give a name.

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

const inputs = (els: readonly (HTMLElement | null)[]) => {
  const all = els.flatMap((e) => (e ? [...e.querySelectorAll("input")] : []));
  const [name, email] = all;
  if (!name || !email) throw new Error("identity inputs missing");
  return { name, email };
};

describe("review token", () => {
  it("rides along on every request once set, and not before", async () => {
    const api = new WidgetApi("https://fb.test", "pk_test");
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ items: [], feedback: { id: "f", number: 1 } }))),
      );
    await api.pins("https://s.test/", false);
    api.reviewToken = "pwr_abcdefghijklmnopqrstuvwxyz012345";
    await api.pins("https://s.test/", false);
    await api.submitOnce({
      clientId: "00000000-0000-4000-8000-000000000000",
      kind: "comment",
      body: "hi",
      page: { url: "https://s.test/" },
      environment: { userAgent: "test" },
    } as Parameters<WidgetApi["submitOnce"]>[0]);
    const headers = fetch.mock.calls.map((c) => (c[1]?.headers ?? {}) as Record<string, string>);
    expect(headers[0]?.["x-pinwren-review-token"]).toBeUndefined();
    expect(headers[1]?.["x-pinwren-review-token"]).toBe("pwr_abcdefghijklmnopqrstuvwxyz012345");
    expect(headers[2]?.["x-pinwren-review-token"]).toBe("pwr_abcdefghijklmnopqrstuvwxyz012345");
  });
});

describe("identity fields", () => {
  it("leave the name optional for ordinary visitors", () => {
    const f = identityFields({});
    const { name } = inputs(f.els);
    expect(name.placeholder).toMatch(/optional/i);
    expect(f.invalid()).toBeNull();
  });

  it("ask a review guest for a name before anything is sent", () => {
    const f = identityFields({}, { requireName: true });
    const { name, email } = inputs(f.els);
    expect(name.placeholder).not.toMatch(/optional/i);
    const bad = f.invalid();
    expect(bad?.el).toBe(name);
    expect(bad?.message).toMatch(/name/i);
    name.value = "Gina";
    email.value = "not-an-email";
    expect(f.invalid()?.el).toBe(email);
    email.value = "gina@client.example";
    expect(f.invalid()).toBeNull();
    expect(f.read()).toEqual({ name: "Gina", email: "gina@client.example" });
  });

  it("don't ask a signed-in host user (Pinwren.identify) for a name", () => {
    const f = identityFields({ id: "u1" }, { requireName: true });
    expect(f.invalid()).toBeNull();
  });
});
