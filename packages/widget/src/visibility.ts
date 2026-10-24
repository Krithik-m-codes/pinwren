import { urlPatternMatches } from "../../core/src/url-pattern";
import type { WidgetConfig } from "./config";

// Visibility rules (F-012, SitePing parity; wave-4 §4). Widget-side only: the server just stores the setting.
//
// With `environments: "non-production"` the widget hides on production hosts. A host counts as
// NON-production when it is:
//   - `localhost` or `*.localhost`, a loopback address (127.x.x.x, ::1) or 0.0.0.0,
//   - a private LAN address (10.x, 192.168.x, 172.16–31.x),
//   - under a development-only suffix: `.local`, `.test`, `.localhost`, `.internal`,
//   - a `staging`, `stage`, `preview` or `dev` subdomain — any label but the last (so `pinwren.dev` is
//     production, `dev.example.com`, `staging.example.com`, `preview-42.example.com` are not),
//   - not a network host at all (`file:` pages have no hostname).
// Everything else is production. `forceShow` (`data-force-show` or the init option) overrides every rule.

const DEV_SUFFIX = /\.(local|test|localhost|internal)$/;
const DEV_LABEL = /^(staging|stage|preview|dev)(\d*|-[a-z0-9-]*)$/;

export function isProductionHost(hostname: string): boolean {
  const host = hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (!host || host === "localhost" || host === "::1" || host === "0.0.0.0") return false;
  if (DEV_SUFFIX.test(host)) return false;
  const ip = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (ip) {
    const a = Number(ip[1]);
    const b = Number(ip[2]);
    return !(a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31));
  }
  const labels = host.split(".");
  return !labels.slice(0, -1).some((l) => DEV_LABEL.test(l));
}

export type Hidden = "environment" | "viewport" | null;

/** Why the widget must stay hidden right now, or null when it may show. */
export function hiddenBy(
  v: Pick<WidgetConfig["visibility"], "environments" | "minViewportWidth">,
  page: { hostname: string; width: number; forceShow: boolean },
): Hidden {
  if (page.forceShow) return null;
  if (v.environments === "non-production" && isProductionHost(page.hostname)) return "environment";
  if (v.minViewportWidth > 0 && page.width < v.minViewportWidth) return "viewport";
  return null;
}

/**
 * Who gets the widget (`visibility.mode`, wave-5 §2):
 *   always       everyone
 *   identified   only after `Pinwren.identify(user)` with an id or email
 *   queryParam   the page was opened with `?<queryParam>` (remembered for the browser session)
 *   urlPatterns  the page path matches one of `urlPatterns` (`/app/*`, `/product/:id`)
 *   manual       nobody until the host calls `Pinwren.show()`
 * `Pinwren.show()` / `hide()` override the mode either way (`host`), and a valid review link shows it in
 * every mode.
 */
export function allowedByMode(
  v: Pick<WidgetConfig["visibility"], "mode" | "urlPatterns">,
  page: { url: string; identified: boolean; flagged: boolean; review: boolean; host: "show" | "hide" | null },
): boolean {
  if (page.host) return page.host === "show";
  if (page.review) return true;
  switch (v.mode) {
    case "identified":
      return page.identified;
    case "queryParam":
      return page.flagged;
    case "urlPatterns":
      return v.urlPatterns.some((p) => urlPatternMatches(p, page.url));
    case "manual":
      return false;
    default:
      return true;
  }
}
