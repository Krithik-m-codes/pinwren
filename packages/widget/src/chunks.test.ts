// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MANIFEST = {
  panel: "widget-panel.0123456789.js",
  editor: "widget-editor.abcdef0123.js",
  "i18n-fr": "widget-i18n-fr.fedcba9876.js",
  report: "../../evil.js",
};

/** Scripts the code under test added (happy-dom would really fetch them if they reached the document). */
let added: HTMLScriptElement[] = [];

/** chunks.ts reads the manifest once, when it is first imported. */
async function load(manifest?: Record<string, string>) {
  vi.resetModules();
  added = [];
  vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
    added.push(...(nodes as HTMLScriptElement[]));
  });
  (globalThis as { __PINWREN_MANIFEST__?: unknown }).__PINWREN_MANIFEST__ = manifest;
  return import("./chunks");
}

afterEach(() => {
  delete (globalThis as { __PINWREN_MANIFEST__?: unknown }).__PINWREN_MANIFEST__;
  vi.restoreAllMocks();
});

describe("chunk manifest (wave-4 §7)", () => {
  it("resolves chunk and locale names to their hashed files", async () => {
    const { chunkUrl } = await load(MANIFEST);
    expect(chunkUrl("https://cdn.example/w", "panel")).toBe(
      "https://cdn.example/w/widget-panel.0123456789.js",
    );
    expect(chunkUrl("https://cdn.example/w", "i18n-fr")).toBe(
      "https://cdn.example/w/widget-i18n-fr.fedcba9876.js",
    );
  });
  it("falls back to the plain name without a manifest entry, and ignores names it didn't build", async () => {
    const { chunkUrl } = await load(MANIFEST);
    expect(chunkUrl("https://x.example", "capture")).toBe("https://x.example/widget-capture.js");
    expect(chunkUrl("https://x.example", "report")).toBe("https://x.example/widget-report.js");
    const bare = await load(undefined);
    expect(bare.chunkUrl("https://x.example", "panel")).toBe("https://x.example/widget-panel.js");
  });
});

describe("loadChunk", () => {
  beforeEach(() => {
    delete (window as unknown as Record<string, unknown>).__pinwrenEditor;
  });

  it("adds the hashed script once and resolves with what it registered", async () => {
    const { loadChunk, setNonce } = await load(MANIFEST);
    setNonce("n0nce");
    const a = loadChunk<{ Editor: string }>("https://cdn.example", "editor");
    const b = loadChunk<{ Editor: string }>("https://cdn.example", "editor");
    expect(added).toHaveLength(1);
    const s = added[0];
    if (!s) throw new Error("no script");
    expect(s.src).toBe("https://cdn.example/widget-editor.abcdef0123.js");
    expect(s.nonce).toBe("n0nce");
    (window as unknown as Record<string, unknown>).__pinwrenEditor = { Editor: "E" };
    s.dispatchEvent(new Event("load"));
    expect(await a).toEqual({ Editor: "E" });
    expect(await b).toEqual({ Editor: "E" });
    // Already registered: no new request.
    expect(await loadChunk("https://cdn.example", "editor")).toEqual({ Editor: "E" });
    expect(added).toHaveLength(1);
  });

  it("rejects a failed load and retries next time", async () => {
    const { loadChunk } = await load(MANIFEST);
    const first = loadChunk("https://cdn.example", "panel");
    added[0]?.dispatchEvent(new Event("error"));
    await expect(first).rejects.toThrow("widget-panel.0123456789.js");
    void loadChunk("https://cdn.example", "panel").catch(() => undefined);
    expect(added).toHaveLength(2);
  });
});
