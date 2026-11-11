import { describe, expect, it } from "vitest";
import {
  captureConfig,
  MAX_RECORDING_SECONDS,
  mergeConfig,
  parseCaptureConfig,
  parseWidgetConfig,
  publicWidgetConfig,
  recordingEnabled,
  widgetConfig,
} from "./config";
import { orgBrandingUpdate, widgetFeedbackCreate, widgetRecording } from "./schemas";

describe("widget config", () => {
  it("fills every default from an empty object", () => {
    const c = parseWidgetConfig({});
    expect(c.launcher).toEqual({
      position: "bottom-right",
      offset: { x: 20, y: 20 },
      shape: "round",
      label: "Feedback",
      icon: "pin",
      accent: "#d63a1c",
      lightAccent: null,
      darkAccent: null,
      hoverEffect: true,
      tooltip: "Give feedback",
      hidden: false,
    });
    expect(c.modes).toEqual({ comment: true, bug: true });
    expect(c.shortcuts).toBe(true);
    expect(c.rightClickComment).toBe(false);
    expect(c.readOnly).toBe(false);
    expect(c.visitorsCanResolve).toBe(false);
    expect(c.consent).toEqual({ enabled: false, text: null, privacyUrl: null });
    expect(widgetConfig.parse({})).toEqual(c);
  });

  it("keeps stored values and fills the rest", () => {
    const c = parseWidgetConfig({ launcher: { position: "top-left", accent: "#123456" }, readOnly: true });
    expect(c.launcher.position).toBe("top-left");
    expect(c.launcher.shape).toBe("round");
    expect(c.launcher.lightAccent).toBeNull();
    expect(c.launcher.darkAccent).toBeNull();
    expect(c.launcher.accent).toBe("#123456");
    expect(c.readOnly).toBe(true);
  });

  it("validates launcher theme colours and hover effect", () => {
    expect(
      widgetConfig.safeParse({
        launcher: { lightAccent: "#112233", darkAccent: "#445566", hoverEffect: false },
      }).success,
    ).toBe(true);
    expect(widgetConfig.safeParse({ launcher: { lightAccent: "red" } }).success).toBe(false);
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

describe("organization favicon branding", () => {
  it("accepts a nullable organization-scoped asset id", () => {
    expect(orgBrandingUpdate.safeParse({ faviconAssetId: null }).success).toBe(true);
    expect(orgBrandingUpdate.safeParse({ faviconAssetId: crypto.randomUUID() }).success).toBe(true);
    expect(orgBrandingUpdate.safeParse({ faviconAssetId: "not-an-id" }).success).toBe(false);
  });
});

describe("capture config", () => {
  it("has defaults", () => {
    expect(parseCaptureConfig(undefined)).toEqual({
      console: "warnings",
      network: "failures",
      quality: "standard",
      allowReduceQuality: true,
      screenshotOnComment: false,
      maskSelectors: [],
      replay: { enabled: false, seconds: 60 },
      recording: { enabled: null, maxSeconds: 120, microphone: true },
    });
  });
  it("takes a screenshot quality and nothing else", () => {
    expect(parseCaptureConfig({ quality: "high" }).quality).toBe("high");
    expect(captureConfig.safeParse({ quality: "ultra" }).success).toBe(false);
    expect(parseCaptureConfig({ allowReduceQuality: false }).allowReduceQuality).toBe(false);
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
    expect(parseWidgetConfig({}).errorPrompt).toBe(false);
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
  it("marks an agent webhook, and only a webhook can be one", () => {
    const hook = { id: "agent", label: "Send to agent", kind: "webhook", url: "https://hooks.example.com/a" };
    expect(widgetConfig.parse({ panelActions: [hook] }).panelActions[0]?.agent).toBe(false);
    const c = widgetConfig.parse({ panelActions: [{ ...hook, agent: true }] });
    expect(c.panelActions[0]).toMatchObject({ agent: true, visibleTo: "team" });
    expect(widgetConfig.safeParse({ panelActions: [{ ...link, agent: true }] }).success).toBe(false);
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
    // the error prompt is opt-in, and never offered in privacy mode
    const on = widgetConfig.parse({ errorPrompt: true });
    expect(publicWidgetConfig(on, captureConfig.parse({})).widget.errorPrompt).toBe(true);
    expect(publicWidgetConfig({ ...on, privacyMode: true }, captureConfig.parse({})).widget.errorPrompt).toBe(
      false,
    );
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

describe("widget report metadata cap", () => {
  const base = {
    clientId: "5f1c6c2e-1d3a-4b7e-9c2a-1a2b3c4d5e6f",
    kind: "bug",
    body: "x",
    page: { url: "https://example.com/" },
    environment: { userAgent: "t", viewport: { w: 1, h: 1 }, dpr: 1 },
  };
  it("accepts small metadata and refuses oversized metadata", async () => {
    const { widgetFeedbackCreate, MAX_METADATA_BYTES } = await import("./schemas");
    expect(widgetFeedbackCreate.safeParse({ ...base, metadata: { plan: "pro" } }).success).toBe(true);
    const big = { pad: "x".repeat(MAX_METADATA_BYTES) };
    expect(widgetFeedbackCreate.safeParse({ ...base, metadata: big }).success).toBe(false);
  });
});

describe("screen recording config", () => {
  const widget = (patch: object = {}) => parseWidgetConfig(patch);
  const capture = (patch: object = {}) => parseCaptureConfig({ recording: patch });

  it("is on unless the project says otherwise, and off by default in privacy mode", () => {
    expect(recordingEnabled(widget(), capture())).toBe(true);
    expect(recordingEnabled(widget({ privacyMode: true }), capture())).toBe(false);
    expect(recordingEnabled(widget(), capture({ enabled: false }))).toBe(false);
  });
  it("lets an admin turn it on deliberately in privacy mode, and never on a read-only project", () => {
    expect(recordingEnabled(widget({ privacyMode: true }), capture({ enabled: true }))).toBe(true);
    expect(recordingEnabled(widget({ readOnly: true }), capture({ enabled: true }))).toBe(false);
  });
  it("hands the widget the resolved value", () => {
    const privacy = publicWidgetConfig(widget({ privacyMode: true }), capture());
    expect(privacy.capture.recording.enabled).toBe(false);
    expect(publicWidgetConfig(widget(), capture()).capture.recording.enabled).toBe(true);
  });
  it("bounds the length at the hard cap", () => {
    expect(captureConfig.safeParse({ recording: { maxSeconds: MAX_RECORDING_SECONDS } }).success).toBe(true);
    expect(captureConfig.safeParse({ recording: { maxSeconds: MAX_RECORDING_SECONDS + 1 } }).success).toBe(
      false,
    );
    expect(captureConfig.safeParse({ recording: { maxSeconds: 1 } }).success).toBe(false);
    // A stored value that no longer validates falls back to the default instead of breaking the widget.
    expect(parseCaptureConfig({ recording: { maxSeconds: 9999 } }).recording.maxSeconds).toBe(120);
  });
});

describe("recording payload", () => {
  const ok = { dataUrl: "data:video/webm;base64,GkXfow==", durationMs: 5000, audio: true };
  it("accepts webm and mp4 and nothing else", () => {
    expect(widgetRecording.safeParse(ok).success).toBe(true);
    expect(widgetRecording.safeParse({ ...ok, dataUrl: "data:video/mp4;base64,AAAA" }).success).toBe(true);
    expect(widgetRecording.safeParse({ ...ok, dataUrl: "data:video/x-flv;base64,AAAA" }).success).toBe(false);
    expect(widgetRecording.safeParse({ ...ok, dataUrl: "data:text/html;base64,AAAA" }).success).toBe(false);
  });
  it("caps the duration", () => {
    expect(widgetRecording.safeParse({ ...ok, durationMs: MAX_RECORDING_SECONDS * 1000 + 1 }).success).toBe(
      false,
    );
  });
});
