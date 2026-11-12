import { afterEach, describe, expect, it, vi } from "vitest";
import { clearPublicGets, publicGet } from "./public-get";

const ok = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) }) as Response;
const bad = { ok: false, json: () => Promise.reject(new Error("no body")) } as unknown as Response;

afterEach(() => {
  clearPublicGets();
  vi.useRealTimers();
});

describe("publicGet", () => {
  it("shares one answer between callers within 30 s", async () => {
    const fetcher = vi.fn(() => Promise.resolve(ok({ emailConfigured: false })));
    const a = await publicGet("/setup", 0, fetcher);
    const b = await publicGet("/setup", 29_000, fetcher);
    expect(a).toEqual({ emailConfigured: false });
    expect(b).toBe(a);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await publicGet("/setup", 31_000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries a failed answer instead of settling on nothing", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(bad)
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(ok({ emailConfigured: false }));
    const p = publicGet("/setup", 0, fetcher);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toEqual({ emailConfigured: false });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("does not remember an answer that failed every time", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<() => Promise<Response>>().mockResolvedValue(bad);
    const p = publicGet("/setup", 0, fetcher);
    await vi.runAllTimersAsync();
    await expect(p).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(3);
    fetcher.mockResolvedValue(ok({ ok: 1 }));
    await expect(publicGet("/setup", 1, fetcher)).resolves.toEqual({ ok: 1 });
  });
});
