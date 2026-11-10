import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generate } from "../scripts/codegen";
import { HEADER, SPECS } from "../scripts/types";
import { Pinwren, PinwrenError } from "./index";

type Call = { url: string; init: RequestInit };

function fake(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fetchImpl = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: url instanceof Request ? url.url : url.toString(), init: init ?? {} });
    const next = responses.shift();
    if (!next) return Promise.reject(new Error("no more responses"));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("Pinwren client", () => {
  it("sends the token and builds query strings, skipping empty values", async () => {
    const { calls, fetchImpl } = fake([json({ items: [], nextCursor: null })]);
    const pw = new Pinwren({ url: "https://fb.example.com/", token: "pwt_x", fetch: fetchImpl });
    await pw.feedback.list({ status: "open", q: "", projectId: undefined, limit: 5 });
    expect(calls[0]?.url).toBe("https://fb.example.com/api/v1/feedback?status=open&limit=5");
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer pwt_x");
  });

  it("turns problem details into PinwrenError", async () => {
    const { fetchImpl } = fake([
      json({ code: "INSUFFICIENT_SCOPE", title: "This token lacks the feedback:write scope" }, 403),
    ]);
    const pw = new Pinwren({ url: "https://x", token: "pwt_x", fetch: fetchImpl });
    const err = await pw.feedback.update("id", { status: "resolved" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PinwrenError);
    expect(err).toMatchObject({ status: 403, code: "INSUFFICIENT_SCOPE" });
  });

  it("reports network failures as status 0", async () => {
    const { fetchImpl } = fake([new Error("ECONNREFUSED")]);
    const pw = new Pinwren({ url: "https://x", token: "pwt_x", fetch: fetchImpl });
    await expect(pw.projects.list()).rejects.toMatchObject({ status: 0, code: "NETWORK_ERROR" });
  });

  it("keeps an HTTP status when the body is not JSON", async () => {
    const { fetchImpl } = fake([new Response("<html>bad gateway</html>", { status: 502 })]);
    const pw = new Pinwren({ url: "https://x", token: "pwt_x", fetch: fetchImpl });
    await expect(pw.rounds.get("r1")).rejects.toMatchObject({ status: 502, code: "HTTP_ERROR" });
  });

  it("iterates every page", async () => {
    const item = (id: string) => ({ id });
    const { calls, fetchImpl } = fake([
      json({ items: [item("a"), item("b")], nextCursor: "c1" }),
      json({ items: [item("c")], nextCursor: null }),
    ]);
    const pw = new Pinwren({ url: "https://x", token: "pwt_x", fetch: fetchImpl });
    const ids: string[] = [];
    for await (const i of pw.feedback.iterate({ limit: 2 })) ids.push(i.id);
    expect(ids).toEqual(["a", "b", "c"]);
    expect(calls[1]?.url).toContain("cursor=c1");
  });

  it("resolves with an internal note first", async () => {
    const { calls, fetchImpl } = fake([
      json({ comment: { id: "c", body: "PR #1", visibility: "internal" } }, 201),
      json({ feedback: { id: "f", status: "resolved" } }),
    ]);
    const pw = new Pinwren({ url: "https://x", token: "pwt_x", fetch: fetchImpl });
    const f = await pw.feedback.resolve("f", "PR #1");
    expect(f.status).toBe("resolved");
    expect(calls.map((c) => c.init.method)).toEqual(["POST", "PATCH"]);
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ body: "PR #1", visibility: "internal" });
  });

  it("downloads assets as bytes and encodes ids", async () => {
    const { calls, fetchImpl } = fake([
      new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }),
    ]);
    const pw = new Pinwren({ url: "https://x", token: "pwt_x", fetch: fetchImpl });
    const a = await pw.assets.get("a/b");
    expect(a).toEqual({ contentType: "image/png", bytes: new Uint8Array([1, 2, 3]) });
    expect(calls[0]?.url).toBe("https://x/api/v1/assets/a%2Fb");
    expect(pw.assets.url("z")).toBe("https://x/api/v1/assets/z");
  });

  it("requires url and token", () => {
    expect(() => new Pinwren({ url: "", token: "t" })).toThrow(/url/);
    expect(() => new Pinwren({ url: "https://x", token: "" })).toThrow(/token/);
  });
});

describe("agent hand-off, labels, views and stats", () => {
  it("calls the new endpoints", async () => {
    const { calls, fetchImpl } = fake([
      json({ markdown: "# Fix" }),
      json({ filename: "a.spec.ts", code: "x", caveats: [] }),
      json({ labels: [{ id: "l", name: "n", color: "#fff", count: 1 }] }),
      json({ views: [{ id: "v" }] }),
      json({ days: 30 }),
    ]);
    const pw = new Pinwren({ url: "https://fb.example.com", token: "pwt_x", fetch: fetchImpl });
    expect((await pw.feedback.brief("a b")).markdown).toBe("# Fix");
    expect((await pw.feedback.reproTest("a")).filename).toBe("a.spec.ts");
    expect((await pw.labels.list("p")).at(0)?.count).toBe(1);
    expect(await pw.views.list()).toEqual([{ id: "v" }]);
    expect((await pw.stats.get({ days: 30 })).days).toBe(30);
    expect(calls.map((c) => c.url.replace("https://fb.example.com/api/v1", ""))).toEqual([
      "/feedback/a%20b/brief",
      "/feedback/a/repro-test",
      "/projects/p/labels",
      "/views",
      "/stats?days=30",
    ]);
  });
});

describe("API parity", () => {
  // The audit found the client missing /stats: every GET /api/v1 route must have an SDK method.
  it("has a method for every /api/v1 route", () => {
    const inventory = JSON.parse(
      readFileSync(
        fileURLToPath(new URL("../../api/src/tenant-route-inventory.json", import.meta.url)),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");
    const exempt = new Set(["GET /api/v1/token"]); // reached through `request()` by the CLI's `status`
    const missing = Object.keys(inventory)
      .filter((k) => k.includes(" /api/v1/") && !exempt.has(k))
      .filter((k) => {
        const path = k.split(" /api/v1")[1] ?? "";
        const pattern = path
          .split("/")
          .map((seg) => (seg.startsWith(":") ? String.raw`\$\{enc\([^)]*\)\}` : seg))
          .join("/");
        return !new RegExp(`["\`]${pattern}["\`?]`).test(source);
      });
    expect(missing).toEqual([]);
  });
});

describe("generated types", () => {
  it("are up to date with the Zod schemas (run `pnpm --filter @pinwren/sdk generate`)", async () => {
    const file = fileURLToPath(new URL("./types.generated.ts", import.meta.url));
    expect(await generate(SPECS, HEADER, file)).toBe(readFileSync(file, "utf8"));
  });
});

describe("releases", () => {
  it("lists releases, records one and resolves with a fix", async () => {
    const release = { id: "r1", version: "v1.4.0", fixedCount: 2, regressionCount: 0 };
    const { calls, fetchImpl } = fake([
      json({ releases: [release] }),
      json({ release, created: true, adopted: 1 }, 201),
      json({ feedback: { id: "f", status: "resolved", fixedInReleaseId: "r1" } }),
    ]);
    const pw = new Pinwren({ url: "https://fb.example.com", token: "pwt_x", fetch: fetchImpl });
    expect((await pw.releases.list("p 1")).at(0)?.version).toBe("v1.4.0");
    const made = await pw.releases.create("p1", { version: "v1.4.0", commit: "9f2c1ab" });
    expect(made).toMatchObject({ created: true, adopted: 1 });
    await pw.feedback.resolve("f", undefined, { releaseId: "r1" });
    expect(
      calls.map((c) => `${c.init.method ?? ""} ${c.url.replace("https://fb.example.com/api/v1", "")}`),
    ).toEqual(["GET /projects/p%201/releases", "POST /projects/p1/releases", "PATCH /feedback/f"]);
    expect(JSON.parse(calls[1]?.init.body as string)).toEqual({ version: "v1.4.0", commit: "9f2c1ab" });
    expect(JSON.parse(calls[2]?.init.body as string)).toEqual({
      status: "resolved",
      fixedInReleaseId: "r1",
    });
  });
});
