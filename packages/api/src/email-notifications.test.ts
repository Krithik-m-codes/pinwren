import { beforeAll, describe, expect, it } from "vitest";

// Wave 5, email + notifications (docs/contracts/wave-5.md §3.2): the pure parts of the delivery log, signed
// email links, rich templates, digests, the bell's paging and the per-user stream event.

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unused";
  process.env.PINWREN_URL ??= "http://localhost:3100";
  process.env.PINWREN_SECRET ??= "x".repeat(48);
});

describe("SMTP settings", () => {
  it("accepts an address or Name <address> as From, nothing else", async () => {
    const { isValidFrom } = await import("./email/config");
    expect(isValidFrom("noreply@example.com")).toBe(true);
    expect(isValidFrom("Pinwren <noreply@example.com>")).toBe(true);
    expect(isValidFrom('"Acme, Inc." <hello@acme.io>')).toBe(true);
    expect(isValidFrom("noreply")).toBe(false);
    expect(isValidFrom("Pinwren <noreply>")).toBe(false);
    expect(isValidFrom("a@b.co, c@d.co")).toBe(false);
    expect(isValidFrom("x@y.co\r\nBcc: z@evil.co")).toBe(false);
    expect(isValidFrom("")).toBe(false);
  });
});

describe("delivery log", () => {
  it("names the kind of SMTP failure before the server's words", async () => {
    const { describeEmailError } = await import("./email/deliveries");
    const err = (code: string, message: string, responseCode?: number) =>
      Object.assign(new Error(message), { code, responseCode });
    expect(describeEmailError(err("EAUTH", "Invalid login: 535 5.7.8 bad credentials", 535))).toMatch(
      /^Authentication failed: Invalid login/,
    );
    expect(describeEmailError(err("ECONNECTION", "connect ECONNREFUSED 10.0.0.1:587"))).toMatch(
      /^Connection failed/,
    );
    expect(describeEmailError(err("ESOCKET", "self-signed certificate in certificate chain"))).toMatch(
      /^TLS problem/,
    );
    expect(describeEmailError(err("EDNS", "getaddrinfo ENOTFOUND smtp.nowhere"))).toMatch(/^Host not found/);
    expect(describeEmailError(err("EENVELOPE", "550 mailbox unavailable", 550))).toMatch(
      /^Rejected by the server/,
    );
    expect(describeEmailError("weird")).toBe("Send failed");
    expect(describeEmailError(err("X", "y".repeat(1000))).length).toBeLessThan(340);
  });
});

describe("signed links in team emails", () => {
  it("round-trips team unsubscribe tokens and refuses tampering", async () => {
    const { teamUnsubscribeToken, verifyTeamUnsubscribeToken, teamUnsubscribeUrl } =
      await import("./email/links");
    const m = teamUnsubscribeToken({ kind: "member", userId: "u1", projectId: "p1" });
    expect(verifyTeamUnsubscribeToken(m)).toEqual({ kind: "member", userId: "u1", projectId: "p1" });
    const x = teamUnsubscribeToken({ kind: "address", email: " Boss@Example.com ", projectId: "p1" });
    expect(verifyTeamUnsubscribeToken(x)).toEqual({
      kind: "address",
      email: "boss@example.com",
      projectId: "p1",
    });
    const [part = "", mac = ""] = m.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, k: "m", u: "u2", p: "p1" })).toString("base64url");
    expect(verifyTeamUnsubscribeToken(`${forged}.${mac}`)).toBeNull();
    expect(verifyTeamUnsubscribeToken(`${part}.${mac}x`)).toBeNull();
    expect(verifyTeamUnsubscribeToken("")).toBeNull();
    expect(teamUnsubscribeUrl({ kind: "member", userId: "u1", projectId: "p1" })).toMatch(
      /^http:\/\/localhost:3100\/api\/unsubscribe\/team\?token=/,
    );
  });

  it("keeps purposes apart: an unsubscribe token is not an image token", async () => {
    const { emailImageToken, teamUnsubscribeToken, verifyEmailImageToken } = await import("./email/links");
    const { unsubscribeToken } = await import("./email/unsubscribe");
    expect(
      verifyEmailImageToken(teamUnsubscribeToken({ kind: "member", userId: "a", projectId: "b" })),
    ).toBeNull();
    expect(verifyEmailImageToken(unsubscribeToken("o", "a@b.co"))).toBeNull();
    const now = Date.UTC(2026, 0, 1);
    const t = emailImageToken("asset-1", now);
    expect(verifyEmailImageToken(t, now + 86_400_000)).toBe("asset-1");
    expect(verifyEmailImageToken(t, now + 181 * 86_400_000)).toBeNull();
  });
});

describe("rich team emails", () => {
  const facts = {
    projectName: "Shop",
    number: 7,
    kind: "bug",
    title: "Pay button dead",
    body: "Nothing happens",
    pageUrl: "https://shop.example.com/checkout",
    reporterName: "Maria",
    link: "http://localhost:3100/inbox?status=all&org=o1&item=f1",
    priority: "high",
    browser: "Chrome 131",
    os: "macOS",
    consoleErrors: 2,
    failedRequests: 0,
    hasReplay: true,
    screenshotUrl: "http://localhost:3100/api/email-assets/abc.def",
  };

  it("shows the screenshot and the facts under the body of new-report emails", async () => {
    const { feedbackVars, renderDefault } = await import("./email/templates");
    const out = renderDefault("feedback_created", feedbackVars(facts));
    expect(out.html).toContain('<img src="http://localhost:3100/api/email-assets/abc.def"');
    expect(out.html).toContain("Chrome 131 on macOS");
    expect(out.html).toContain("Console errors");
    expect(out.html).not.toContain("Failed requests"); // zero: no row
    expect(out.html).toContain("Session replay");
    expect(out.text).toContain("Priority: high");
    expect(out.text).toContain("Page: https://shop.example.com/checkout");
  });

  it("escapes facts and never embeds a non-http image", async () => {
    const { feedbackVars, renderDefault } = await import("./email/templates");
    const out = renderDefault(
      "feedback_assigned",
      feedbackVars({ ...facts, browser: "<script>x</script>", screenshotUrl: "javascript:alert(1)" }),
    );
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).not.toContain("<img");
  });

  it("leaves facts out of templates that don't ask for them, and adds the team footer", async () => {
    const { feedbackVars, renderTemplate, TEMPLATES } = await import("./email/templates");
    const out = renderTemplate("status_changed", TEMPLATES.status_changed, feedbackVars(facts), undefined, {
      manageUrl: "http://localhost:3100/settings/notifications?tab=mine",
    });
    expect(out.html).not.toContain("Console errors");
    expect(out.html).toContain("Manage notifications");
    expect(out.text).toContain("Manage notifications: http://localhost:3100/settings/notifications?tab=mine");
  });

  it("links reporter emails to the thread on the page", async () => {
    const { reporterThreadUrl } = await import("./jobs/thread-url");
    const id = "0192f0c4-4f6e-7c1a-8d55-9a3e2b1c4d5e";
    const url = new URL(reporterThreadUrl(id, "https://shop.example.com/checkout?x=1"));
    expect(url.searchParams.get("pinwren")).toBe(id);
    expect(url.searchParams.get("pwt")).toBeTruthy();
    expect(url.searchParams.get("x")).toBe("1");
    expect(reporterThreadUrl(id, null)).toBe("");
    expect(reporterThreadUrl(id, "javascript:alert(1)")).toBe("");
  });

  it("counts console errors and failed requests from diagnostics", async () => {
    const { diagnosticCounts } = await import("./services/feedback-payload");
    expect(
      diagnosticCounts({
        console: [{ level: "error" }, { level: "warn" }, { level: "error" }],
        network: [{ status: 200 }, { status: 404 }, { status: 0 }, { status: 503 }],
      }),
    ).toEqual({ consoleErrors: 2, failedRequests: 3 });
    expect(diagnosticCounts(null)).toEqual({ consoleErrors: 0, failedRequests: 0 });
  });
});

describe("who gets an instant email", () => {
  it("needs the project's email switch, no pause and no digest", async () => {
    const { instantEmail } = await import("./jobs/notify");
    expect(instantEmail({ wantsEmail: true, paused: false, digest: "off" })).toBe(true);
    expect(instantEmail({ wantsEmail: false, paused: false, digest: "off" })).toBe(false);
    expect(instantEmail({ wantsEmail: true, paused: true, digest: "off" })).toBe(false);
    expect(instantEmail({ wantsEmail: true, paused: false, digest: "daily" })).toBe(false);
  });

  it("normalises extra recipient addresses", async () => {
    const { normaliseEmails } = await import("./routes/project-notifications");
    expect(normaliseEmails(["A@x.io", "a@x.io ", "b@y.io"])).toEqual(["a@x.io", "b@y.io"]);
  });
});

describe("digests", () => {
  it("is due hourly or daily since the last one", async () => {
    const { digestDue } = await import("./jobs/digest");
    const now = new Date("2026-10-22T10:05:00Z");
    expect(digestDue("off", null, now)).toBe(false);
    expect(digestDue("hourly", null, now)).toBe(true);
    expect(digestDue("hourly", new Date("2026-10-22T09:05:02Z"), now)).toBe(true);
    expect(digestDue("hourly", new Date("2026-10-22T09:30:00Z"), now)).toBe(false);
    expect(digestDue("daily", new Date("2026-10-21T10:05:30Z"), now)).toBe(true);
    expect(digestDue("daily", new Date("2026-10-22T01:00:00Z"), now)).toBe(false);
  });

  it("writes one readable line per notification, capped", async () => {
    const { digestLine, digestSummary } = await import("./jobs/digest");
    const data = {
      number: 42,
      title: "Checkout broken",
      projectName: "Shop",
      actorName: "Dana",
      kind: "bug",
    };
    expect(digestLine({ type: "feedback.created", data })).toBe(
      "#42 Checkout broken — new bug report from Dana (Shop)",
    );
    expect(digestLine({ type: "comment.mentioned", data })).toBe(
      "#42 Checkout broken — Dana mentioned you (Shop)",
    );
    expect(digestLine({ type: "webhook.disabled", data: { name: "Slack" } })).toBe(
      "Integrations: webhook “Slack” was disabled",
    );
    const many = Array.from({ length: 60 }, () => ({ type: "feedback.created", data }));
    const s = digestSummary(many);
    expect(s.split("\n")).toHaveLength(51);
    expect(s).toMatch(/…and 10 more$/);
  });
});

describe("notifications list", () => {
  it("pages with an opaque cursor", async () => {
    const { decodeCursor, encodeCursor } = await import("./routes/notifications");
    const at = new Date("2026-10-22T10:00:00.123Z");
    const id = "0192f0c4-4f6e-7c1a-8d55-9a3e2b1c4d5e";
    expect(decodeCursor(encodeCursor(at, id))).toEqual({ createdAt: at, id });
    expect(decodeCursor("nonsense")).toBeNull();
    expect(decodeCursor(Buffer.from("2026-10-22|not-a-uuid").toString("base64url"))).toBeNull();
  });

  it("delivers notification.created only to that person's streams in that workspace", async () => {
    const bus = await import("./realtime/bus");
    bus.resetBusForTests();
    const st = (globalThis as unknown as { __pinwrenBus: { listening: unknown } }).__pinwrenBus;
    st.listening = Promise.resolve();
    const got: Record<string, string[]> = { a: [], b: [], other: [] };
    const sub = (key: string, orgId: string, userId: string) =>
      bus.subscribe({ orgId, userId, projectIds: null, send: (m) => got[key]?.push(m.event) });
    const a = await sub("a", "o1", "u1");
    const b = await sub("b", "o1", "u2");
    const other = await sub("other", "o2", "u1");
    const data = {
      id: "n1",
      type: "feedback.created",
      feedbackId: null,
      orgId: "o1",
      data: {},
      createdAt: "",
    };
    bus.receive({ t: "n", orgId: "o1", userId: "u1", data });
    expect(got).toEqual({ a: ["notification.created"], b: [], other: [] });
    // Never replayed: the bell refetches on reconnect instead.
    const resumed = await bus.subscribe(
      { orgId: "o1", userId: "u1", projectIds: null, send: () => undefined },
      "x",
    );
    expect(resumed.backlog).toEqual([]);
    for (const s of [a, b, other, resumed]) s.unsubscribe();
  });
});
