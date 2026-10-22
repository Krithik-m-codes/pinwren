import { generateKeyPairSync, sign } from "node:crypto";
import { gzipSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unused@127.0.0.1:1/none";
  process.env.PINWREN_URL ??= "http://localhost:3100";
  process.env.PINWREN_SECRET ??= "x".repeat(48);
});

describe("PDF export", () => {
  it("writes a valid-looking PDF with escaped text", async () => {
    const { renderPdf } = await import("./export/pdf");
    const bytes = renderPdf({
      title: "Site — Sprint (1)",
      subtitle: "Review round",
      items: [{ heading: "#1 a) b\\c", meta: "Bug · Open", body: "Hello\nWorld ✓ 漢字 “quoted”" }],
    });
    const text = Buffer.from(bytes).toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("(#1 a\\) b\\\\c)");
    // Em dash and curly quotes map to WinAnsi bytes (octal), unsupported glyphs to "?".
    expect(text).toContain("\\227");
    expect(text).toContain("\\223quoted\\224");
    expect(text).toContain("??");
    // xref offsets point at the objects.
    const xref = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(xref, xref + 4)).toBe("xref");
    const first = /0000000000 65535 f \n(\d{10})/.exec(text)?.[1];
    expect(text.slice(Number(first), Number(first) + 7)).toBe("1 0 obj");
  });

  it("wraps long text across lines and pages", async () => {
    const { renderPdf, wrap } = await import("./export/pdf");
    const lines = wrap("word ".repeat(400) + "x".repeat(300), 10, 200);
    expect(lines.length).toBeGreaterThan(20);
    const many = renderPdf({
      title: "Many",
      subtitle: "",
      items: Array.from({ length: 60 }, (_, i) => ({
        heading: `#${i}`,
        meta: "",
        body: "lorem ipsum ".repeat(40),
      })),
    });
    const pages = /\/Count (\d+)/.exec(Buffer.from(many).toString("latin1"))?.[1];
    expect(Number(pages)).toBeGreaterThan(3);
  });
});

describe("CSV export", () => {
  it("quotes and neutralises formulas", async () => {
    const { csvCell, toCsv } = await import("./export/csv");
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01T00:00:00.000Z");
    expect(toCsv(["a"], [["x\ny"]])).toBe('﻿a\r\n"x\ny"\r\n');
  });
});

describe("replay summary", () => {
  const events = [
    { type: 4, timestamp: 1000, data: { href: "https://x.dev/a", width: 800, height: 600 } },
    {
      type: 2,
      timestamp: 1001,
      data: {
        node: {
          type: 0,
          id: 1,
          childNodes: [
            {
              type: 2,
              id: 2,
              tagName: "BUTTON",
              attributes: { id: "pay" },
              childNodes: [{ type: 3, id: 3, textContent: " Pay   now " }],
            },
            {
              type: 2,
              id: 4,
              tagName: "input",
              attributes: { name: "email", type: "email" },
              childNodes: [],
            },
          ],
        },
      },
    },
    { type: 3, timestamp: 1500, data: { source: 5, id: 4, text: "***" } },
    { type: 3, timestamp: 1600, data: { source: 5, id: 4, text: "****" } },
    { type: 3, timestamp: 1700, data: { source: 3, id: 1, x: 0, y: 100 } },
    { type: 3, timestamp: 1800, data: { source: 3, id: 1, x: 0, y: 400 } },
    { type: 3, timestamp: 2000, data: { source: 2, type: 2, id: 2 } },
    {
      type: 3,
      timestamp: 2100,
      data: {
        source: 0,
        adds: [
          {
            node: {
              type: 2,
              id: 9,
              tagName: "a",
              attributes: { href: "/help" },
              childNodes: [{ type: 3, id: 10, textContent: "Help" }],
            },
          },
        ],
      },
    },
    { type: 3, timestamp: 2200, data: { source: 2, type: 2, id: 9 } },
    { type: 4, timestamp: 2300, data: { href: "https://x.dev/help" } },
    { type: 3, timestamp: 2400, data: { source: 2, type: 2, id: 999 } },
    "garbage",
    null,
  ];

  it("turns rrweb events into readable, folded steps", async () => {
    const { replaySteps } = await import("./services/replay");
    expect(replaySteps(events).map((s) => s.text)).toEqual([
      "Opened https://x.dev/a",
      "Viewport 800×600",
      "Typed into input[name=email]",
      "Scrolled to y=400",
      'Clicked button#pay "Pay now"',
      'Clicked a "Help" (/help)',
      "Navigated to https://x.dev/help",
      "Clicked an element",
    ]);
  });

  it("reads gzip and refuses anything else", async () => {
    const { readReplay } = await import("./services/replay");
    expect(readReplay(new Uint8Array(gzipSync(JSON.stringify(events))))?.length).toBe(events.length);
    expect(readReplay(new Uint8Array(Buffer.from("plain")))).toBeNull();
    expect(readReplay(new Uint8Array(gzipSync("{}")))).toBeNull();
    expect(readReplay(new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2]))).toBeNull();
  });

  it("makes reporter text Markdown-inert", async () => {
    const { mdText } = await import("./services/reproduction");
    expect(mdText("# [x](javascript:1) <b>`y`</b>")).toBe("\\# \\[x\\](javascript:1) \\<b\\>\\`y\\`\\</b\\>");
  });
});

describe("licences", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const keys = { k1: pub };
  const day = 86_400_000;
  const make = (over: Record<string, unknown> = {}, key = privateKey) => {
    const body = Buffer.from(
      JSON.stringify({
        v: 1,
        kid: "k1",
        lid: "lic_1",
        customer: "Acme",
        edition: "enterprise",
        features: ["white_label"],
        issuedAt: new Date(Date.now() - 10 * day).toISOString(),
        expiresAt: new Date(Date.now() + 100 * day).toISOString(),
        ...over,
      }),
    ).toString("base64url");
    return `${body}.${sign(null, Buffer.from(body), key).toString("base64url")}`;
  };

  it("verifies, and rejects tampering, other keys and unknown kids", async () => {
    const { verifyLicense } = await import("./license/verify");
    expect(verifyLicense(make(), keys).ok).toBe(true);
    const [body, sig] = make().split(".") as [string, string];
    const forged = Buffer.from(
      JSON.stringify({ ...(JSON.parse(Buffer.from(body, "base64url").toString()) as object), customer: "X" }),
    ).toString("base64url");
    const forgedResult = verifyLicense(`${forged}.${sig}`, keys);
    expect(forgedResult.ok ? "" : forgedResult.error).toMatch(/signature/);
    const other = generateKeyPairSync("ed25519").privateKey;
    expect(verifyLicense(make({}, other), keys).ok).toBe(false);
    const unknownKid = verifyLicense(make({ kid: "nope" }), keys);
    expect(unknownKid.ok ? "" : unknownKid.error).toMatch(/Unknown/);
    expect(verifyLicense("garbage", keys).ok).toBe(false);
    expect(verifyLicense(`${body}.!!`, keys).ok).toBe(false);
  });

  it("checks dates and instance binding", async () => {
    const { verifyLicense } = await import("./license/verify");
    expect(verifyLicense(make({ issuedAt: new Date(Date.now() + 5 * day).toISOString() }), keys).ok).toBe(
      false,
    );
    expect(verifyLicense(make({ instance: "abc" }), keys, { instanceId: "abc" }).ok).toBe(true);
    expect(verifyLicense(make({ instance: "abc" }), keys, { instanceId: "xyz" }).ok).toBe(false);
    expect(verifyLicense(make({ edition: "community" }), keys).ok).toBe(false);
  });

  it("moves valid → grace → expired", async () => {
    const { licenseTimeState } = await import("./license/verify");
    const p = {
      v: 1 as const,
      kid: "k1",
      lid: "l",
      customer: "c",
      edition: "enterprise" as const,
      features: [],
      limits: {},
      instance: null,
      issuedAt: "2026-01-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
      graceDays: 30,
    };
    expect(licenseTimeState(p, new Date("2026-12-01T00:00:00Z")).status).toBe("valid");
    expect(licenseTimeState(p, new Date("2027-01-15T00:00:00Z"))).toMatchObject({
      status: "grace",
      daysLeft: 16,
    });
    expect(licenseTimeState(p, new Date("2027-03-01T00:00:00Z")).status).toBe("expired");
  });

  it("resolves entitlements: unknown features dropped, read-only after grace", async () => {
    const { entitlementsFor } = await import("./license");
    const { DEV_KEYS, trustedKeys } = await import("./license/keys");
    expect(Object.keys(trustedKeys("production"))).not.toContain(Object.keys(DEV_KEYS)[0]);
    expect(entitlementsFor(null, null, 3)).toMatchObject({
      edition: "community",
      status: "none",
      seats: { used: 3 },
    });
    expect(entitlementsFor("bad", "upload", 1)).toMatchObject({ status: "invalid", features: [] });
  });
});

describe("unsubscribe tokens", () => {
  it("round-trip and refuse tampering", async () => {
    const { unsubscribeToken, verifyUnsubscribeToken, unsubscribeHeaders } =
      await import("./email/unsubscribe");
    const t = unsubscribeToken("org-1", " Maria@Example.com ");
    expect(verifyUnsubscribeToken(t)).toEqual({ orgId: "org-1", email: "maria@example.com" });
    const [part, mac] = t.split(".") as [string, string];
    const other = Buffer.from(JSON.stringify({ v: 1, o: "org-2", e: "maria@example.com" })).toString(
      "base64url",
    );
    expect(verifyUnsubscribeToken(`${other}.${mac}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${part}.${mac}x`)).toBeNull();
    expect(verifyUnsubscribeToken("x")).toBeNull();
    expect(unsubscribeHeaders("https://x/u")).toEqual({
      "List-Unsubscribe": "<https://x/u>",
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("puts the link in reporter emails and Powered by in Community footers", async () => {
    const { renderDefault, renderTemplate, TEMPLATES } = await import("./email/templates");
    const out = renderTemplate(
      "reporter_reply",
      TEMPLATES.reporter_reply,
      { projectName: "P", title: "t", authorName: "a", reply: "r", pageUrl: "https://x" },
      { productName: "Acme", accent: "#112233", logoUrl: null, poweredBy: true },
      { unsubscribeUrl: "https://fb.example/api/unsubscribe?token=a.b" },
    );
    expect(out.html).toContain('href="https://fb.example/api/unsubscribe?token=a.b"');
    expect(out.html).toContain("Powered by Pinwren");
    expect(out.text).toContain("Unsubscribe: https://fb.example/api/unsubscribe?token=a.b");
    const white = renderDefault(
      "feedback_created",
      {},
      { productName: "Acme", accent: "#112233", logoUrl: null },
    );
    expect(white.html).not.toContain("Powered by");
  });
});

describe("identity signatures", () => {
  it("verify in constant time against the stored secret", async () => {
    const { encryptSecret } = await import("./crypto");
    const { identitySignature, verifyIdentity } = await import("./services/identity");
    const enc = encryptSecret("idsec_test");
    const sig = identitySignature("idsec_test", "u1");
    expect(verifyIdentity(enc, "u1", sig)).toBe(true);
    expect(verifyIdentity(enc, "u1", sig.toUpperCase())).toBe(true);
    expect(verifyIdentity(enc, "u2", sig)).toBe(false);
    expect(verifyIdentity(null, "u1", sig)).toBe(false);
    expect(verifyIdentity(enc, undefined, sig)).toBe(false);
    expect(verifyIdentity("garbage", "u1", sig)).toBe(false);
  });
});

describe("realtime bus", () => {
  it("fans out by org and project, keeps a ring for Last-Event-ID", async () => {
    const bus = await import("./realtime/bus");
    bus.resetBusForTests();
    const got: { a: string[]; b: string[] } = { a: [], b: [] };
    // No LISTEN connection in unit tests: register subscribers on the state directly via receive().
    const st = (globalThis as unknown as { __pinwrenBus: { subscribers: Set<unknown>; listening: unknown } })
      .__pinwrenBus;
    st.listening = Promise.resolve();
    const a = await bus.subscribe({ orgId: "o1", projectIds: null, send: (m) => got.a.push(m.event) });
    const b = await bus.subscribe({
      orgId: "o1",
      projectIds: new Set(["p2"]),
      send: (m) => got.b.push(m.event),
    });
    bus.receive({ t: "e", orgId: "o1", projectId: "p1", event: "feedback.created", data: { id: "f1" } });
    bus.receive({ t: "e", orgId: "o2", projectId: "p1", event: "feedback.created", data: { id: "x" } });
    bus.receive({ t: "e", orgId: "o1", projectId: "p2", event: "feedback.updated", data: { id: "f2" } });
    expect(got.a).toEqual(["feedback.created", "feedback.updated"]);
    expect(got.b).toEqual(["feedback.updated"]);

    const u = { id: "u1", name: "Ann", image: null };
    bus.receive({ t: "p", orgId: "o1", projectId: "p1", feedbackId: "f1", user: u });
    bus.receive({ t: "p", orgId: "o1", projectId: "p1", feedbackId: "f1", user: u }); // heartbeat: no event
    expect(got.a.filter((e) => e === "presence")).toHaveLength(1);
    bus.sweepPresence(Date.now() + 60_000);
    expect(got.a.filter((e) => e === "presence")).toHaveLength(2);

    const ids: string[] = [];
    const c = await bus.subscribe({ orgId: "o1", projectIds: null, send: (m) => m.id && ids.push(m.id) });
    c.unsubscribe();
    bus.receive({ t: "e", orgId: "o1", projectId: "p1", event: "comment.created", data: { id: "c1" } });
    const resumed = await bus.subscribe({ orgId: "o1", projectIds: null, send: () => undefined }, null);
    expect(resumed.backlog).toEqual([]);
    a.unsubscribe();
    b.unsubscribe();
    resumed.unsubscribe();
  });

  it("drops oversized changes instead of exceeding the NOTIFY limit", async () => {
    const { encodeMessage, MAX_PAYLOAD_BYTES } = await import("./realtime/bus");
    const text = encodeMessage({
      t: "e",
      orgId: "o",
      projectId: "p",
      event: "feedback.updated",
      data: { id: "f", changes: { title: { from: "x".repeat(8000), to: "y" } } },
    });
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(MAX_PAYLOAD_BYTES);
    expect(JSON.parse(text)).toMatchObject({ data: { truncated: true, changes: { title: null } } });
  });
});
