import { describe, expect, it } from "vitest";
import { OutboundError, type OutboundFetch } from "../outbound/safe-fetch";
import { checkInstall, siteUrl, verdictFor, widgetKeysIn } from "./install-check";

const page = (body: string) => new Response(`<html><head>${body}</head></html>`, { status: 200 });
const base = { publicKey: "pk_abc", lastSeenAt: null, rejectedOrigins: [] };

describe("siteUrl", () => {
  it("maps allowlist entries to a page to fetch", () => {
    expect(siteUrl("example.com")).toBe("https://example.com/");
    expect(siteUrl("*.example.com")).toBe("https://www.example.com/");
    expect(siteUrl("localhost:3000")).toBe("http://localhost:3000/");
    expect(siteUrl("ftp://x.com")).toBeNull();
    expect(siteUrl("")).toBeNull();
  });
});

describe("verdictFor", () => {
  it("finds the tag, a mismatch and a missing tag", () => {
    const tag = (k: string) => `<script src="https://p.io/widget.js" data-project="${k}" async></script>`;
    expect(widgetKeysIn(tag("pk_x"))).toEqual(["pk_x"]);
    expect(verdictFor(tag("pk_abc"), "pk_abc").verdict).toBe("found");
    expect(verdictFor(tag("pk_other"), "pk_abc")).toEqual({
      verdict: "key_mismatch",
      foundKeys: ["pk_other"],
    });
    expect(verdictFor("<script src='/app.js'></script>", "pk_abc").verdict).toBe("script_missing");
  });
});

describe("checkInstall", () => {
  it("reports each site and follows redirects a few hops", async () => {
    const calls: string[] = [];
    const fetcher: OutboundFetch = (url) => {
      calls.push(url);
      if (url === "https://a.com/")
        return Promise.resolve(new Response(null, { status: 301, headers: { location: "/home" } }));
      if (url === "https://a.com/home")
        return Promise.resolve(page(`<script src="x/widget.js" data-project="pk_abc"></script>`));
      if (url === "https://b.com/")
        return Promise.resolve(page(`<script src="x/widget.js" data-project="pk_zzz"></script>`));
      if (url === "https://c.com/") return Promise.resolve(new Response("no", { status: 500 }));
      return Promise.reject(new OutboundError("blocked_address"));
    };
    const r = await checkInstall({ ...base, allowedOrigins: ["a.com", "b.com", "c.com", "d.com"] }, fetcher);
    expect(r.sites.map((s) => s.verdict)).toEqual(["found", "key_mismatch", "unreachable"]);
    expect(r.sites[2]?.reason).toBe("status");
    expect(calls).toContain("https://a.com/home");
    expect(calls).not.toContain("https://d.com/");
  });

  it("maps blocked addresses and gives up on redirect loops", async () => {
    const blocked = await checkInstall({ ...base, allowedOrigins: ["10.0.0.1"] }, () =>
      Promise.reject(new OutboundError("blocked_address")),
    );
    expect(blocked.sites[0]).toMatchObject({ verdict: "unreachable", reason: "blocked_address" });
    const loop = await checkInstall({ ...base, allowedOrigins: ["a.com"] }, () =>
      Promise.resolve(new Response(null, { status: 302, headers: { location: "/" } })),
    );
    expect(loop.sites[0]?.verdict).toBe("unreachable");
  });

  it("lists refused origins that are still not allowed and flags no sites", async () => {
    const r = await checkInstall(
      {
        ...base,
        allowedOrigins: [],
        rejectedOrigins: [{ origin: "https://evil.com" }],
        lastSeenAt: new Date(0),
      },
      () => Promise.reject(new Error("never")),
    );
    expect(r).toMatchObject({
      noSites: true,
      refusedOrigins: ["https://evil.com"],
      lastSeenAt: "1970-01-01T00:00:00.000Z",
    });
  });
});
