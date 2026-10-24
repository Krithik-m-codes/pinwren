import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unused";
  process.env.PINWREN_URL ??= "http://localhost:3100";
  process.env.PINWREN_SECRET ??= "x".repeat(48);
});

describe("secrets at rest", () => {
  it("round-trips and detects tampering", async () => {
    const { decryptSecret, encryptSecret } = await import("./crypto");
    const enc = encryptSecret("smtp-password");
    expect(enc).not.toContain("smtp-password");
    expect(decryptSecret(enc)).toBe("smtp-password");
    expect(encryptSecret("smtp-password")).not.toBe(enc); // random IV
    const parts = enc.split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });

  it("hashes API tokens with scrypt and verifies them", async () => {
    const { hashToken, verifyToken } = await import("./crypto");
    const h = await hashToken("pwt_secret");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyToken("pwt_secret", h)).toBe(true);
    expect(await verifyToken("pwt_other", h)).toBe(false);
    expect(await verifyToken("pwt_secret", "garbage")).toBe(false);
  });
});

describe("webhook formatting", () => {
  const payload = {
    id: "e1",
    event: "feedback.created",
    apiVersion: "2026-11-01",
    createdAt: "2026-10-21T00:00:00.000Z",
    data: {
      feedback: {
        id: "f1",
        number: 7,
        projectId: "p1",
        projectName: "Site",
        kind: "bug",
        status: "open",
        priority: "none",
        title: "<@U123> *bold*",
        body: "<!channel> hi @everyone [x](https://evil.example)",
        pageUrl: "https://example.com/",
        reporterName: "@here",
        assigneeIds: [],
        createdAt: "2026-10-21T00:00:00.000Z",
        updatedAt: "2026-10-21T00:00:00.000Z",
        url: "http://localhost:3100/inbox?item=f1",
      },
    },
  };

  it("signs generic bodies as v1=HMAC(secret, ts.body)", async () => {
    const { buildRequest } = await import("./webhooks/format");
    const req = buildRequest("generic", payload, "whsec_test", 1_700_000_000);
    const expected = createHmac("sha256", "whsec_test").update(`1700000000.${req.body}`).digest("hex");
    expect(req.headers["pinwren-signature"]).toBe(`v1=${expected}`);
    expect(req.headers["pinwren-timestamp"]).toBe("1700000000");
    expect(req.headers["pinwren-event"]).toBe("feedback.created");
  });

  it("never lets Slack see a raw mention", async () => {
    const { buildRequest } = await import("./webhooks/format");
    const body = buildRequest("slack", payload, null).body;
    expect(body).not.toContain("<!channel>");
    expect(body).not.toContain("<@U123>");
    expect(body).toContain("&lt;!channel&gt;");
  });

  it("disables Discord mentions and escapes markdown", async () => {
    const { buildRequest } = await import("./webhooks/format");
    const parsed = JSON.parse(buildRequest("discord", payload, null).body) as { allowed_mentions: unknown };
    expect(parsed.allowed_mentions).toEqual({ parse: [] });
    const text = JSON.stringify(parsed);
    expect(text).not.toMatch(/(^|[^\\])\[x\]\(/);
    expect(text).not.toContain("@everyone");
  });
});

describe("email templates", () => {
  const vars = {
    projectName: "<b>P</b>",
    number: "1",
    kind: "bug",
    title: "x\r\nBcc: victim@example.com",
    body: "<script>alert(1)</script> **not bold**",
    pageUrl: "javascript:alert(1)",
    reporterName: '<script>alert("r")</script>',
    link: "http://localhost:3100/inbox",
  };

  it("escape variables, never format them, and drop unsafe links", async () => {
    const { renderDefault } = await import("./email/templates");
    const m = renderDefault("feedback_created", vars);
    expect(m.html).not.toContain("<script>");
    expect(m.html).toContain("&lt;script&gt;alert(&quot;r&quot;)&lt;/script&gt;");
    expect(m.html).not.toContain("<strong>not bold</strong>");
    expect(m.html).not.toMatch(/href="javascript/);
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.html).toContain('href="http://localhost:3100/inbox"');
    expect(m.text).toContain('<script>alert("r")</script>');
  });

  it("render admin Markdown safely: raw HTML is text, only http(s)/mailto links", async () => {
    const { renderTemplate } = await import("./email/templates");
    const r = renderTemplate(
      "feedback_created",
      {
        subject: "{{title}}",
        body: [
          "# Hi {{reporterName}}",
          "",
          "<img src=x onerror=alert(1)> **bold** [ok]({{link}}) [bad](javascript:alert(1)) [var]({{pageUrl}})",
          "",
          "- one",
          "- two",
        ].join("\n"),
      },
      vars,
      { productName: "Acme Feedback", accent: "#e5484d", logoUrl: "https://cdn.example.com/logo.png" },
    );
    expect(r.html).not.toContain("<img src=x");
    expect(r.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(r.html).toContain("<strong>bold</strong>");
    expect(r.html).toContain('<a href="http://localhost:3100/inbox"');
    expect(r.html).not.toMatch(/href="javascript/);
    expect(r.html).toContain("<li>one</li>");
    expect(r.html).toContain("Sent by Acme Feedback");
    expect(r.html).toContain("#e5484d");
    expect(r.html).toContain('src="https://cdn.example.com/logo.png"');
  });

  it("list unknown variables", async () => {
    const { unknownVariables } = await import("./email/templates");
    expect(unknownVariables("feedback_created", "{{title}}", "{{ reporterName }} {{secret}}")).toEqual([
      "secret",
    ]);
    expect(unknownVariables("invitation", "{{productName}}", "{{acceptUrl}}")).toEqual([]);
  });

  it("pick readable button text", async () => {
    const { contrastText } = await import("./email/templates");
    expect(contrastText("#d63a1c")).toBe("#ffffff");
    expect(contrastText("#ffe066")).toBe("#111118");
  });
});

describe("issue sync", () => {
  it("escapes the reporter's text in issue bodies", async () => {
    const { issueBody, issueTitle } = await import("./integrations/issues");
    const body = issueBody({
      number: 7,
      kind: "bug",
      projectName: "Site",
      body: "<script>x</script> @everyone fixes #1 [x](javascript:alert(1)) | col",
      pageUrl: "https://example.com/a?b=1",
      reporterName: "@octocat",
      environment: { browser: "Chrome 140", os: "macOS", viewport: { w: 1280, h: 800 } },
      link: "http://localhost:3100/inbox?item=1",
      productName: "Pinwren",
    });
    expect(body).not.toContain("<script>");
    expect(body).not.toMatch(/@everyone|@octocat|#1\b/);
    expect(body).not.toContain("[x](javascript");
    expect(body).toContain("[Open #7 in Pinwren](http://localhost:3100/inbox?item=1)");
    expect(body).toContain("1280 × 800");
    expect(issueTitle({ number: 7, title: null, body: "a\nb" })).toBe("#7 a b");
  });

  it("calls GitHub and GitLab the way their APIs expect", async () => {
    const { createIssue, setIssueState } = await import("./integrations/trackers");
    const seen: { url: string; method: string; headers: Headers; body: unknown }[] = [];
    const fake = ((url: string, init: RequestInit) => {
      seen.push({
        url,
        method: init.method ?? "GET",
        headers: new Headers(init.headers),
        body: typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : null,
      });
      const json = url.includes("/api/v4/")
        ? { iid: 3, web_url: "https://gl.example/x/-/issues/3" }
        : { number: 5, html_url: "https://gh.example/o/r/issues/5" };
      return Promise.resolve(new Response(JSON.stringify(json), { status: 201 }));
    }) as unknown as typeof fetch;
    const gh = { provider: "github" as const, token: "ghp_x", repo: "o/r", apiUrl: "https://gh.example/api" };
    expect(await createIssue(gh, { title: "t", body: "b", labels: ["bug"] }, fake)).toEqual({
      number: 5,
      url: "https://gh.example/o/r/issues/5",
    });
    await setIssueState(gh, 5, "closed", fake);
    const gl = {
      provider: "gitlab" as const,
      token: "glpat",
      repo: "grp/sub/proj",
      apiUrl: "https://gl.example",
    };
    expect((await createIssue(gl, { title: "t", body: "b", labels: ["a", "b"] }, fake)).number).toBe(3);
    await setIssueState(gl, 3, "open", fake);
    expect(seen.map((s) => `${s.method} ${s.url}`)).toEqual([
      "POST https://gh.example/api/repos/o/r/issues",
      "PATCH https://gh.example/api/repos/o/r/issues/5",
      "POST https://gl.example/api/v4/projects/grp%2Fsub%2Fproj/issues",
      "PUT https://gl.example/api/v4/projects/grp%2Fsub%2Fproj/issues/3",
    ]);
    expect(seen[0]?.headers.get("authorization")).toBe("Bearer ghp_x");
    expect(seen[0]?.body).toEqual({ title: "t", body: "b", labels: ["bug"] });
    expect(seen[1]?.body).toEqual({ state: "closed", state_reason: "completed" });
    expect(seen[2]?.headers.get("private-token")).toBe("glpat");
    expect(seen[2]?.body).toEqual({ title: "t", description: "b", labels: "a,b" });
    expect(seen[3]?.body).toEqual({ state_event: "reopen" });
  });

  it("reports tracker errors with a hint", async () => {
    const { createIssue, TrackerError } = await import("./integrations/trackers");
    const fake = (() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "Bad credentials" }), {
          status: 401,
        }),
      )) as unknown as typeof fetch;
    const gh = { provider: "github" as const, token: "bad", repo: "o/r", apiUrl: "https://gh.example" };
    await expect(createIssue(gh, { title: "t", body: "b", labels: [] }, fake)).rejects.toThrow(TrackerError);
    await expect(createIssue(gh, { title: "t", body: "b", labels: [] }, fake)).rejects.toThrow(
      /Bad credentials \(check the token\)/,
    );
  });
});

describe("update check", () => {
  it("compares versions numerically", async () => {
    const { isNewerVersion } = await import("./settings/instance");
    expect(isNewerVersion("v0.2.0", "0.1.0")).toBe(true);
    expect(isNewerVersion("1.2.10", "1.2.9")).toBe(true);
    expect(isNewerVersion("v0.1.0", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.1.0-beta.1", "0.1.0")).toBe(false);
    expect(isNewerVersion("0.0.9", "0.1.0")).toBe(false);
  });
});

describe("privacy helpers", () => {
  it("keep only browser and OS family", async () => {
    const { family } = await import("./net");
    expect(family("Chrome 140.0.1")).toBe("Chrome");
    expect(family("Windows 11")).toBe("Windows");
    expect(family("macOS 15.1")).toBe("macOS");
    expect(family(undefined)).toBeUndefined();
  });
});

describe("S3 driver", () => {
  const opts = {
    endpoint: "https://s3.example.com",
    bucket: "pinwren",
    region: "auto",
    accessKeyId: "AKID",
    secretAccessKey: "SECRET",
  };

  it("signs path-style requests and maps 404 to null", async () => {
    const { s3Driver } = await import("./storage");
    const seen: Request[] = [];
    const fake = ((req: Request) => {
      seen.push(req);
      return Promise.resolve(new Response(null, { status: req.method === "GET" ? 404 : 200 }));
    }) as typeof fetch;
    const s3 = s3Driver({ ...opts, forcePathStyle: true }, fake);
    await s3.put("p1/abc.png", new Uint8Array([1, 2, 3]), "image/png");
    expect(await s3.get("p1/abc.png")).toBeNull();
    await s3.remove("p1/abc.png");
    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([
      "PUT https://s3.example.com/pinwren/p1/abc.png",
      "GET https://s3.example.com/pinwren/p1/abc.png",
      "DELETE https://s3.example.com/pinwren/p1/abc.png",
    ]);
    expect(seen[0]?.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\//);
  });

  it("uses virtual-hosted URLs and refuses odd keys", async () => {
    const { s3Driver } = await import("./storage");
    const urls: string[] = [];
    const fake = ((req: Request) => {
      urls.push(req.url);
      return Promise.resolve(new Response("hi", { status: 200, headers: { "content-length": "2" } }));
    }) as typeof fetch;
    const s3 = s3Driver({ ...opts, forcePathStyle: false }, fake);
    const got = await s3.get("p1/abc.pdf");
    expect(got?.bytes).toBe(2);
    expect(urls[0]).toBe("https://pinwren.s3.example.com/p1/abc.pdf");
    await expect(s3.get("../etc/passwd")).rejects.toThrow();
  });
});

describe("data URL decoding", () => {
  it("checks magic bytes", async () => {
    const { decodeDataUrl } = await import("./storage");
    const pdf = `data:application/pdf;base64,${Buffer.from("%PDF-1.7").toString("base64")}`;
    expect(decodeDataUrl(pdf, ["application/pdf"], 100).contentType).toBe("application/pdf");
    expect(() => decodeDataUrl(pdf, ["image/png"], 100)).toThrow(/not allowed/);
    expect(() => decodeDataUrl(pdf, ["application/pdf"], 3)).toThrow(/too large/);
    const fake = `data:application/pdf;base64,${Buffer.from("<html>").toString("base64")}`;
    expect(() => decodeDataUrl(fake, ["application/pdf"], 100)).toThrow(/do not match/);
  });
});
