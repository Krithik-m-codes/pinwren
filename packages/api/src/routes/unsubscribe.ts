import { getDb, organization } from "@pinwren/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { esc } from "../email/markdown";
import { suppress, verifyUnsubscribeToken } from "../email/unsubscribe";
import { emailBrand } from "../services/branding";

// One-click unsubscribe for reporter emails (wave-4 contract §6). GET shows a confirmation page — link
// scanners and mail previews fetch links, so a GET alone must never unsubscribe anyone. POST does it:
// the page's button, or the mail client's RFC 8058 one-click (`List-Unsubscribe=One-Click`).

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "content-security-policy":
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
};

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title></head>
<body style="margin:0;padding:48px 16px;background:#f6f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1c1c24">
<main style="max-width:440px;margin:0 auto;background:#fff;border-radius:8px;padding:24px">
<h1 style="font-size:18px;margin:0 0 12px">${esc(title)}</h1>
${body}
</main></body></html>`;
  return new Response(html, { status, headers: PAGE_HEADERS });
}

async function orgName(orgId: string): Promise<string> {
  const [o] = await getDb()
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, orgId));
  const brand = await emailBrand(orgId);
  return brand.productName !== "Pinwren" ? brand.productName : (o?.name ?? "this team");
}

const invalid = () =>
  page(
    "Link not valid",
    '<p style="font-size:14px;line-height:1.5">This unsubscribe link is incomplete or was changed. Use the link from the most recent email.</p>',
    400,
  );

export const unsubscribe = new Hono()
  .get("/unsubscribe", async (c) => {
    const token = c.req.query("token") ?? "";
    const who = verifyUnsubscribeToken(token);
    if (!who) return invalid();
    const name = await orgName(who.orgId);
    return page(
      "Unsubscribe",
      `<p style="font-size:14px;line-height:1.5">Stop emails from ${esc(name)} about the feedback you sent, to <strong>${esc(who.email)}</strong>?</p>
<form method="post" action="?token=${esc(encodeURIComponent(token))}"><button type="submit" style="background:#1c1c24;color:#fff;border:0;border-radius:6px;padding:8px 14px;font-size:14px;cursor:pointer">Unsubscribe</button></form>`,
    );
  })
  .post("/unsubscribe", async (c) => {
    const who = verifyUnsubscribeToken(c.req.query("token") ?? "");
    if (!who) return invalid();
    await suppress(who.orgId, who.email);
    // A mail client's one-click POST only needs a 2xx; people get a readable page.
    return page(
      "You're unsubscribed",
      `<p style="font-size:14px;line-height:1.5">${esc(who.email)} won't get further emails from ${esc(await orgName(who.orgId))} about feedback.</p>`,
    );
  });
