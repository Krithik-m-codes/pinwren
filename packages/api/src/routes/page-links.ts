import { anchorBundle, roleCan } from "@pinwren/core";
import { feedback, getDb, page, project } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { SessionVars } from "../context";
import { ApiError, notFound, unauthorized } from "../errors";
import { requirePermission } from "../permissions";
import { updateAnchor } from "../services/anchor";
import { pageLinkUrl, REPIN_LINK_TTL_HOURS } from "../services/page-link";
import { mergeProjectPages } from "../services/page-merge";

export const pageLinkRequest = z.object({
  /** A short-lived link that also opens the widget in re-pin mode (Admins and Editors). */
  repin: z.boolean().optional(),
});

export const anchorUpdate = z.object({ anchor: anchorBundle });

/**
 * Signed page links, re-pinning and page re-grouping (wave-5 contract §3.3, §2). Mounted under /api after the dashboard router, so
 * its session (`requireSession`) and viewer (`forbidViewerWrites`) middleware run first; the userId check
 * below keeps these routes closed if that order ever changes.
 */
export const pageLinks = new Hono<{ Variables: SessionVars }>()
  .use(async (c, next) => {
    // Set by requireSession (see above); checked in case the mount order ever changes.
    if (!c.var.userId || !c.var.orgId) throw unauthorized();
    await next();
  })

  /** Any member who can read the item, viewers included (it changes nothing). */
  .post("/feedback/:id/page-link", zValidator("json", pageLinkRequest), async (c) => {
    const { repin } = c.req.valid("json");
    if (repin && !roleCan(c.var.role, "feedback.update")) {
      throw new ApiError(403, "FORBIDDEN_ROLE", "Your role doesn't allow this. Ask a workspace Admin.");
    }
    const [row] = await getDb()
      .select({ id: feedback.id, pageUrl: page.url })
      .from(feedback)
      .leftJoin(page, eq(page.id, feedback.pageId))
      .where(
        and(eq(feedback.id, c.req.param("id")), eq(feedback.orgId, c.var.orgId), isNull(feedback.deletedAt)),
      );
    if (!row) throw notFound("Feedback");
    if (!row.pageUrl) throw new ApiError(409, "NO_PAGE", "This item wasn't left on a web page");
    const { url, expiresAt } = repin
      ? pageLinkUrl(row.id, row.pageUrl, REPIN_LINK_TTL_HOURS / 24, "repin")
      : pageLinkUrl(row.id, row.pageUrl);
    return c.json({ url, expiresAt: expiresAt.toISOString() });
  })

  .patch(
    "/feedback/:id/anchor",
    requirePermission("feedback.update"),
    zValidator("json", anchorUpdate),
    async (c) => {
      const out = await updateAnchor(
        c.var.orgId,
        c.req.param("id"),
        c.req.valid("json").anchor,
        { kind: "user", id: c.var.userId },
        "dashboard",
      );
      return c.json({ feedback: out });
    },
  )

  /**
   * Re-group the project's pages under its current URL rules (built-in trackers + `ignoredQueryParams`), right
   * after an Admin changed them in Page Review › URL grouping. Startup does the same for every project.
   */
  .post("/projects/:id/pages/regroup", requirePermission("projects.manage"), async (c) => {
    const [p] = await getDb()
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, c.req.param("id")), eq(project.orgId, c.var.orgId)));
    if (!p) throw notFound("Project");
    return c.json({ merged: await mergeProjectPages(p.id) });
  });
