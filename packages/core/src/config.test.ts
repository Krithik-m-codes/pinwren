import { describe, expect, it } from "vitest";
import { captureConfig, mergeConfig, parseCaptureConfig, parseWidgetConfig, widgetConfig } from "./config";
import { widgetFeedbackCreate } from "./schemas";

describe("widget config", () => {
  it("fills every default from an empty object", () => {
    const c = parseWidgetConfig({});
    expect(c.launcher).toEqual({
      position: "bottom-right",
      offset: { x: 20, y: 20 },
      shape: "round",
      label: "Feedback",
      icon: "pin",
      accent: "#5b5bd6",
      tooltip: "Give feedback",
      hidden: false,
    });
    expect(c.modes).toEqual({ comment: true, bug: true });
    expect(c.shortcuts).toBe(true);
    expect(c.rightClickComment).toBe(false);
    expect(c.readOnly).toBe(false);
    expect(c.visitorsCanResolve).toBe(true);
    expect(c.consent).toEqual({ enabled: false, text: null, privacyUrl: null });
    expect(widgetConfig.parse({})).toEqual(c);
  });

  it("keeps stored values and fills the rest", () => {
    const c = parseWidgetConfig({ launcher: { position: "top-left" }, readOnly: true });
    expect(c.launcher.position).toBe("top-left");
    expect(c.launcher.shape).toBe("round");
    expect(c.readOnly).toBe(true);
  });

  it("falls back per field when stored JSON is invalid", () => {
    const c = parseWidgetConfig({
      launcher: { position: "middle", accent: "#112233" },
      shortcuts: "yes",
      modes: { bug: false },
    });
    expect(c.launcher.position).toBe("bottom-right");
    expect(c.launcher.accent).toBe("#112233");
    expect(c.shortcuts).toBe(true);
    expect(c.modes).toEqual({ comment: true, bug: false });
  });

  it("never throws on garbage", () => {
    expect(parseWidgetConfig(null).modes.comment).toBe(true);
    expect(parseWidgetConfig([1, 2]).launcher.icon).toBe("pin");
    expect(parseWidgetConfig("x").readOnly).toBe(false);
  });

  it("rejects a non-http privacy URL", () => {
    expect(widgetConfig.safeParse({ consent: { privacyUrl: "javascript:alert(1)" } }).success).toBe(false);
  });
});

describe("capture config", () => {
  it("has defaults", () => {
    expect(parseCaptureConfig(undefined)).toEqual({
      console: "warnings",
      network: "failures",
      screenshotOnComment: false,
      maskSelectors: [],
    });
  });
  it("validates", () => {
    expect(captureConfig.safeParse({ console: "loud" }).success).toBe(false);
    expect(parseCaptureConfig({ console: "all", maskSelectors: [".secret"] })).toMatchObject({
      console: "all",
      maskSelectors: [".secret"],
    });
  });
});

describe("mergeConfig", () => {
  it("deep-merges objects and replaces arrays and nulls", () => {
    expect(
      mergeConfig(
        { launcher: { position: "top-left", label: "Hi" }, maskSelectors: ["a"] },
        { launcher: { label: null }, maskSelectors: ["b"] },
      ),
    ).toEqual({ launcher: { position: "top-left", label: null }, maskSelectors: ["b"] });
  });
  it("ignores prototype keys", () => {
    const merged = mergeConfig({}, JSON.parse('{"__proto__": {"polluted": true}}'));
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(merged)).toEqual([]);
  });
  it("treats non-object inputs as empty", () => {
    expect(mergeConfig(null, { a: 1 })).toEqual({ a: 1 });
    expect(mergeConfig({ a: 1 }, null)).toEqual({ a: 1 });
  });
});

describe("attachments on widget create", () => {
  const base = {
    clientId: crypto.randomUUID(),
    kind: "bug",
    body: "x",
    page: { url: "https://example.com/" },
    environment: { userAgent: "t", viewport: { w: 1, h: 1 }, dpr: 1 },
  };
  const att = {
    name: "a.pdf",
    contentType: "application/pdf",
    dataUrl: "data:application/pdf;base64,JVBERi0=",
  };
  it("accepts up to three", () => {
    expect(widgetFeedbackCreate.safeParse({ ...base, attachments: [att, att, att] }).success).toBe(true);
  });
  it("rejects four and unknown types", () => {
    expect(widgetFeedbackCreate.safeParse({ ...base, attachments: [att, att, att, att] }).success).toBe(
      false,
    );
    expect(
      widgetFeedbackCreate.safeParse({ ...base, attachments: [{ ...att, contentType: "image/svg+xml" }] })
        .success,
    ).toBe(false);
  });
});

describe("panel actions (F-016)", () => {
  const link = {
    id: "jira",
    label: "Create Jira ticket",
    kind: "link",
    url: "https://jira.example.com/new?s={number}&u={url}",
  };
  it("defaults to none", () => {
    expect(parseWidgetConfig({}).panelActions).toEqual([]);
    expect(parseWidgetConfig({}).privacyMode).toBe(false);
  });
  it("fills icon + visibility defaults", () => {
    const c = widgetConfig.parse({ panelActions: [link] });
    expect(c.panelActions[0]).toMatchObject({ icon: null, visibleTo: "everyone" });
  });
  it("forces webhook actions to the team", () => {
    const c = widgetConfig.parse({
      panelActions: [
        {
          id: "agent",
          label: "Send to agent",
          kind: "webhook",
          url: "https://hooks.example.com/a",
          visibleTo: "everyone",
        },
      ],
    });
    expect(c.panelActions[0]?.visibleTo).toBe("team");
  });
  it("rejects bad ids, schemes, placeholders, duplicates and more than five", () => {
    const bad = (a: Record<string, unknown>) =>
      !widgetConfig.safeParse({ panelActions: [{ ...link, ...a }] }).success;
    expect(bad({ id: "Has Spaces" })).toBe(true);
    expect(bad({ url: "javascript:alert(1)" })).toBe(true);
    expect(bad({ url: "https://x.example/{secret}" })).toBe(true);
    expect(bad({ kind: "webhook", url: "https://x.example/{id}" })).toBe(true);
    expect(bad({ label: "" })).toBe(true);
    expect(widgetConfig.safeParse({ panelActions: [link, link] }).success).toBe(false);
    const six = [1, 2, 3, 4, 5, 6].map((i) => ({ ...link, id: `a${i}` }));
    expect(widgetConfig.safeParse({ panelActions: six }).success).toBe(false);
  });
  it("substitutes placeholders URL-encoded", async () => {
    const { substituteActionUrl } = await import("./config");
    expect(substituteActionUrl(link.url, { number: 12, url: "https://site.example/a b?x=1&y=<2>" })).toBe(
      "https://jira.example.com/new?s=12&u=https%3A%2F%2Fsite.example%2Fa%20b%3Fx%3D1%26y%3D%3C2%3E",
    );
    expect(
      substituteActionUrl("https://x.example/{id}/{projectSlug}", { id: "a/b", projectSlug: null }),
    ).toBe("https://x.example/a%2Fb/");
  });
});

describe("public widget config", () => {
  it("drops team actions and enforces privacy mode", async () => {
    const { publicWidgetConfig } = await import("./config");
    const w = widgetConfig.parse({
      privacyMode: true,
      panelActions: [
        { id: "a", label: "A", kind: "link", url: "https://a.example/" },
        { id: "b", label: "B", kind: "link", url: "https://b.example/", visibleTo: "team" },
        { id: "c", label: "C", kind: "webhook", url: "https://c.example/" },
      ],
    });
    const out = publicWidgetConfig(w, captureConfig.parse({ console: "all" }));
    expect(out.widget.panelActions.map((a) => a.id)).toEqual(["a"]);
    expect(out.widget.consent.enabled).toBe(true);
    expect(out.capture.console).toBe("errors");
    const off = publicWidgetConfig(widgetConfig.parse({}), captureConfig.parse({ console: "off" }));
    expect(off.capture.console).toBe("off");
    expect(off.widget.consent.enabled).toBe(false);
  });
});

describe("widget branding", () => {
  it("defaults and validates", async () => {
    const { parseWidgetBranding, widgetBranding } = await import("./config");
    expect(parseWidgetBranding(undefined)).toEqual({
      hidePoweredBy: false,
      dialogAccent: null,
      logoUrl: null,
    });
    expect(widgetBranding.safeParse({ logoUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(parseWidgetBranding({ dialogAccent: "red", hidePoweredBy: true })).toEqual({
      hidePoweredBy: true,
      dialogAccent: null,
      logoUrl: null,
    });
  });
});
