import { shareLinkCreate, type RoundSignoffs, signoffState } from "@pinwren/core";
import { feedback, getDb, project, reviewRound, shareLink } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import type { SessionVars } from "../context";
import { hashToken, randomToken, sha256Hex } from "../crypto";
import { ApiError, notFound } from "../errors";
import { requirePermission } from "../permissions";
import { consume } from "../rate-limit";
import { SHARE_LINKS_PER_HOUR, shareLinkOut, shareUrl } from "../services/share-links";
import { listSignoffs, signoffOut } from "../services/signoff";

// Share links, dashboard side: create, list and revoke the links of a report or a review round, and read a
// round's client sign-offs. The public side (what a link opens) is routes/share.ts.

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function listFor(orgId: string, column: "feedback" | "round", id: string) {
  const what = column === "feedback" ? "Feedback" : "Round";
  if (!uuid.test(id)) throw notFound(what);
  const [target] =
    column === "feedback"
      ? await getDb()
          .select({ id: feedback.id })
          .from(feedback)
          .where(and(eq(feedback.id, id), eq(feedback.orgId, orgId)))
      : await getDb()
          .select({ id: reviewRound.id })
          .from(reviewRound)
          .where(and(eq(reviewRound.id, id), eq(reviewRound.orgId, orgId)));
  if (!target) throw notFound(what);
  const rows = await getDb()
    .select()
    .from(shareLink)
    .where(
      and(
        eq(shareLink.orgId, orgId),
        column === "feedback" ? eq(shareLink.feedbackId, id) : eq(shareLink.roundId, id),
      ),
    )
    .orderBy(desc(shareLink.createdAt))
    .limit(100);
  return rows.map((r) => shareLinkOut(r));
}

/** Mounted under /api after the dashboard, whose session and viewer guards cover these routes. */
export const shareLinks = new Hono<{ Variables: SessionVars }>()
  .get("/feedback/:id/share-links", async (c) =>
    c.json({ links: await listFor(c.var.orgId, "feedback", c.req.param("id")) }),
  )
  .get("/rounds/:id/share-links", async (c) =>
    c.json({ links: await listFor(c.var.orgId, "round", c.req.param("id")) }),
  )

  .get("/rounds/:id/signoffs", async (c) => {
    const id = c.req.param("id");
    if (!uuid.test(id)) throw notFound("Round");
    const [round] = await getDb()
      .select({ id: reviewRound.id, requireSignoff: reviewRound.requireSignoff })
      .from(reviewRound)
      .where(and(eq(reviewRound.id, id), eq(reviewRound.orgId, c.var.orgId)));
    if (!round) throw notFound("Round");
    const rows = await listSignoffs(c.var.orgId, id);
    const out: RoundSignoffs = {
      state: signoffState(rows[0]),
      requireSignoff: round.requireSignoff,
      signoffs: rows.map(signoffOut),
    };
    return c.json(out);
  })

  .post(
    "/share-links",
    requirePermission("feedback.update"),
    zValidator("json", shareLinkCreate),
    async (c) => {
      const body = c.req.valid("json");
      const orgId = c.var.orgId;
      // The target, from this workspace only: a foreign or deleted id is a plain 404.
      let projectId: string;
      if (body.feedbackId) {
        const [f] = await getDb()
          .select({ projectId: feedback.projectId })
          .from(feedback)
          .where(
            and(eq(feedback.id, body.feedbackId), eq(feedback.orgId, orgId), isNull(feedback.deletedAt)),
          );
        if (!f) throw notFound("Feedback");
        projectId = f.projectId;
      } else if (body.roundId) {
        const [r] = await getDb()
          .select({ projectId: reviewRound.projectId })
          .from(reviewRound)
          .where(and(eq(reviewRound.id, body.roundId), eq(reviewRound.orgId, orgId)));
        if (!r) throw notFound("Round");
        projectId = r.projectId;
      } else throw notFound("Share target");
      const [p] = await getDb()
        .select({ publicKey: project.publicKey })
        .from(project)
        .where(and(eq(project.id, projectId), eq(project.orgId, orgId), isNull(project.archivedAt)));
      if (!p) throw notFound("Project");
      if (!(await consume(`share:new:${orgId}`, SHARE_LINKS_PER_HOUR, 3600))) {
        throw new ApiError(429, "RATE_LIMITED", "Too many share links this hour. Try again later.");
      }
      const token = `pws_${randomToken(24)}`;
      const [row] = await getDb()
        .insert(shareLink)
        .values({
          orgId,
          projectId,
          feedbackId: body.feedbackId ?? null,
          roundId: body.roundId ?? null,
          label: body.label,
          tokenHash: sha256Hex(token),
          // Same slow hash as API tokens: a leaked row doesn't give the password away.
          passwordHash: body.password ? await hashToken(body.password) : null,
          allowComments: body.allowComments && !!body.feedbackId,
          expiresAt: new Date(Date.now() + body.expiresInDays * 86_400_000),
          createdBy: c.var.userId,
        })
        .returning();
      if (!row) throw new Error("share link insert failed");
      return c.json({ link: shareLinkOut(row), url: shareUrl(p.publicKey, token) }, 201);
    },
  )

  .delete("/share-links/:id", requirePermission("feedback.update"), async (c) => {
    const id = c.req.param("id");
    if (!uuid.test(id)) throw notFound("Share link");
    const [row] = await getDb()
      .update(shareLink)
      .set({ revokedAt: new Date() })
      .where(and(eq(shareLink.id, id), eq(shareLink.orgId, c.var.orgId), isNull(shareLink.revokedAt)))
      .returning({ id: shareLink.id });
    if (!row) throw notFound("Share link");
    return c.body(null, 204);
  });
