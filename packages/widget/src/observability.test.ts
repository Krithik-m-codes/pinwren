// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { detectObservability, httpsUrl, withObservability } from "./observability";

describe("httpsUrl", () => {
  it("keeps https URLs only", () => {
    expect(httpsUrl("https://app.posthog.com/replay/abc")).toBe("https://app.posthog.com/replay/abc");
    for (const bad of [
      "http://x.test/a",
      "javascript:alert(1)",
      "data:text/html,x",
      "https://user:pw@x.test/",
      "not a url",
      42,
      `https://x.test/${"a".repeat(1000)}`,
    ])
      expect(httpsUrl(bad)).toBeUndefined();
  });
});

describe("detectObservability", () => {
  it("finds nothing on a bare page", () => expect(detectObservability({})).toEqual({}));

  it("reads Sentry scope helpers and the replay id, with the web host from the DSN", () => {
    const w = {
      Sentry: {
        getCurrentScope: () => ({ lastEventId: () => "0123456789abcdef0123456789abcdef" }),
        getReplay: () => ({ getReplayId: () => "r-1" }),
        getClient: () => ({ getOptions: () => ({ dsn: "https://k@o42.ingest.de.sentry.io/7" }) }),
      },
    };
    expect(detectObservability(w).sentry).toEqual({
      eventId: "0123456789abcdef0123456789abcdef",
      replayId: "r-1",
      host: "de.sentry.io",
    });
  });
  it("falls back to the v7 __SENTRY__ hub", () => {
    const hub = {
      lastEventId: () => "abc123",
      getClient: () => ({ getOptions: () => ({ dsn: "https://k@sentry.acme.test/1" }) }),
    };
    expect(detectObservability({ __SENTRY__: { hub } }).sentry).toEqual({
      eventId: "abc123",
      host: "sentry.acme.test",
    });
  });
  it("reads PostHog, LogRocket and Datadog", () => {
    const w = {
      posthog: {
        get_session_id: () => "ph-1",
        get_session_replay_url: () => "https://eu.posthog.com/replay/ph-1?t=3",
      },
      LogRocket: { sessionURL: "https://app.logrocket.com/org/app/s/1" },
      DD_RUM: {
        getInternalContext: () => ({ session_id: "dd-9", application_id: "app-1" }),
        getInitConfiguration: () => ({ site: "datadoghq.eu" }),
      },
    };
    expect(detectObservability(w)).toEqual({
      posthog: { sessionId: "ph-1", replayUrl: "https://eu.posthog.com/replay/ph-1?t=3" },
      logrocket: { sessionUrl: "https://app.logrocket.com/org/app/s/1" },
      datadog: { sessionId: "dd-9", applicationId: "app-1", site: "datadoghq.eu" },
    });
  });
  it("drops unsafe values and survives SDKs that throw", () => {
    const w = {
      posthog: {
        get_session_id: () => "bad id with spaces",
        get_session_replay_url: () => "javascript:alert(1)",
      },
      LogRocket: {
        get sessionURL(): string {
          throw new Error("nope");
        },
      },
      DD_RUM: {
        getInternalContext: () => {
          throw new Error("nope");
        },
      },
      Sentry: { lastEventId: () => "<script>" },
    };
    expect(detectObservability(w)).toEqual({});
  });
});

describe("withObservability", () => {
  const found = { posthog: { sessionId: "p" } };
  it("adds to the host metadata, detected values winning over the host's own", () => {
    const host = { plan: "pro", observability: { posthog: { sessionId: "old" }, sentry: { eventId: "e" } } };
    expect(withObservability(host, false, found)).toEqual({
      plan: "pro",
      observability: { posthog: { sessionId: "p" }, sentry: { eventId: "e" } },
    });
  });
  it("leaves metadata alone when nothing was found", () => {
    expect(withObservability({ a: 1 }, false, {})).toEqual({ a: 1 });
    expect(withObservability(null, false, {})).toBeNull();
  });
  it("skips detection in privacy mode", () => {
    const w = window as unknown as Record<string, unknown>;
    w.LogRocket = { sessionURL: "https://x.test/s" };
    try {
      expect(withObservability(null, true)).toBeNull();
    } finally {
      delete w.LogRocket;
    }
  });
});
