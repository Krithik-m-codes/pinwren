// Install tab helpers (wave-5 contract §3.5): the snippets for each way of adding the widget, built from
// the project key and the server's configured public URL (PINWREN_URL), and the allowlist entry for a
// refused origin.

import { trimTrailingSlashes as trimSlash } from "@pinwren/core";
import type { Key } from "@/lib/i18n/en";
import { tEn } from "@/lib/i18n/english";

export const INSTALL_METHODS = ["html", "next", "gtm", "npm", "react"] as const;
export type InstallMethod = (typeof INSTALL_METHODS)[number];

export const INSTALL_LABELS: Record<InstallMethod, string> = {
  html: "HTML",
  next: "Next.js",
  gtm: "Tag Manager",
  npm: "npm",
  react: "React",
};

/** The keys of where each snippet goes, under the tabs (the UI translates them). */
export const INSTALL_HINT_KEYS: Record<InstallMethod, Key> = {
  html: "other1.installHintHtml",
  next: "other1.installHintNext",
  gtm: "other1.installHintGtm",
  npm: "other1.installHintNpm",
  react: "other1.installHintReact",
};

/** Where each snippet goes, in English. */
export const INSTALL_HINTS: Record<InstallMethod, string> = {
  html: tEn(INSTALL_HINT_KEYS.html),
  next: tEn(INSTALL_HINT_KEYS.next),
  gtm: tEn(INSTALL_HINT_KEYS.gtm),
  npm: tEn(INSTALL_HINT_KEYS.npm),
  react: tEn(INSTALL_HINT_KEYS.react),
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

/** `npx @pinwren/cli doctor …`: checks the server, widget.js and the config for this key from an origin. */
export function doctorCommand(publicUrl: string, projectKey: string, site?: string): string {
  const origin = site
    ? ` --origin ${site.includes("://") ? site : `https://${site.replace(/^\*\./, "www.")}`}`
    : "";
  return `npx @pinwren/cli doctor --url ${trimSlash(publicUrl)} --key ${projectKey}${origin}`;
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
