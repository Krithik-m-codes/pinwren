import type { PanelAction } from "./config";

// Panel actions (F-016, wave-3 §1): admin-defined links shown in the thread card. Placeholders are filled
// with URL-encoded values, so a feedback id or page URL can never break out of its query parameter or path
// segment, and the result must still be an http(s) URL — anything else is not rendered at all.

export type ActionVars = { id: string; number: number; url: string; projectSlug: string };

const PLACEHOLDER = /\{(id|number|url|projectSlug)\}/g;

/** The action's URL with placeholders substituted, or null when the result isn't a safe http(s) URL. */
export function actionHref(template: string, vars: ActionVars): string | null {
  const filled = template.replace(PLACEHOLDER, (_m, k: keyof ActionVars) =>
    encodeURIComponent(String(vars[k])),
  );
  try {
    const u = new URL(filled);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.href;
  } catch {
    return null;
  }
}

/** Actions a page visitor may see: links meant for everyone (team actions and webhooks are dashboard-only). */
export const visitorActions = (actions: readonly PanelAction[]) =>
  actions.filter((a) => a.kind === "link" && a.visibleTo === "everyone");
