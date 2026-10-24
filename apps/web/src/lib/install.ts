// Install tab helpers (wave-5 contract §3.5): the snippets for each way of adding the widget, built from
// the project key and the server's configured public URL (PINWREN_URL), and the allowlist entry for a
// refused origin.

import { trimTrailingSlashes as trimSlash } from "@pinwren/core";

export const INSTALL_METHODS = ["html", "next", "gtm", "npm", "react"] as const;
export type InstallMethod = (typeof INSTALL_METHODS)[number];

export const INSTALL_LABELS: Record<InstallMethod, string> = {
  html: "HTML",
  next: "Next.js",
  gtm: "Tag Manager",
  npm: "npm",
  react: "React",
};

/** Where each snippet goes, under the tabs. */
export const INSTALL_HINTS: Record<InstallMethod, string> = {
  html: "Add this before the closing </body> tag on every page.",
  next: "Add it to your root layout so it loads on every page.",
  gtm: "In Google Tag Manager: a Custom HTML tag, triggered on All Pages.",
  npm: "Call init() once in the browser, e.g. in your app's entry file. The package is a tiny loader: the widget itself comes from your Pinwren server, so it always matches it.",
  react:
    "Render it once near the root of your app. It renders nothing itself and loads the widget from your Pinwren server.",
};

export function installSnippets(publicUrl: string, projectKey: string): Record<InstallMethod, string> {
  const base = trimSlash(publicUrl);
  const tag = `<script src="${base}/widget.js" data-project="${projectKey}" async></script>`;
  return {
    html: tag,
    next: `// app/layout.tsx\nimport Script from "next/script";\n\n<Script src="${base}/widget.js" data-project="${projectKey}" strategy="afterInteractive" />`,
    gtm: `<!-- Google Tag Manager → Custom HTML tag, trigger: All Pages -->\n${tag}`,
    npm: `npm install @pinwren/widget\n\n// In the browser:\nimport { init } from "@pinwren/widget";\n\ninit({ projectKey: "${projectKey}", endpoint: "${base}" });`,
    react: `npm install @pinwren/react\n\n// app root (client component):\nimport { Pinwren } from "@pinwren/react";\n\n<Pinwren projectKey="${projectKey}" endpoint="${base}" />`,
  };
}

/** `npx pinwren doctor …`: checks the server, widget.js and the config for this key from an origin. */
export function doctorCommand(publicUrl: string, projectKey: string, site?: string): string {
  const origin = site
    ? ` --origin ${site.includes("://") ? site : `https://${site.replace(/^\*\./, "www.")}`}`
    : "";
  return `npx pinwren doctor --url ${trimSlash(publicUrl)} --key ${projectKey}${origin}`;
}

/**
 * The allowlist entry that admits a refused origin: its host, plus the port when the origin names one
 * (`http://localhost:3000` → `localhost:3000`). null for something that isn't an origin.
 */
export function patternForOrigin(origin: string): string | null {
  try {
    const u = new URL(origin);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.host.toLowerCase();
  } catch {
    return null;
  }
}

/** Whether the dashboard is open on another address than PINWREN_URL (the snippets use the latter). */
export function differentOrigin(browserOrigin: string | null | undefined, publicUrl: string): boolean {
  if (!browserOrigin) return false;
  try {
    return new URL(publicUrl).origin !== new URL(browserOrigin).origin;
  } catch {
    return false;
  }
}
