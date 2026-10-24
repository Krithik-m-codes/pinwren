// Install snippets for `pinwren init` (pure, unit-tested). The widget is one script tag: the public
// project key is not a secret (it only works from the project's allowed origins).

export type Framework = "html" | "vite" | "next";

export type SnippetInput = { url: string; projectKey: string };

const attr = (s: string) => s.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");

export function normalizeUrl(raw: string): string {
  const u = new URL(raw.trim());
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("Use an http(s):// URL");
  return u.origin + trimTrailingSlashes(u.pathname);
}

/** A loop, not `/\/+$/`: that regex is quadratic on long runs of `/` (CodeQL js/polynomial-redos). */
function trimTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* / */) end--;
  return s.slice(0, end);
}

export function assertProjectKey(key: string): string {
  const k = key.trim();
  if (!/^pk_[A-Za-z0-9_-]{8,}$/.test(k)) throw new Error("Project keys look like pk_… (Settings › Install)");
  return k;
}

export function htmlSnippet({ url, projectKey }: SnippetInput): string {
  return `<script src="${attr(`${url}/widget.js`)}" data-project="${attr(projectKey)}" async></script>`;
}

export function nextSnippet({ url, projectKey }: SnippetInput): string {
  return `<Script src="${attr(`${url}/widget.js`)}" data-project="${attr(projectKey)}" strategy="afterInteractive" />`;
}

export function snippetFor(framework: Framework, input: SnippetInput): string {
  return framework === "next" ? nextSnippet(input) : htmlSnippet(input);
}

/** Which framework a package.json describes (Next.js, Vite, else plain HTML). */
export function detectFramework(pkg: { dependencies?: object; devDependencies?: object } | null): Framework {
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  if ("next" in deps) return "next";
  if ("vite" in deps) return "vite";
  return "html";
}

const ALREADY = /\/widget\.js["'][^>]*data-project=|data-project=[^>]*\/widget\.js/;

/** Insert the tag before `</body>` of an HTML file. null when there is no `</body>` or it is already there. */
export function insertIntoHtml(html: string, input: SnippetInput): string | null {
  if (ALREADY.test(html)) return null;
  const i = html.toLowerCase().lastIndexOf("</body>");
  if (i < 0) return null;
  return `${html.slice(0, i)}  ${htmlSnippet(input)}\n${html.slice(i)}`;
}

/** Insert `<Script>` before `</body>` of a Next.js root layout and import next/script once. */
export function insertIntoNextLayout(source: string, input: SnippetInput): string | null {
  if (ALREADY.test(source)) return null;
  const i = source.lastIndexOf("</body>");
  if (i < 0) return null;
  let out = `${source.slice(0, i)}  ${nextSnippet(input)}\n      ${source.slice(i)}`;
  if (!/from\s+["']next\/script["']/.test(out)) out = `import Script from "next/script";\n${out}`;
  return out;
}
