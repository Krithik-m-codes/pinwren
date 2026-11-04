import type { ElementInfo, TraceStep } from "../services/replay";

// Draft Playwright test for a report (feature "repro-test generation"). Deterministic: the same stored
// data always yields the same file, no model involved. Everything it reads was masked at capture
// (typed text never leaves the visitor's browser), and every reporter-controlled string is emitted
// through JSON.stringify, so a hostile title, selector or URL can only ever be a string literal.

export type ReproTestInput = {
  number: number;
  title: string;
  /** The page the report was filed on. */
  pageUrl: string | null;
  viewport?: { w?: number; h?: number } | undefined;
  anchor: {
    css?: string | undefined;
    xpath?: string | undefined;
    text?: { content?: string } | undefined;
  } | null;
  /** Interactions from the session replay, in order (empty when none was recorded). */
  trace: readonly TraceStep[];
  errors: readonly { message: string }[];
  failing: readonly { method: string; url: string; status: number }[];
  /** Dashboard link to the item, written into the file header. */
  reportUrl: string;
};

export type ReproTest = {
  filename: string;
  language: "typescript";
  code: string;
  /** Plain-language limits of this draft; shown next to the code and in the header comment. */
  caveats: string[];
  stats: {
    /** Replay interactions turned into Playwright calls. */
    scripted: number;
    /** Replay interactions left out (could not be targeted, or not worth scripting). */
    skipped: number;
    hasReplay: boolean;
    /** What the test asserts, in words. */
    expectations: string[];
  };
};

const js = (s: string) => JSON.stringify(s);
/** One line of comment text: no line breaks (so no new statement can start) and no comment terminator. */
const comment = (s: string, n = 160) => {
  const t = s
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, " ")
    .replace(/\*\//g, "* /")
    .trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

// Ids React/Radix/etc. generate (":r1:", "radix-«r2»", long hex) change between runs: not worth targeting.
const unstableId = (id: string) => /^[:\d]|[«»:]|[0-9a-f]{8,}|\d{4,}/i.test(id);

const SAMPLE_BY_TYPE: Record<string, string> = {
  email: "user@example.com",
  password: "correct-horse-battery",
  number: "1",
  tel: "5550100",
  url: "https://example.com",
  search: "test",
};

/** A Playwright locator expression for a recorded element, or null when nothing reliable identifies it. */
export function locatorFor(el: ElementInfo | null): string | null {
  if (!el) return null;
  const { tag, attrs, text } = el;
  const label = clip(attrs["aria-label"] || text || attrs.title || attrs.alt || "", 60);
  if (attrs.id && !unstableId(attrs.id)) return `page.locator(${js(`[id=${js(attrs.id)}]`)})`;
  const role = attrs.role || (tag === "button" ? "button" : tag === "a" ? "link" : "");
  if (role && /^[a-z]+$/.test(role) && label) return `page.getByRole(${js(role)}, { name: ${js(label)} })`;
  if (["input", "textarea", "select"].includes(tag)) {
    if (attrs.name) return `page.locator(${js(`${tag}[name=${js(attrs.name)}]`)})`;
    if (attrs["aria-label"]) return `page.getByLabel(${js(clip(attrs["aria-label"], 60))})`;
    if (attrs.placeholder) return `page.getByPlaceholder(${js(clip(attrs.placeholder, 60))})`;
    return null;
  }
  if (attrs.name) return `page.locator(${js(`${tag}[name=${js(attrs.name)}]`)})`;
  if (label) return `page.getByText(${js(label)}, { exact: false }).first()`;
  return null;
}

const slugOf = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "report";

/** Build the draft. Pure: no I/O, no clock. */
export function generateReproTest(input: ReproTestInput): ReproTest {
  const lines: string[] = [];
  const caveats: string[] = [
    "This is a draft generated from the report, not a verified test: read it, run it against the page, and adjust it before you rely on it.",
    "Selectors come from the recording and the pinned element and may need tightening; elements without a stable id, role, name or text were skipped.",
  ];
  const hasReplay = input.trace.length > 0;
  let scripted = 0;
  let skipped = 0;

  // Where the test starts: the first page the replay saw, else the page the report was filed on.
  const firstNav = input.trace.find((s) => s.action?.type === "navigate");
  const startUrl = (firstNav?.action?.type === "navigate" ? firstNav.action.href : null) ?? input.pageUrl;
  if (!startUrl) {
    caveats.push("The report has no page address, so the test opens `/`: set `baseURL` or edit the URL.");
  }
  const firstViewport = input.trace.find((s) => s.action?.type === "viewport");
  const vp =
    input.viewport?.w && input.viewport.h
      ? { width: input.viewport.w, height: input.viewport.h }
      : firstViewport?.action?.type === "viewport"
        ? { width: firstViewport.action.width, height: firstViewport.action.height }
        : null;

  const body: string[] = [];
  let step = 0;
  let sawFirstViewport = false;
  for (const s of input.trace) {
    const a = s.action;
    if (!a) continue;
    switch (a.type) {
      case "navigate":
        if (a.href === startUrl && step === 0) break;
        body.push(`// The recording navigated to ${comment(a.href)}`);
        break;
      case "viewport":
        // The first size is the one the test starts with (test.use below); later ones are resizes.
        if (!sawFirstViewport && vp?.width === a.width && vp.height === a.height) {
          sawFirstViewport = true;
          break;
        }
        body.push(`await page.setViewportSize({ width: ${a.width}, height: ${a.height} });`);
        scripted++;
        break;
      case "scroll":
        // Playwright scrolls elements into view before acting on them.
        skipped++;
        break;
      case "click":
      case "dblclick":
      case "contextmenu": {
        const loc = locatorFor(a.target);
        if (!loc) {
          body.push(
            `// Step ${++step}: ${comment(s.text)} — no stable selector was recorded; script it by hand.`,
          );
          skipped++;
          break;
        }
        const call =
          a.type === "click"
            ? `${loc}.click()`
            : a.type === "dblclick"
              ? `${loc}.dblclick()`
              : `${loc}.click({ button: "right" })`;
        body.push(`// Step ${++step}: ${comment(s.text)}`, `await ${call};`);
        scripted++;
        break;
      }
      case "input": {
        const loc = locatorFor(a.target);
        if (!loc) {
          body.push(
            `// Step ${++step}: ${comment(s.text)} — no stable selector was recorded; script it by hand.`,
          );
          skipped++;
          break;
        }
        const type = a.target?.attrs.type ?? "";
        body.push(
          `// Step ${++step}: ${comment(s.text)}`,
          `// What was typed is masked in the recording; this is a sample value.`,
          `await ${loc}.fill(${js(SAMPLE_BY_TYPE[type] ?? "test")});`,
        );
        scripted++;
        break;
      }
    }
  }
  if (!hasReplay) {
    caveats.push(
      "No session replay was recorded, so there are no scripted interactions: the test only opens the page and checks the evidence below.",
    );
  } else if (skipped > 0) {
    caveats.push(
      `${skipped} recorded interaction${skipped === 1 ? " was" : "s were"} not scripted (scrolling, or no usable selector).`,
    );
  }

  // Expectations, strongest evidence first. Each one is written so the test FAILS while the bug exists.
  const expectations: string[] = [];
  const check: string[] = [];
  if (input.errors.length) {
    expectations.push("no console errors or uncaught exceptions");
    check.push(
      `// Observed in the report: ${input.errors
        .slice(0, 3)
        .map((e) => js(comment(e.message, 100)))
        .join(", ")}`,
      `expect(consoleErrors, "the page should not log errors").toEqual([]);`,
    );
  }
  if (input.failing.length) {
    expectations.push("no failed network requests (HTTP 4xx/5xx or no response)");
    check.push(
      `// Observed in the report: ${input.failing
        .slice(0, 3)
        .map((n) => `${comment(n.method, 10)} ${comment(n.url, 100)} → ${n.status || "no response"}`)
        .join("; ")}`,
      `expect(failedRequests, "no request should fail").toEqual([]);`,
    );
  }
  const css = input.anchor?.css ? clip(input.anchor.css, 300) : null;
  if (css) {
    expectations.push("the pinned element is visible");
    check.push(
      `// The element the reporter pinned. Replace this with the assertion that describes the behaviour you expect.`,
      `await expect(page.locator(${js(css)}).first()).toBeVisible();`,
    );
    const text = input.anchor?.text?.content ? clip(input.anchor.text.content.trim(), 80) : "";
    if (text) {
      check.push(`await expect(page.locator(${js(css)}).first()).toContainText(${js(text)});`);
      expectations.push("the pinned element still shows its text");
    }
  }
  const undetermined = expectations.length === 0;
  if (undetermined) {
    caveats.push(
      "Nothing in the report points at an automatic expectation (no errors, failing requests or pinned element), so the test is marked fixme: add an assertion for the behaviour you expect.",
    );
  }
  if (input.errors.length || input.failing.length) {
    caveats.push(
      "Console and network evidence was recorded in the reporter's browser; your CI may not hit the same data, environment or login state.",
    );
  }

  lines.push(
    "// DRAFT — generated by Pinwren, not a verified test.",
    `// From feedback #${input.number}: ${comment(input.title, 120)}`,
    `// ${comment(input.reportUrl, 300)}`,
    "//",
    ...caveats.map((c) => `// - ${comment(c, 400)}`),
    "",
    `import { expect, test } from "@playwright/test";`,
    "",
  );
  if (vp) lines.push(`test.use({ viewport: { width: ${vp.width}, height: ${vp.height} } });`, "");
  lines.push(`test(${js(`#${input.number} ${comment(input.title, 100)}`)}, async ({ page }) => {`);
  const indent = (ls: string[]) => ls.map((l) => (l ? `  ${l}` : l));
  const out: string[] = [];
  if (undetermined)
    out.push(
      `test.fixme(true, "No expectation could be derived from the report; add one, then remove this line.");`,
      "",
    );
  if (input.errors.length || input.failing.length) {
    out.push("// Collect the evidence while the steps run.");
    if (input.errors.length) {
      out.push(
        "const consoleErrors: string[] = [];",
        `page.on("console", (m) => {`,
        `  if (m.type() === "error") consoleErrors.push(m.text());`,
        "});",
        `page.on("pageerror", (e) => consoleErrors.push(e.message));`,
      );
    }
    if (input.failing.length) {
      out.push(
        "const failedRequests: string[] = [];",
        `page.on("response", (r) => {`,
        `  if (r.status() >= 400) failedRequests.push(\`\${r.request().method()} \${r.url()} → \${r.status()}\`);`,
        "});",
        `page.on("requestfailed", (r) => failedRequests.push(\`\${r.method()} \${r.url()} → no response\`));`,
      );
    }
    out.push("");
  }
  if (startUrl) {
    out.push(`await page.goto(${js(startUrl)});`);
  } else {
    out.push(`// The report has no page address; open the page here.`, `await page.goto("/");`);
  }
  if (body.length) out.push("", ...body);
  if (check.length) out.push("", "// Expectations", ...check);
  lines.push(...indent(out), "});", "");

  return {
    filename: `pinwren-${input.number}-${slugOf(input.title)}.spec.ts`,
    language: "typescript",
    code: lines.join("\n"),
    caveats,
    stats: { scripted, skipped, hasReplay, expectations },
  };
}
