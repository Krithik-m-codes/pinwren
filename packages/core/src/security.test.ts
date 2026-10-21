import { describe, expect, it } from "vitest";
import { httpsDecision, truncateIp } from "./security";

const req = (url: string, method = "GET", headers: Record<string, string> = {}) => ({
  url,
  method,
  headers: { get: (n: string) => headers[n.toLowerCase()] ?? null },
});

describe("httpsDecision", () => {
  it("passes everything when not enforced", () => {
    expect(httpsDecision(req("http://example.com/x"), { enforce: false, trustProxy: false })).toEqual({
      action: "pass",
      hsts: false,
    });
  });
  it("redirects GET and refuses POST over http", () => {
    const o = { enforce: true, trustProxy: false };
    expect(httpsDecision(req("http://feedback.example.com/inbox?a=1"), o)).toEqual({
      action: "redirect",
      location: "https://feedback.example.com/inbox?a=1",
    });
    expect(httpsDecision(req("http://feedback.example.com/api/x", "POST"), o)).toEqual({ action: "refuse" });
  });
  it("exempts localhost and sends HSTS over https", () => {
    const o = { enforce: true, trustProxy: false };
    expect(httpsDecision(req("http://localhost:3100/api/health"), o).action).toBe("pass");
    expect(httpsDecision(req("http://127.0.0.1:3100/"), o).action).toBe("pass");
    expect(httpsDecision(req("https://feedback.example.com/"), o)).toEqual({ action: "pass", hsts: true });
  });
  it("trusts forwarded headers only behind a trusted proxy", () => {
    const h = { "x-forwarded-proto": "https", "x-forwarded-host": "feedback.example.com" };
    expect(
      httpsDecision(req("http://10.0.0.5:3000/", "GET", h), { enforce: true, trustProxy: true }),
    ).toEqual({
      action: "pass",
      hsts: true,
    });
    expect(
      httpsDecision(req("http://10.0.0.5:3000/", "GET", h), { enforce: true, trustProxy: false }).action,
    ).toBe("redirect");
    const spoofLocal = { "x-forwarded-proto": "http", "x-forwarded-host": "feedback.example.com" };
    expect(
      httpsDecision(req("http://localhost:3100/", "GET", spoofLocal), { enforce: true, trustProxy: true }),
    ).toEqual({ action: "redirect", location: "https://feedback.example.com/" });
  });
});

describe("truncateIp", () => {
  it("keeps the /24 of IPv4 and the /48 of IPv6", () => {
    expect(truncateIp("203.0.113.77")).toBe("203.0.113.0");
    expect(truncateIp("::ffff:198.51.100.9")).toBe("198.51.100.0");
    expect(truncateIp("2001:db8:85a3:8d3:1319:8a2e:370:7348")).toBe("2001:db8:85a3::");
    expect(truncateIp("2001:db8::1")).toBe("2001:db8:0::");
    expect(truncateIp("not an ip")).toBe("unknown");
  });
});
