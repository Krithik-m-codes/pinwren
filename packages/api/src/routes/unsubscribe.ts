import {
  feedback,
  feedbackAsset,
  getDb,
  member,
  notificationPreference,
  organization,
  project,
} from "@pinwren/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { type TeamUnsubscribe, verifyEmailImageToken, verifyTeamUnsubscribeToken } from "../email/links";
import { esc } from "../email/markdown";
import { suppress, verifyUnsubscribeToken } from "../email/unsubscribe";
import { emailBrand } from "../services/branding";
import { storage } from "../storage";

// One-click unsubscribe for reporter emails (wave-4 contract §6). GET shows a confirmation page — link
// scanners and mail previews fetch links, so a GET alone must never unsubscribe anyone. POST does it:
// the page's button, or the mail client's RFC 8058 one-click (`List-Unsubscribe=One-Click`).
//
// Team emails (wave-5 contract §3.2) work the same way under /unsubscribe/team: a member's link turns off
// email for that project in their preferences; an extra address's link removes it from the project's
// Notifications › General list. /email-assets/:token serves the screenshot thumbnail of team emails.

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

async function projectName(projectId: string): Promise<{ orgId: string; name: string } | null> {
  const [p] = await getDb()
    .select({ orgId: project.orgId, name: project.name })
    .from(project)
    .where(eq(project.id, projectId));
  return p ?? null;
}

const describeTeam = (who: TeamUnsubscribe, name: string) =>
  who.kind === "member"
    ? `Stop emails about <strong>${esc(name)}</strong>? You'll still see notifications in the dashboard, and you can turn email back on in Settings › Notifications.`
    : `Stop sending new-report emails about <strong>${esc(name)}</strong> to <strong>${esc(who.email)}</strong>?`;

/** Apply a team unsubscribe. A member who has left the workspace has nothing left to turn off. */
async function applyTeam(who: TeamUnsubscribe, orgId: string): Promise<void> {
  const db = getDb();
  if (who.kind === "address") {
    await db
      .update(project)
      .set({ notifyEmails: sql`array_remove(${project.notifyEmails}, ${who.email})` })
      .where(eq(project.id, who.projectId));
    return;
  }
  const [m] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, who.userId)));
  if (!m) return;
  await db
    .insert(notificationPreference)
    .values({ orgId, userId: who.userId, projectId: who.projectId, email: false })
    .onConflictDoUpdate({
      target: [notificationPreference.userId, notificationPreference.projectId],
      set: { email: false, updatedAt: new Date() },
    });
}

export const teamUnsubscribe = new Hono()
  .get("/unsubscribe/team", async (c) => {
    const token = c.req.query("token") ?? "";
    const who = verifyTeamUnsubscribeToken(token);
    const p = who ? await projectName(who.projectId) : null;
    if (!who || !p) return invalid();
    return page(
      "Unsubscribe",
      `<p style="font-size:14px;line-height:1.5">${describeTeam(who, p.name)}</p>
<form method="post" action="?token=${esc(encodeURIComponent(token))}"><button type="submit" style="background:#1c1c24;color:#fff;border:0;border-radius:6px;padding:8px 14px;font-size:14px;cursor:pointer">Unsubscribe</button></form>`,
    );
  })
  .post("/unsubscribe/team", async (c) => {
    const who = verifyTeamUnsubscribeToken(c.req.query("token") ?? "");
    const p = who ? await projectName(who.projectId) : null;
    if (!who || !p) return invalid();
    await applyTeam(who, p.orgId);
    return page(
      "You're unsubscribed",
      who.kind === "member"
        ? `<p style="font-size:14px;line-height:1.5">No more emails about ${esc(p.name)}. The dashboard bell still shows what happens.</p>`
        : `<p style="font-size:14px;line-height:1.5">${esc(who.email)} won't get new-report emails about ${esc(p.name)} any more.</p>`,
    );
  })

  /** The screenshot in a team email: signed, long-lived, no session (mail clients fetch it anonymously). */
  .get("/email-assets/:token", async (c) => {
    const assetId = verifyEmailImageToken(c.req.param("token"));
    if (!assetId) return c.body(null, 404);
    const [a] = await getDb()
      .select({ key: feedbackAsset.storageKey, contentType: feedbackAsset.contentType })
      .from(feedbackAsset)
      .innerJoin(feedback, eq(feedback.id, feedbackAsset.feedbackId))
      .where(and(eq(feedbackAsset.id, assetId), isNull(feedback.deletedAt)));
    // Only images: the token names a screenshot, but never serve anything else under it.
    if (!a?.contentType.startsWith("image/")) return c.body(null, 404);
    const file = await storage().get(a.key);
    if (!file) return c.body(null, 404);
    const headers: Record<string, string> = {
      "content-type": a.contentType,
      "cache-control": "private, max-age=86400",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    };
    if (file.bytes) headers["content-length"] = String(file.bytes);
    return new Response(file.body, { headers });
  });
