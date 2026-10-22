import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Attack-proof tests for the pre-release security fixes (ADR 0021). Network tests run against a local
// HTTP server on 127.0.0.1, which the outbound guard must refuse unless explicitly allowed.

beforeAll(() => {
  process.env.DATABASE_URL ??= "postgres://unused";
  process.env.PINWREN_URL ??= "http://localhost:3100";
  process.env.PINWREN_SECRET ??= "x".repeat(48);
});

describe("address classification", () => {
  it("blocks every non-public address in all its spellings", async () => {
    const { isBlockedAddress } = await import("./outbound/ip");
    const blocked = [
      "127.0.0.1",
      "127.1.2.3",
      "10.0.0.1",
      "172.16.5.4",
      "192.168.1.1",
      "169.254.169.254", // AWS/GCP/Azure metadata
      "100.100.100.200", // Alibaba metadata (CGNAT range)
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fe80::1",
      "fd00:ec2::254", // AWS IPv6 metadata (ULA)
      "fc00::1",
      "::ffff:127.0.0.1", // IPv4-mapped
      "::ffff:7f00:1",
      "0:0:0:0:0:ffff:a9fe:a9fe", // mapped 169.254.169.254
      "64:ff9b::a9fe:a9fe", // NAT64 of the metadata address
      "2002:7f00:0001::1", // 6to4 of 127.0.0.1
      "[::1]",
      "not-an-ip",
    ];
    for (const ip of blocked) expect(isBlockedAddress(ip), ip).toBe(true);
    for (const ip of ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });

  it("parses allowlists of hosts and CIDRs", async () => {
    const { parseAllowlist, addressAllowed } = await import("./outbound/safe-fetch");
    const policy = {
      allowPrivate: false,
      ...parseAllowlist("gitlab.internal:8443, *.corp.example 10.20.0.0/16"),
    };
    expect(addressAllowed("10.0.0.5", "gitlab.internal", policy)).toBe(true);
    expect(addressAllowed("10.0.0.5", "ci.corp.example", policy)).toBe(true);
    expect(addressAllowed("10.20.3.4", "anything.example", policy)).toBe(true);
    expect(addressAllowed("10.21.3.4", "anything.example", policy)).toBe(false);
    expect(addressAllowed("127.0.0.1", "corp.example.evil.com", policy)).toBe(false);
  });
});

describe("safeFetch (SSRF guard)", () => {
  let server: Server;
  let port = 0;
  let hits = 0;
  beforeAll(async () => {
    server = createServer((req, res) => {
      hits++;
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }).end();
      } else if (req.url === "/big") {
        res.writeHead(200).end("x".repeat(200_000));
      } else if (req.url === "/slow") {
        setTimeout(() => res.writeHead(200).end("late"), 2000);
      } else {
        res.writeHead(200, { "content-type": "text/plain" }).end("internal secret");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });
  const closed = { allowPrivate: false, hosts: [], cidrs: [] };

  it("refuses loopback, mapped and private literals without connecting", async () => {
    const { safeFetch, OutboundError } = await import("./outbound/safe-fetch");
    const before = hits;
    for (const host of ["127.0.0.1", "[::ffff:127.0.0.1]", "[::1]", "169.254.169.254", "10.0.0.1"]) {
      const err = await safeFetch(`http://${host}:${port}/`, { policy: closed }).catch((e: unknown) => e);
      expect(err, host).toBeInstanceOf(OutboundError);
      expect((err as InstanceType<typeof OutboundError>).category).toBe("blocked_address");
    }
    expect(hits).toBe(before);
  });

  it("refuses a host name that resolves to a private address (and any mixed answer)", async () => {
    const { safeFetch } = await import("./outbound/safe-fetch");
    const before = hits;
    const toLoopback = () => Promise.resolve([{ address: "127.0.0.1", family: 4 }]);
    await expect(
      safeFetch(`http://internal.example:${port}/`, { policy: closed, resolver: toLoopback }),
    ).rejects.toMatchObject({ category: "blocked_address" });
    const mixed = () =>
      Promise.resolve([
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]);
    await expect(
      safeFetch(`http://rebind.example:${port}/`, { policy: closed, resolver: mixed }),
    ).rejects.toMatchObject({ category: "blocked_address" });
    expect(hits).toBe(before);
  });

  it("resolves once and connects to the checked address (no DNS rebinding)", async () => {
    const { safeFetch } = await import("./outbound/safe-fetch");
    let calls = 0;
    // A rebinding resolver: harmless first, loopback afterwards. Only the first answer may be used.
    const rebinding = () => {
      calls++;
      return Promise.resolve([{ address: calls === 1 ? "127.0.0.1" : "93.184.216.34", family: 4 }]);
    };
    // Allow exactly 127.0.0.1 so the first (checked) answer is reachable: the request must land on it.
    const policy = {
      allowPrivate: false,
      hosts: [],
      cidrs: [{ bytes: new Uint8Array([127, 0, 0, 1]), prefix: 32 }],
    };
    const res = await safeFetch(`http://rebind.example:${port}/`, { policy, resolver: rebinding });
    expect(res.status).toBe(200);
    expect(calls).toBe(1);
  });

  it("reaches an allowlisted internal address, never follows redirects, caps bodies and times out", async () => {
    const { safeFetch, parseAllowlist } = await import("./outbound/safe-fetch");
    const policy = { allowPrivate: false, ...parseAllowlist("127.0.0.1/32") };
    const ok = await safeFetch(`http://127.0.0.1:${port}/`, { policy });
    expect(await ok.text()).toBe("internal secret");

    const redirect = await safeFetch(`http://127.0.0.1:${port}/redirect`, { policy });
    expect(redirect.status).toBe(302); // reported, not followed to the metadata service

    await expect(safeFetch(`http://127.0.0.1:${port}/big`, { policy, maxBytes: 1000 })).rejects.toMatchObject(
      { category: "too_large" },
    );
    const cut = await safeFetch(`http://127.0.0.1:${port}/big`, { policy, maxBytes: 1000, truncate: true });
    expect((await cut.text()).length).toBe(1000);

    await expect(
      safeFetch(`http://127.0.0.1:${port}/slow`, { policy, timeoutMs: 200 }),
    ).rejects.toMatchObject({ category: "timeout" });
  });

  it("refuses non-http schemes and credentials in the URL", async () => {
    const { safeFetch } = await import("./outbound/safe-fetch");
    for (const url of ["file:///etc/passwd", "gopher://127.0.0.1/", "http://user:pw@example.com/"]) {
      await expect(safeFetch(url, { policy: closed })).rejects.toMatchObject({ category: "invalid_url" });
    }
  });

  it("webhook attempts record status and an error category, never the response body", async () => {
    const { sendOnce } = await import("./webhooks/deliver");
    const endpoint = {
      id: "e",
      orgId: "o",
      projectId: null,
      name: null,
      url: `http://127.0.0.1:${port}/`,
      kind: "generic" as const,
      events: [],
      secret: null,
      active: true,
      failingSince: null,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const payload = {
      id: "p",
      event: "ping",
      apiVersion: "2026-11-01",
      createdAt: new Date().toISOString(),
      data: {},
    } as unknown as Parameters<typeof sendOnce>[1];
    const result = await sendOnce(endpoint, payload);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/^blocked/);
    expect(JSON.stringify(result)).not.toContain("internal secret");
    expect(result).not.toHaveProperty("responseBody");
  }, 30_000);
});

describe("client address (rate limits)", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  it("ignores X-Forwarded-For and X-Real-IP without a trusted proxy", async () => {
    const { resolveClientIp } = await import("./net");
    const spoof = { "x-forwarded-for": "1.2.3.4", "x-real-ip": "5.6.7.8", "x-peer": "203.0.113.9" };
    expect(resolveClientIp(h(spoof), 0, "x-peer")).toBe("203.0.113.9");
    expect(resolveClientIp(h(spoof), 0, undefined)).toBe("unknown");
  });
  it("takes the rightmost untrusted hop, so a client-sent first entry is ignored", async () => {
    const { resolveClientIp } = await import("./net");
    // Client sent "6.6.6.6"; the one trusted proxy appended the real address.
    const one = h({ "x-forwarded-for": "6.6.6.6, 198.51.100.7", "x-peer": "10.0.0.2" });
    expect(resolveClientIp(one, 1, "x-peer")).toBe("198.51.100.7");
    // Two hops (CDN + proxy).
    const two = h({ "x-forwarded-for": "6.6.6.6, 198.51.100.7, 172.16.0.9", "x-peer": "10.0.0.2" });
    expect(resolveClientIp(two, 2, "x-peer")).toBe("198.51.100.7");
    // Peer unknown (no stamp): the hop list starts at the rightmost XFF entry.
    expect(resolveClientIp(h({ "x-forwarded-for": "6.6.6.6, 198.51.100.7" }), 1, undefined)).toBe(
      "198.51.100.7",
    );
    // Garbage is not an address.
    expect(resolveClientIp(h({ "x-forwarded-for": "evil" }), 1, undefined)).toBe("unknown");
  });
  it("stamps the socket address under a secret header a client can't pre-set", async () => {
    const { installPeerStamp, peerHeaderName } = await import("./net");
    const emitted: unknown[] = [];
    class FakeServer {
      emit(event: string | symbol, ...args: unknown[]) {
        emitted.push([event, ...args]);
        return true;
      }
    }
    installPeerStamp({ Server: FakeServer });
    const name = peerHeaderName();
    expect(name).toMatch(/^x-pinwren-peer-[0-9a-f]{32}$/);
    const req = { headers: { [name ?? ""]: "1.2.3.4" }, socket: { remoteAddress: "203.0.113.5" } };
    new FakeServer().emit("request", req, {});
    expect(req.headers[name ?? ""]).toBe("203.0.113.5");
  });
});

describe("CSRF and content type", () => {
  const origin = "https://pinwren.example";
  const v = async (method: string, path: string, headers: Record<string, string>) =>
    (await import("./guards")).csrfVerdict(method, path, new Headers(headers), origin);
  const json = { "content-type": "application/json", "content-length": "2" };
  it("refuses cookie-authenticated writes from other sites or without an origin", async () => {
    expect(await v("POST", "/api/projects", { cookie: "s=1", origin: "https://evil.example", ...json })).toBe(
      "cross_site",
    );
    expect(await v("POST", "/api/projects", { cookie: "s=1", "sec-fetch-site": "cross-site", ...json })).toBe(
      "cross_site",
    );
    expect(await v("POST", "/api/projects", { cookie: "s=1", "sec-fetch-site": "same-site", ...json })).toBe(
      "cross_site",
    );
    expect(await v("DELETE", "/api/feedback/1", { cookie: "s=1" })).toBe("cross_site");
  });
  it("allows same-origin writes, reads, and token/public endpoints", async () => {
    expect(await v("POST", "/api/projects", { cookie: "s=1", origin, ...json })).toBe("ok");
    expect(
      await v("POST", "/api/projects", { cookie: "s=1", "sec-fetch-site": "same-origin", ...json }),
    ).toBe("ok");
    expect(await v("GET", "/api/projects", { cookie: "s=1", origin: "https://evil.example" })).toBe("ok");
    expect(await v("POST", "/api/v1/feedback/1/comments", { cookie: "s=1", ...json })).toBe("ok");
    expect(await v("POST", "/mcp", { cookie: "s=1" })).toBe("ok");
  });
  it("refuses non-JSON bodies on JSON routes", async () => {
    const form = { cookie: "s=1", origin, "content-type": "text/plain", "content-length": "5" };
    expect(await v("POST", "/api/projects", form)).toBe("bad_content_type");
    expect(
      await v("POST", "/api/unsubscribe", {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": "5",
      }),
    ).toBe("ok");
  });
});

describe("CSV injection", () => {
  it("neutralises formulas behind leading whitespace, tabs and line breaks", async () => {
    const { csvCell } = await import("./export/csv");
    for (const s of ["=1+1", " =cmd|'/c calc'!A1", "\t=1", "\r=1", "\n@SUM(A1)", "  +1", "＝HYPERLINK()"]) {
      expect(csvCell(s).replace(/^"/, ""), JSON.stringify(s)).toMatch(/^'/);
    }
    expect(csvCell("plain text")).toBe("plain text");
  });
});

describe("sign-up and instance admin (HIGH 3)", () => {
  it("closes sign-up after the first account unless PINWREN_DISABLE_SIGNUP=false; invitees always pass", async () => {
    const { decideSignup } = await import("./services/setup");
    expect(decideSignup({ disableSignup: undefined, hasUsers: false, invited: false })).toBe(true);
    expect(decideSignup({ disableSignup: undefined, hasUsers: true, invited: false })).toBe(false);
    expect(decideSignup({ disableSignup: undefined, hasUsers: true, invited: true })).toBe(true);
    expect(decideSignup({ disableSignup: true, hasUsers: true, invited: false })).toBe(false);
    expect(decideSignup({ disableSignup: true, hasUsers: false, invited: false })).toBe(true);
    expect(decideSignup({ disableSignup: false, hasUsers: true, invited: false })).toBe(true);
  });
});

describe("chat webhook URLs at rest (LOW)", () => {
  it("are stored encrypted and only ever returned masked", async () => {
    const { maskedWebhookUrl, storedWebhookUrl, webhookTargetUrl } = await import("./webhooks/url");
    const url = "https://hooks.slack.com/services/T000/B000/abcdefghijklmnop";
    const stored = storedWebhookUrl("slack", url);
    expect(stored).not.toContain("hooks.slack.com");
    expect(webhookTargetUrl({ url: stored })).toBe(url);
    expect(maskedWebhookUrl({ url: stored, kind: "slack" })).toBe("https://hooks.slack.com/…mnop");
    // Rows written before the change (clear text) still work and are masked too.
    expect(maskedWebhookUrl({ url, kind: "discord" })).toBe("https://hooks.slack.com/…mnop");
    expect(storedWebhookUrl("generic", "https://example.com/hook")).toBe("https://example.com/hook");
  });
});
