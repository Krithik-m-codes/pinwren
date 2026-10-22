import { HSTS_HEADER, httpsDecision } from "@pinwren/core";
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

// PINWREN_ENFORCE_HTTPS for every route (pages, /api, /w): plain-HTTP requests that don't come from
// localhost are redirected (GET/HEAD) or refused. Forwarded headers count only with
// PINWREN_TRUST_PROXY. Read straight from the environment: the proxy must not depend on app modules.
const flag = (v: string | undefined) => v === "true" || v === "1";

/** Signed-in screens. Without a session cookie there is nothing to render: send people to sign in at once. */
const APP_PATHS = /^\/(inbox|projects|settings|onboarding)(\/|$)/;

export function proxy(request: NextRequest) {
  const d = httpsDecision(request, {
    enforce: flag(process.env.PINWREN_ENFORCE_HTTPS),
    trustProxy: flag(process.env.PINWREN_TRUST_PROXY),
  });
  if (d.action === "redirect") return NextResponse.redirect(d.location, 308);
  if (d.action === "refuse") {
    return NextResponse.json(
      {
        type: "https://pinwren.dev/errors/https-required",
        title: "This server only accepts HTTPS",
        status: 403,
        code: "HTTPS_REQUIRED",
      },
      { status: 403, headers: { "content-type": "application/problem+json" } },
    );
  }
  // Optimistic check only (is there a session cookie at all?) — the server components and the API verify
  // the session itself. It saves rendering the app shell for someone who is signed out.
  if (APP_PATHS.test(request.nextUrl.pathname) && !getSessionCookie(request)) {
    const to = request.nextUrl.clone();
    to.pathname = "/sign-in";
    to.search = "";
    return NextResponse.redirect(to);
  }
  const res = NextResponse.next();
  if (d.hsts) res.headers.set("strict-transport-security", HSTS_HEADER);
  return res;
}

export const config = {
  // Static files and the widget bundle need no check of their own.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
