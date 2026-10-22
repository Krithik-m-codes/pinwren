import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

export const AUTH_DIR = join(__dirname, ".auth");
export const STATE_FILE = join(AUTH_DIR, "admin.json");
export const SEED_FILE = join(AUTH_DIR, "seed.json");
export const SHOTS = join(__dirname, "__screenshots__");
export const SITE_ORIGIN = "https://e2e.example.com";

/** Listed in PINWREN_ADMIN_EMAILS (playwright.config.ts) so the instance-admin screens are reachable. */
export const ADMIN = { name: "Avery Admin", email: "e2e-admin@example.com", password: "e2e-password-123" };

type Item = { id: string; number: number };
export type Seed = {
  orgId: string;
  projectId: string;
  publicKey: string;
  items: Record<"region" | "pin" | "headline" | "mobile" | "bug" | "extra", Item>;
};

export const seed = (): Seed => JSON.parse(readFileSync(SEED_FILE, "utf8")) as Seed;

/**
 * Screenshot the current screen in light and dark (next-themes follows the system preference when no
 * theme is stored, so emulating the colour scheme switches it).
 */
export async function shoot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  // The Next dev-tools badge isn't part of the product.
  await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForFunction(
      (dark) => document.documentElement.classList.contains("dark") === dark,
      scheme === "dark",
    );
    await page.waitForTimeout(150);
    await page.screenshot({
      path: join(SHOTS, `${name}-${scheme}.png`),
      fullPage: opts.fullPage ?? false,
      // The default hides the caret by styling inputs, which React reports as a hydration mismatch when a
      // server-rendered screen is shot before hydration finishes.
      caret: "initial",
    });
  }
  await page.emulateMedia({ colorScheme: "light" });
}
