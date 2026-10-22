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

describe("safeHref (ADR 0021)", () => {
  it("lets only absolute http(s) URLs through", async () => {
    const { safeHref } = await import("./security");
    expect(safeHref("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    for (const bad of [
      "javascript:alert(1)",
      " JaVaScRiPt:alert(1)",
      "data:text/html,x",
      "vbscript:x",
      "//evil.example",
      "/local",
      "",
      null,
      42,
    ]) {
      expect(safeHref(bad), String(bad)).toBeNull();
    }
    expect(safeHref("/inbox", { allowRelative: true })).toBe("/inbox");
    expect(safeHref("//evil.example", { allowRelative: true })).toBeNull();
  });
});

describe("page URLs in reports", () => {
  it("are http(s) only", async () => {
    const { widgetFeedbackCreate } = await import("./schemas");
    const base = {
      clientId: crypto.randomUUID(),
      kind: "comment",
      body: "x",
      environment: { userAgent: "t", viewport: { w: 1, h: 1 }, dpr: 1 },
    };
    expect(widgetFeedbackCreate.safeParse({ ...base, page: { url: "https://a.example/" } }).success).toBe(
      true,
    );
    for (const url of ["javascript:alert(1)//", "data:text/html,<script>1</script>", "file:///etc/passwd"]) {
      expect(widgetFeedbackCreate.safeParse({ ...base, page: { url } }).success, url).toBe(false);
    }
  });
});

describe("panel actions per audience", () => {
  it("hides webhook URLs from non-admins and team actions from viewers", async () => {
    const { panelActionsFor } = await import("./config");
    const actions = [
      {
        id: "hook",
        label: "Hook",
        kind: "webhook",
        url: "https://hooks.example/secret",
        icon: null,
        visibleTo: "team",
      },
      {
        id: "team",
        label: "Team",
        kind: "link",
        url: "https://jira.example/{id}",
        icon: null,
        visibleTo: "team",
      },
      {
        id: "all",
        label: "All",
        kind: "link",
        url: "https://docs.example/",
        icon: null,
        visibleTo: "everyone",
      },
    ] as const;
    const list = [...actions];
    expect(panelActionsFor(list, "admin", "settings")[0]?.url).toBe("https://hooks.example/secret");
    expect(panelActionsFor(list, "admin", "detail")[0]?.url).toBe("");
    expect(panelActionsFor(list, "member", "settings")[0]?.url).toBe("");
    expect(panelActionsFor(list, "member", "detail").map((a) => a.id)).toEqual(["hook", "team", "all"]);
    expect(panelActionsFor(list, "viewer", "detail").map((a) => a.id)).toEqual(["all"]);
    const viewerSettings = panelActionsFor(list, "viewer", "settings");
    expect(viewerSettings.map((a) => a.url)).toEqual(["", "", "https://docs.example/"]);
  });
});
