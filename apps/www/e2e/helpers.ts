import { join } from "node:path";
import type { Page } from "@playwright/test";

export const SHOTS = join(__dirname, "__screenshots__/");

/** Every marketing route plus a sample of docs pages; the link checker covers the rest. */
export const ROUTES = [
  "/",
  "/demo",
  "/demo/inbox",
  "/pricing",
  "/changelog",
  "/legal/privacy",
  "/legal/terms",
  "/docs",
  "/docs/quickstart",
  "/docs/self-hosting",
  "/docs/self-hosting/environment",
  "/docs/widget",
  "/docs/widget/configuration",
  "/docs/widget/api",
  "/docs/dashboard",
  "/docs/integrations/webhooks",
  "/docs/api",
  "/docs/api/mcp",
  "/docs/security",
  "/docs/licensing",
  "/docs/faq",
] as const;

/** Console errors and uncaught exceptions on a page; call before navigating. */
export function collectErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

export async function setTheme(page: Page, theme: "light" | "dark") {
  await page.addInitScript((t) => {
    try {
      localStorage.setItem("theme", t);
    } catch {
      // storage blocked: the system theme applies
    }
  }, theme);
  await page.emulateMedia({ colorScheme: theme, reducedMotion: "reduce" });
}

/**
 * The widget renders in a closed Shadow DOM, which Playwright cannot look into; tests open it (as the
 * widget's own e2e suite does). Call before navigating.
 */
export async function openWidgetShadow(page: Page) {
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "attachShadow");
    const original = descriptor?.value as (this: Element, init: ShadowRootInit) => ShadowRoot;
    Element.prototype.attachShadow = function (this: Element, init: ShadowRootInit) {
      return original.call(this, { ...init, mode: "open" });
    };
  });
}
