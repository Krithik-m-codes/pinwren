import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unused";
  process.env.ANNOTA_URL ??= "http://localhost:3100";
  process.env.ANNOTA_SECRET ??= "x".repeat(48);
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
    const h = await hashToken("ann_secret");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyToken("ann_secret", h)).toBe(true);
    expect(await verifyToken("ann_other", h)).toBe(false);
    expect(await verifyToken("ann_secret", "garbage")).toBe(false);
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
    expect(req.headers["annota-signature"]).toBe(`v1=${expected}`);
    expect(req.headers["annota-timestamp"]).toBe("1700000000");
    expect(req.headers["annota-event"]).toBe("feedback.created");
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
    const parsed = JSON.parse(buildRequest("discord", payload, null).body);
    expect(parsed.allowed_mentions).toEqual({ parse: [] });
    const text = JSON.stringify(parsed);
    expect(text).not.toMatch(/(^|[^\\])\[x\]\(/);
    expect(text).not.toContain("@everyone");
  });
});

describe("email templates", () => {
  it("escape user content and drop unsafe links", async () => {
    const { newFeedbackEmail, reporterUpdateEmail } = await import("./email/templates");
    const m = newFeedbackEmail({
      projectName: "<b>P</b>",
      number: 1,
      kind: "bug",
      title: "x\r\nBcc: victim@example.com",
      body: "<script>alert(1)</script>",
      pageUrl: "javascript:alert(1)",
      reporterName: '"><img src=x>',
      link: "http://localhost:3100/inbox",
    });
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<img src=x>");
    expect(m.html).not.toContain("javascript:");
    expect(m.subject).not.toMatch(/[\r\n]/);
    const r = reporterUpdateEmail({
      projectName: "P",
      number: 1,
      kind: "bug",
      title: null,
      body: "b",
      pageUrl: "https://example.com/a",
      reporterName: null,
      type: "status",
      status: "resolved",
    });
    expect(r.text).toContain("resolved");
  });
});

describe("S3 driver", () => {
  const opts = {
    endpoint: "https://s3.example.com",
    bucket: "annota",
    region: "auto",
    accessKeyId: "AKID",
    secretAccessKey: "SECRET",
  };

  it("signs path-style requests and maps 404 to null", async () => {
    const { s3Driver } = await import("./storage");
    const seen: Request[] = [];
    const fake = (async (req: Request) => {
      seen.push(req);
      if (req.method === "GET") return new Response(null, { status: 404 });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const s3 = s3Driver({ ...opts, forcePathStyle: true }, fake);
    await s3.put("p1/abc.png", new Uint8Array([1, 2, 3]), "image/png");
    expect(await s3.get("p1/abc.png")).toBeNull();
    await s3.remove("p1/abc.png");
    expect(seen.map((r) => `${r.method} ${r.url}`)).toEqual([
      "PUT https://s3.example.com/annota/p1/abc.png",
      "GET https://s3.example.com/annota/p1/abc.png",
      "DELETE https://s3.example.com/annota/p1/abc.png",
    ]);
    expect(seen[0]?.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKID\//);
  });

  it("uses virtual-hosted URLs and refuses odd keys", async () => {
    const { s3Driver } = await import("./storage");
    const urls: string[] = [];
    const fake = (async (req: Request) => {
      urls.push(req.url);
      return new Response("hi", { status: 200, headers: { "content-length": "2" } });
    }) as typeof fetch;
    const s3 = s3Driver({ ...opts, forcePathStyle: false }, fake);
    const got = await s3.get("p1/abc.pdf");
    expect(got?.bytes).toBe(2);
    expect(urls[0]).toBe("https://annota.s3.example.com/p1/abc.pdf");
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
