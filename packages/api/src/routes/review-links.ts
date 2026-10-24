import { isOriginAllowed, parseWidgetConfig, REVIEW_TOKEN_HEADER, reviewLinkCreate } from "@pinwren/core";
import { getDb, project, reviewLink } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { SessionVars } from "../context";
import { randomToken, sha256Hex } from "../crypto";
import { ApiError, notFound } from "../errors";
import { clientIp } from "../net";
import { requirePermission } from "../permissions";
import { consume } from "../rate-limit";
import {
  feedbackCounts,
  findReviewLink,
  linkOut,
  REVIEW_CHECKS_PER_MIN,
  REVIEW_LINKS_PER_HOUR,
  reviewUrl,
} from "../services/review-links";

// Review links (wave-5 contract §3.5): the dashboard routes that make, list and revoke them, and the widget's
// token check. The logic shared with `POST /w/feedback` lives in services/review-links.ts.

export { reviewLinkActive, reviewUrl } from "../services/review-links";
export { REVIEW_TOKEN_HEADER };

async function projectOf(orgId: string, id: string) {
  const [p] = await getDb()
    .select({ id: project.id, allowedOrigins: project.allowedOrigins })
    .from(project)
    .where(and(eq(project.id, id), eq(project.orgId, orgId)));
  if (!p) throw notFound("Project");
  return p;
}

/** Session routes, mounted under /api after the dashboard (whose session and viewer guards cover them). */
export const reviewLinks = new Hono<{ Variables: SessionVars }>()
  .get("/projects/:id/review-links", requirePermission("projects.manage"), async (c) => {
    const p = await projectOf(c.var.orgId, c.req.param("id"));
    const rows = await getDb()
      .select()
      .from(reviewLink)
      .where(eq(reviewLink.projectId, p.id))
      .orderBy(desc(reviewLink.createdAt));
    const counts = await feedbackCounts(rows.map((r) => r.id));
    return c.json({ links: rows.map((r) => linkOut(r, counts.get(r.id) ?? 0)) });
  })

  .post(
    "/projects/:id/review-links",
    requirePermission("projects.manage"),
    zValidator("json", reviewLinkCreate),
    async (c) => {
      const body = c.req.valid("json");
      const p = await projectOf(c.var.orgId, c.req.param("id"));
      if (!isOriginAllowed(new URL(body.url).origin, p.allowedOrigins)) {
        throw new ApiError(
          400,
          "ORIGIN_NOT_ALLOWED",
          "That page isn't on the project's allowed sites. Add the site on the Install tab first.",
        );
      }
      if (!(await consume(`rl:new:${c.var.orgId}`, REVIEW_LINKS_PER_HOUR, 3600))) {
        throw new ApiError(429, "RATE_LIMITED", "Too many review links this hour — try again later");
      }
      const token = `pwr_${randomToken(24)}`;
      const [row] = await getDb()
        .insert(reviewLink)
        .values({
          orgId: c.var.orgId,
          projectId: p.id,
          label: body.label,
          tokenHash: sha256Hex(token),
          expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null,
          createdBy: c.var.userId,
        })
        .returning();
      if (!row) throw new Error("review link insert failed");
      return c.json({ link: linkOut(row), url: reviewUrl(body.url, token) }, 201);
    },
  )

  .delete("/review-links/:id", requirePermission("projects.manage"), async (c) => {
    const [row] = await getDb()
      .update(reviewLink)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(reviewLink.id, c.req.param("id")),
          eq(reviewLink.orgId, c.var.orgId),
          isNull(reviewLink.revokedAt),
        ),
      )
      .returning();
    if (!row) throw notFound("Review link");
    return c.body(null, 204);
  });

type WidgetVars = { project: typeof project.$inferSelect; origin: string };

/**
 * `GET /w/review-link`, mounted under /w after the widget router, whose middleware has already checked
 * the project key and the Origin and set `project` (and adds the CORS headers). Rate-limited per visitor
 * address, so the endpoint can't be used to guess tokens.
 */
export const reviewLinkWidget = new Hono<{ Variables: WidgetVars }>().get("/review-link", async (c) => {
  const p = c.var.project;
  const ip = clientIp(c, { privacy: parseWidgetConfig(p.widgetConfig).privacyMode });
  if (!(await consume(`wrl:${p.id}:${ip}`, REVIEW_CHECKS_PER_MIN, 60))) {
    throw new ApiError(429, "RATE_LIMITED", "Too many review link checks — try again in a minute");
  }
  const link = await findReviewLink(p.id, c.req.header(REVIEW_TOKEN_HEADER), { touch: true });
  if (!link) throw notFound("Review link");
  return c.json({ ok: true });
});
