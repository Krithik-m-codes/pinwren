// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";

type W = { Pinwren?: unknown };

/** Scripts the loader added (happy-dom would really fetch them if they reached the document). */
let added: HTMLScriptElement[] = [];

async function fresh() {
  vi.resetModules();
  delete (window as W).Pinwren;
  added = [];
  vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
    added.push(...(nodes as HTMLScriptElement[]));
  });
  return import("./loader");
}

afterEach(() => {
  delete (window as W).Pinwren;
  vi.restoreAllMocks();
});

describe("npm entry (loader.ts)", () => {
  it("queues calls and adds widget.js from the endpoint once", async () => {
    const p = await fresh();
    p.identify({ id: "u1", name: "Maria" }, { signature: "ab" });
    p.init({ projectKey: "pk_1", endpoint: "https://fb.example.com/", nonce: "abc" });
    p.init({ projectKey: "pk_1", endpoint: "https://fb.example.com" });
    p.setPageScope({ urlPattern: "/p/:id" });
    p.open("bug");
    expect(added).toHaveLength(1);
    expect(added[0]?.src).toBe("https://fb.example.com/widget.js");
    expect(added[0]?.nonce).toBe("abc");
    const q = ((window as W).Pinwren as { q: unknown[][] }).q;
    expect(q.map((c) => c[0])).toEqual(["identify", "init", "init", "setPageScope", "open"]);
    expect(q[1]?.[1]).toEqual({ projectKey: "pk_1", endpoint: "https://fb.example.com/" }); // nonce stays local
  });

  it("calls the real API once widget.js has run", async () => {
    const p = await fresh();
    const real = {
      init: vi.fn(),
      open: vi.fn(),
      close: vi.fn(),
      identify: vi.fn(),
      setPageScope: vi.fn(),
      destroy: vi.fn(),
      on: vi.fn(() => vi.fn()),
    };
    (window as W).Pinwren = real;
    p.init({ projectKey: "pk_1", endpoint: "https://fb.example.com" });
    p.open();
    p.destroy();
    expect(real.init).toHaveBeenCalledWith({ projectKey: "pk_1", endpoint: "https://fb.example.com" });
    expect(real.open).toHaveBeenCalledWith();
    expect(real.destroy).toHaveBeenCalled();
    expect(added).toHaveLength(0);
    const handler = vi.fn();
    const off = p.on("submit", handler);
    expect(real.on).toHaveBeenCalledWith("submit", expect.any(Function));
    off();
  });

  it("an `on` handler queued before load can unsubscribe before it fires", async () => {
    const p = await fresh();
    const handler = vi.fn();
    const off = p.on("ready", handler);
    const q = ((window as W).Pinwren as { q: unknown[][] }).q;
    const wrapped = q[0]?.[2] as (d?: unknown) => void;
    wrapped();
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    wrapped();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("resolves load() with the API when the script runs", async () => {
    const p = await fresh();
    const loading = p.load("https://fb.example.com");
    (window as W).Pinwren = { init: vi.fn() };
    added[0]?.dispatchEvent(new Event("load"));
    await expect(loading).resolves.toBe((window as W).Pinwren);
  });
});
