import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Http from "./http";
import type * as Store from "./store";

// Fresh modules per test: the rate-limit windows and the store are module / process state.
let http: typeof Http;
let store: typeof Store;

const key = (n: number) => `pk_demo_${String(n).padStart(16, "0")}`;

function req(headers: Record<string, string> = {}) {
  return new Request("https://pinwren.xride-labs.in/demo-api/w/feedback", { headers });
}

beforeEach(async () => {
  delete (globalThis as { __pinwrenDemo?: unknown }).__pinwrenDemo;
  vi.resetModules();
  http = await import("./http");
  store = await import("./store");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("clientIp", () => {
  it("ignores forwarded headers unless a proxy is trusted", () => {
    vi.stubEnv("PINWREN_TRUST_PROXY", "");
    expect(http.clientIp(req({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2" }))).toBe("unknown");
    vi.stubEnv("PINWREN_TRUST_PROXY", "false");
    expect(http.clientIp(req({ "x-forwarded-for": "1.1.1.1" }))).toBe("unknown");
    vi.stubEnv("PINWREN_TRUST_PROXY", "0");
    expect(http.clientIp(req({ "x-forwarded-for": "1.1.1.1" }))).toBe("unknown");
  });

  it("with one trusted hop takes the rightmost X-Forwarded-For entry", () => {
    vi.stubEnv("PINWREN_TRUST_PROXY", "true");
    expect(http.clientIp(req({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 203.0.113.9" }))).toBe("203.0.113.9");
    vi.stubEnv("PINWREN_TRUST_PROXY", "1");
    expect(http.clientIp(req({ "x-forwarded-for": "6.6.6.6,203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("with N trusted hops skips the N-1 proxies on the right, and never reads x-real-ip", () => {
    vi.stubEnv("PINWREN_TRUST_PROXY", "2");
    expect(http.clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.2" }))).toBe("203.0.113.9");
    // Fewer entries than hops: the leftmost.
    expect(http.clientIp(req({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(http.clientIp(req({ "x-real-ip": "2.2.2.2" }))).toBe("unknown");
  });

  it("honours a platform header only when opted in", () => {
    const r = req({ "x-vercel-forwarded-for": "198.51.100.4", "x-forwarded-for": "6.6.6.6" });
    expect(http.clientIp(r)).toBe("unknown");
    vi.stubEnv("DEMO_TRUST_PLATFORM_IP_HEADER", "x-vercel-forwarded-for");
    expect(http.clientIp(r)).toBe("198.51.100.4");
  });
});

describe("rate-limit buckets", () => {
  it("a rotating spoofed X-Forwarded-For shares one bucket when no proxy is trusted", () => {
    vi.stubEnv("PINWREN_TRUST_PROXY", "");
    let refused = 0;
    for (let i = 0; i < 80; i++) {
      const r = req({ "x-forwarded-for": `10.0.${Math.floor(i / 250)}.${i % 250}` });
      if (http.writeAllowed(r, key(i), "reply")) refused++;
    }
    // 60 writes per address per minute: the rest are refused because every request is "unknown".
    expect(refused).toBe(20);
  });

  it("with a trusted proxy, distinct client addresses get distinct buckets", () => {
    vi.stubEnv("PINWREN_TRUST_PROXY", "1");
    for (let i = 0; i < 80; i++) {
      const r = req({ "x-forwarded-for": `6.6.6.6, 203.0.113.${i}` });
      expect(http.writeAllowed(r, key(i), "reply")).toBeNull();
    }
  });

  it("caps new sandboxes per address, so spoofed headers can't churn the store", () => {
    vi.stubEnv("PINWREN_TRUST_PROXY", "");
    let refused = 0;
    for (let i = 0; i < 70; i++) {
      const r = req({ "x-forwarded-for": `10.0.0.${i}` });
      if (http.openSandbox(r, key(i))) refused++;
    }
    expect(refused).toBe(10);
    expect(store.storeStats().sandboxes).toBe(60);
    // Existing sandboxes stay reachable.
    expect(http.openSandbox(req(), key(0))).toBeNull();
  });
});
