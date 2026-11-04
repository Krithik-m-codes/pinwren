import { describe, expect, it } from "vitest";
import { observabilityLinks, safeHttpsUrl } from "./observability";

describe("safeHttpsUrl", () => {
  it("accepts https only", () => {
    expect(safeHttpsUrl("https://eu.posthog.com/replay/x")).toBe("https://eu.posthog.com/replay/x");
    for (const bad of [
      "http://a.test/",
      "javascript:alert(1)",
      "//a.test/",
      "https://u:p@a.test/",
      "x",
      1,
      null,
    ])
      expect(safeHttpsUrl(bad)).toBeNull();
  });
});

describe("observabilityLinks", () => {
  it("returns nothing without observability metadata", () => {
    expect(observabilityLinks(null)).toEqual([]);
    expect(observabilityLinks({ plan: "pro" })).toEqual([]);
    expect(observabilityLinks({ observability: "x" })).toEqual([]);
    expect(observabilityLinks({ observability: [] })).toEqual([]);
  });
  it("builds links for every provider", () => {
    const links = observabilityLinks({
      observability: {
        sentry: { eventId: "abc123", replayId: "r1", host: "de.sentry.io" },
        posthog: { sessionId: "s", replayUrl: "https://eu.posthog.com/replay/s" },
        logrocket: { sessionUrl: "https://app.logrocket.com/o/a/s/1" },
        datadog: { sessionId: "dd1", site: "datadoghq.eu" },
      },
    });
    expect(links).toEqual([
      { provider: "sentry", kind: "event", href: "https://de.sentry.io/issues/?query=id%3Aabc123" },
      { provider: "sentry", kind: "replay", href: "https://de.sentry.io/replays/r1/" },
      { provider: "posthog", kind: "replay", href: "https://eu.posthog.com/replay/s" },
      { provider: "logrocket", kind: "session", href: "https://app.logrocket.com/o/a/s/1" },
      { provider: "datadog", kind: "replay", href: "https://app.datadoghq.eu/rum/replay/sessions/dd1" },
    ]);
  });
  it("defaults hosts and rejects hostile values", () => {
    expect(observabilityLinks({ observability: { sentry: { eventId: "e1" } } })[0]?.href).toBe(
      "https://sentry.io/issues/?query=id%3Ae1",
    );
    expect(
      observabilityLinks({
        observability: {
          sentry: { eventId: "a b", replayId: "../x", host: "evil.test/path?x=" },
          posthog: { replayUrl: "javascript:alert(1)" },
          logrocket: { sessionUrl: "http://insecure.test/s" },
          datadog: { sessionId: "ok", site: "x.test/@evil.test" },
        },
      }),
    ).toEqual([
      // the datadog id is valid; the bad site falls back to the default
      { provider: "datadog", kind: "replay", href: "https://app.datadoghq.com/rum/replay/sessions/ok" },
    ]);
  });
});
