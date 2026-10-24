// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { WidgetApi } from "./api";
import { hostMetadata, mergeMetadata } from "./config";
import { errText } from "./env";
import { cleanPageUrl } from "./export";
import { HttpError, isRetryable } from "./queue";

// Wave 5, widget data (docs/contracts/wave-5.md §3.3): host metadata, visitor-facing error texts, page URLs
// without our own parameters, and the API client's error codes, timeouts and private-item headers.

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Pinwren.setMetadata", () => {
  it("takes plain JSON objects within the cap and copies them", () => {
    const src = { plan: "pro", seats: 3 };
    const r = hostMetadata(src);
    expect(r).toEqual({ ok: { plan: "pro", seats: 3 } });
    src.plan = "free";
    expect(r.ok?.plan).toBe("pro");
    expect(hostMetadata(null)).toEqual({ ok: null });
  });

  it("refuses arrays, class instances, cycles and oversized objects", () => {
    expect(hostMetadata([1]).error).toBeTruthy();
    expect(hostMetadata(new Date()).error).toBeTruthy();
    expect(hostMetadata("x").error).toBeTruthy();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(hostMetadata(cyclic).error).toBeTruthy();
    expect(hostMetadata({ blob: "x".repeat(15_000) }).error).toMatch(/14000/);
  });

  it("merges the host's fields with the widget's own, dropping timings that don't fit", () => {
    expect(mergeMetadata(null, undefined)).toBeUndefined();
    expect(mergeMetadata({ plan: "pro" }, { performance: { lcp: 1 } })).toEqual({
      plan: "pro",
      performance: { lcp: 1 },
    });
    // The widget's own key wins a clash.
    expect(mergeMetadata({ performance: "fake" }, { performance: { lcp: 1 } })).toEqual({
      performance: { lcp: 1 },
    });
    const big = { blob: "x".repeat(13_900) };
    expect(mergeMetadata(big, { performance: { t: "y".repeat(3000) } })).toEqual(big);
  });
});

describe("error texts", () => {
  it("maps statuses and codes to the visitor's language, never the server's English", () => {
    const fb = "fallback";
    expect(errText(new HttpError("Failed to fetch", 0), fb)).toMatch(/offline/);
    expect(errText(new HttpError("x", 408, "TIMEOUT"), fb)).toMatch(/too long/);
    expect(errText(new HttpError("Request body too large", 413), fb)).toMatch(/too large/);
    expect(errText(new HttpError("Too many reports", 429), fb)).toMatch(/minute/);
    expect(errText(new HttpError("x", 403, "READ_ONLY"), fb)).toMatch(/isn't accepting/);
    expect(errText(new HttpError("x", 403, "ORIGIN_NOT_ALLOWED"), fb)).toMatch(/isn't accepting/);
    expect(errText(new HttpError("x", 403, "RESOLVE_NOT_ALLOWED"), fb)).toMatch(/can't do that/);
    expect(errText(new HttpError("x", 503), fb)).toMatch(/server had a problem/);
    expect(errText(new HttpError("Validation failed", 400), fb)).toBe(fb);
    expect(errText(new TypeError("Load failed"), fb)).toBe(fb);
  });
});

describe("page URLs", () => {
  it("drop the deep-link, page-link and review parameters and stay within 2000 characters", () => {
    expect(cleanPageUrl("https://s.test/p?a=1&pinwren=x&pwt=t&pinwren_review=r#h")).toBe(
      "https://s.test/p?a=1#h",
    );
    expect(cleanPageUrl(`https://s.test/?q=${"a".repeat(3000)}`)).toHaveLength(2000);
    expect(cleanPageUrl("not a url")).toBe("not a url");
  });
});

describe("WidgetApi", () => {
  const api = new WidgetApi("https://fb.test", "pk_1");

  it("keeps the server's problem code on errors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ title: "Nope", code: "READ_ONLY" }), { status: 403 }),
    );
    const err = await api.pins("https://s.test/", false).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).code).toBe("READ_ONLY");
    expect((err as HttpError).status).toBe(403);
  });

  it("aborts a hung request as a retryable timeout", async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const p = api.pins("https://s.test/", false).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(30_000);
    const err = await p;
    expect((err as HttpError).status).toBe(408);
    expect(isRetryable(err)).toBe(true);
  });

  it("sends reporter tokens, link tokens and review tokens in their headers", async () => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ items: [] }))));
    await api.mine(["t1", "t2"]);
    await api.replies("f1", { reporter: "rt", link: "lt" });
    await api.linked("f1", "lt").catch(() => undefined);
    await api.reviewLink("rv");
    const headers = fetch.mock.calls.map((c) => (c[1]?.headers ?? {}) as Record<string, string>);
    expect(headers[0]?.["x-pinwren-reporter-tokens"]).toBe("t1,t2");
    expect(headers[1]?.["x-pinwren-reporter-token"]).toBe("rt");
    expect(headers[1]?.["x-pinwren-link-token"]).toBe("lt");
    expect(headers[2]?.["x-pinwren-link-token"]).toBe("lt");
    expect(headers[3]?.["x-pinwren-review-token"]).toBe("rv");
    expect(fetch.mock.calls[0]?.[0] as string).toBe("https://fb.test/w/mine");
  });

  it("treats a refused review link as not valid", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 404 }));
    expect(await api.reviewLink("rv")).toBe(false);
  });
});
