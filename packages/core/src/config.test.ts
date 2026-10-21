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
