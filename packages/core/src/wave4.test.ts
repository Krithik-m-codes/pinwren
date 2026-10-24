import { describe, expect, it } from "vitest";
import { parseCaptureConfig, parseWidgetConfig, publicWidgetConfig } from "./config";
import { licensePayload } from "./license";
import { presenceUpdate, streamQuery } from "./realtime";
import { reviewRoundUpdate, savedViewCreate, viewFilters } from "./rounds";
import { feedbackListQuery, feedbackUpdate, widgetFeedbackCreate } from "./schemas";
import { urlPatternMatches, urlPatternRegexSource } from "./url-pattern";

const base = {
  clientId: "0192f0c4-4f6e-7c1a-8d55-9a3e2b1c4d5e",
  kind: "bug",
  body: "x",
  page: { url: "https://example.com/a" },
  environment: { userAgent: "ua", viewport: { w: 1, h: 1 }, dpr: 1 },
};

describe("wave-4 config", () => {
  it("defaults visibility and replay", () => {
    expect(parseWidgetConfig({}).visibility).toEqual({
      environments: "all",
      minViewportWidth: 0,
      mode: "always",
      urlPatterns: [],
      queryParam: "pinwren",
    });
    expect(parseCaptureConfig({}).replay).toEqual({ enabled: false, seconds: 60 });
  });

  it("keeps replay seconds in 30..120", () => {
    expect(parseCaptureConfig({ replay: { enabled: true, seconds: 5 } }).replay).toEqual({
      enabled: true,
      seconds: 60,
    });
    expect(parseCaptureConfig({ replay: { seconds: 120 } }).replay.seconds).toBe(120);
  });

  it("passes visibility through to the widget", () => {
    const w = parseWidgetConfig({ visibility: { environments: "non-production", minViewportWidth: 600 } });
    expect(publicWidgetConfig(w, parseCaptureConfig({})).widget.visibility.minViewportWidth).toBe(600);
  });
});

describe("widget feedback (wave 4)", () => {
  it("accepts roundId, consent, replay and a signed identity", () => {
    const r = widgetFeedbackCreate.safeParse({
      ...base,
      roundId: "0192f0c4-4f6e-7c1a-8d55-9a3e2b1c4d5f",
      consent: { version: "v2", acceptedAt: "2026-10-22T10:00:00.000Z" },
      replay: { dataUrl: "data:application/gzip;base64,H4sI", durationMs: 1000, events: 3 },
      reporter: { externalId: "u1", signature: "a".repeat(64) },
    });
    expect(r.success).toBe(true);
  });

  it("rejects a replay of another type and a malformed signature", () => {
    expect(
      widgetFeedbackCreate.safeParse({
        ...base,
        replay: { dataUrl: "data:image/png;base64,AAAA", durationMs: 1, events: 1 },
      }).success,
    ).toBe(false);
    expect(widgetFeedbackCreate.safeParse({ ...base, reporter: { signature: "zz" } }).success).toBe(false);
    expect(
      widgetFeedbackCreate.safeParse({ ...base, consent: { version: "v1", acceptedAt: "yesterday" } })
        .success,
    ).toBe(false);
  });

  it("lets the dashboard move items between rounds and filter by them", () => {
    expect(feedbackUpdate.parse({ roundId: null }).roundId).toBeNull();
    const q = feedbackListQuery.parse({ roundId: "0192f0c4-4f6e-7c1a-8d55-9a3e2b1c4d5f", priority: "high" });
    expect(q.status).toBe("active");
    expect(q.priority).toBe("high");
    expect(feedbackListQuery.safeParse({ since: "nope" }).success).toBe(false);
  });
});

describe("rounds, views, presence", () => {
  it("validates round updates", () => {
    expect(reviewRoundUpdate.safeParse({ status: "archived" }).success).toBe(false);
    expect(reviewRoundUpdate.parse({ dueAt: null }).dueAt).toBeNull();
  });

  it("stores only chosen filters", () => {
    expect(viewFilters.parse({})).toEqual({});
    expect(savedViewCreate.parse({ name: "Mine" })).toEqual({
      name: "Mine",
      filters: {},
      layout: "list",
      shared: false,
    });
  });

  it("parses presence and stream queries", () => {
    expect(presenceUpdate.parse({ feedbackId: null }).feedbackId).toBeNull();
    const id = "0192f0c4-4f6e-7c1a-8d55-9a3e2b1c4d5f";
    expect(streamQuery.parse({ projectIds: `${id}, ${id}` }).projectIds).toEqual([id, id]);
    expect(streamQuery.parse({}).projectIds).toEqual([]);
    expect(streamQuery.safeParse({ projectIds: "x" }).success).toBe(false);
  });
});

describe("url patterns", () => {
  it("matches :params and wildcards on the path only", () => {
    expect(urlPatternMatches("/product/:id", "https://shop.example/product/42?ref=x#top")).toBe(true);
    expect(urlPatternMatches("/product/:id", "https://shop.example/product/42/")).toBe(true);
    expect(urlPatternMatches("/product/:id", "https://shop.example/product/")).toBe(false);
    expect(urlPatternMatches("/product/:id", "https://shop.example/product/4/reviews")).toBe(false);
    expect(urlPatternMatches("/blog/*", "https://x.dev/blog/2026/10/post")).toBe(true);
    expect(urlPatternMatches("/docs/*/intro", "https://x.dev/docs/a/b/intro")).toBe(true);
    expect(urlPatternMatches("https://other.example/a/:b", "https://x.dev/a/1")).toBe(true);
    expect(urlPatternMatches("/", "https://x.dev/")).toBe(true);
    expect(urlPatternMatches("product/:id", "/product/9")).toBe(true);
  });

  it("treats regex characters literally", () => {
    expect(urlPatternMatches("/a.b/(x)", "https://x.dev/a.b/(x)")).toBe(true);
    expect(urlPatternMatches("/a.b", "https://x.dev/aXb")).toBe(false);
    expect(urlPatternRegexSource("/a+b")).toBe("^/a\\+b/?$");
    expect(urlPatternRegexSource("")).toBeNull();
    expect(urlPatternRegexSource("x".repeat(600))).toBeNull();
  });
});

describe("licence payload", () => {
  const lic = {
    v: 1,
    kid: "k1",
    lid: "lic_1",
    customer: "Acme",
    edition: "enterprise",
    features: ["white_label", "future_thing"],
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2027-01-01T00:00:00Z",
  };
  it("fills defaults and keeps unknown features", () => {
    const p = licensePayload.parse(lic);
    expect(p.graceDays).toBe(30);
    expect(p.instance).toBeNull();
    expect(p.features).toContain("future_thing");
  });
  it("rejects other editions and versions", () => {
    expect(licensePayload.safeParse({ ...lic, edition: "community" }).success).toBe(false);
    expect(licensePayload.safeParse({ ...lic, v: 2 }).success).toBe(false);
  });
});
