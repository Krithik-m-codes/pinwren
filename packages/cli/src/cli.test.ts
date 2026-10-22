import { describe, expect, it } from "vitest";
import { doctor, status } from "./checks";
import {
  assertProjectKey,
  detectFramework,
  htmlSnippet,
  insertIntoHtml,
  insertIntoNextLayout,
  nextSnippet,
  normalizeUrl,
} from "./snippet";

const input = { url: "https://fb.example.com", projectKey: "pk_abcdefgh123" };

describe("snippets", () => {
  it("builds the script tag for HTML/Vite and Next.js", () => {
    expect(htmlSnippet(input)).toBe(
      '<script src="https://fb.example.com/widget.js" data-project="pk_abcdefgh123" async></script>',
    );
    expect(nextSnippet(input)).toContain('strategy="afterInteractive"');
  });

  it("validates the URL and key", () => {
    expect(normalizeUrl("https://fb.example.com/sub/?x=1")).toBe("https://fb.example.com/sub");
    expect(() => normalizeUrl("ftp://x")).toThrow();
    expect(() => assertProjectKey("abc")).toThrow(/pk_/);
    expect(assertProjectKey(" pk_abcdefgh123 ")).toBe("pk_abcdefgh123");
  });

  it("detects the framework", () => {
    expect(detectFramework({ dependencies: { next: "16" } })).toBe("next");
    expect(detectFramework({ devDependencies: { vite: "7" } })).toBe("vite");
    expect(detectFramework(null)).toBe("html");
  });

  it("inserts once before </body>", () => {
    const html = "<html><body><h1>Hi</h1></body></html>";
    const once = insertIntoHtml(html, input);
    expect(once).toContain('data-project="pk_abcdefgh123" async></script>\n</body>');
    expect(insertIntoHtml(once ?? "", input)).toBeNull();
    expect(insertIntoHtml("<p>no body</p>", input)).toBeNull();
  });

  it("adds next/script to a root layout", () => {
    const layout =
      "export default function L({ children }) {\n  return (<html><body>{children}</body></html>);\n}\n";
    const out = insertIntoNextLayout(layout, input) ?? "";
    expect(out.startsWith('import Script from "next/script";')).toBe(true);
    expect(out).toContain("<Script src=");
    expect(insertIntoNextLayout(out, input)).toBeNull();
  });
});

type Answer = { status: number; body?: unknown; type?: string };
const fakeFetch = (
  answers: Record<string, Answer>,
  seen: { url: string; headers: Record<string, string> }[] = [],
) =>
  ((input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    seen.push({ url: url.pathname, headers: (init.headers ?? {}) as Record<string, string> });
    const a = answers[url.pathname];
    if (!a) return Promise.reject(new Error("connect ECONNREFUSED"));
    return Promise.resolve(
      new Response(typeof a.body === "string" ? a.body : JSON.stringify(a.body ?? {}), {
        status: a.status,
        headers: { "content-type": a.type ?? "application/json" },
      }),
    );
  }) as typeof fetch;

describe("doctor", () => {
  it("passes a healthy install and sends key + origin", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const checks = await doctor(
      { url: "https://fb.example.com", projectKey: "pk_abcdefgh123", origin: "https://shop.example" },
      fakeFetch(
        {
          "/api/health": { status: 200, body: { ok: true, version: "0.1.0" } },
          "/widget.js": { status: 200, body: "x", type: "application/javascript" },
          "/w/config": { status: 200, body: { project: { name: "Shop" } } },
        },
        seen,
      ),
    );
    expect(checks.every((c) => c.ok)).toBe(true);
    expect(checks[0]?.detail).toContain("Pinwren 0.1.0");
    expect(seen.at(-1)?.headers).toEqual({
      "x-pinwren-key": "pk_abcdefgh123",
      origin: "https://shop.example",
    });
  });

  it("explains a refused origin, a bad key and an unreachable server", async () => {
    const base = {
      "/api/health": { status: 200, body: { ok: true } },
      "/widget.js": { status: 404, body: "nope", type: "text/html" },
    };
    let checks = await doctor(
      { url: "https://fb.example.com", projectKey: "pk_abcdefgh123" },
      fakeFetch({ ...base, "/w/config": { status: 403, body: { code: "ORIGIN_NOT_ALLOWED" } } }),
    );
    expect(checks.find((c) => c.name === "widget.js")?.ok).toBe(false);
    expect(checks.find((c) => c.name === "widget config")?.detail).toContain("allowed origins");
    checks = await doctor(
      { url: "https://fb.example.com", projectKey: "pk_abcdefgh123" },
      fakeFetch({ ...base, "/w/config": { status: 401, body: { code: "INVALID_PROJECT_KEY" } } }),
    );
    expect(checks.find((c) => c.name === "widget config")?.detail).toContain("unknown");
    checks = await doctor({ url: "https://down.example" }, fakeFetch({}));
    expect(checks).toHaveLength(1);
    expect(checks[0]?.ok).toBe(false);
    expect(checks[0]?.detail).toContain("unreachable");
  });
});

describe("status", () => {
  it("lists projects with open counts", async () => {
    const s = await status(
      "https://fb.example.com",
      "pwt_x",
      fakeFetch({
        "/api/v1/token": { status: 200, body: { user: { name: "Ann" }, role: "member" } },
        "/api/v1/projects": { status: 200, body: { projects: [{ id: "p", name: "Shop", openCount: 3 }] } },
      }),
    );
    expect(s).toEqual({ user: "Ann", role: "member", projects: [{ id: "p", name: "Shop", openCount: 3 }] });
  });
});
