import {
  GUEST_PAGE_TOKENS_HEADER,
  guestReplyCreate,
  parseWidgetConfig,
  REPORTER_TOKENS_HEADER,
} from "@pinwren/core";
import { comment, feedback, getDb, project } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { ApiError, notFound, problem } from "../errors";
import { emit } from "../events";
import { hasFeature } from "../license";
import { clientIp } from "../net";
import { consume } from "../rate-limit";
import { getOrgBranding } from "../services/branding";
import { guestClaims, parseGuestAccess } from "../services/guest";

type Project = typeof project.$inferSelect;
type Vars = { project: Project; ownership: SQL };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Deliberately excludes reporter identities, tokens, diagnostics, assignments and internal activity. */
const columns = {
  id: feedback.id,
  number: feedback.number,
  kind: feedback.kind,
  status: feedback.status,
  priority: feedback.priority,
  title: feedback.title,
  body: feedback.body,
  createdAt: feedback.createdAt,
  pageUrl: sql<
    string | null
  >`(select pg.url from page pg where pg.id = ${feedback.pageId} and pg.project_id = ${feedback.projectId} and pg.org_id = ${feedback.orgId})`,
  replyCount: sql<number>`(select count(*)::int from comment cm where cm.feedback_id = ${feedback.id} and cm.org_id = ${feedback.orgId} and cm.visibility = 'public')`,
};

function liveOwned(p: Project, ownership: SQL, id?: string) {
  return and(
    eq(feedback.orgId, p.orgId),
    eq(feedback.projectId, p.id),
    isNull(feedback.deletedAt),
    ownership,
    id ? eq(feedback.id, id) : undefined,
  );
}

/** Mounted ahead of dashboard session middleware; these routes never grant team membership. */
export const guestPortal = new Hono<{ Variables: Vars }>()
  .use("/guest/:key/*", async (c, next) => {
    const sharedContext = c as Context;
    c.header("cache-control", "private, no-store");
    c.header("referrer-policy", "no-referrer");
    const access = parseGuestAccess(
      c.req.header(REPORTER_TOKENS_HEADER),
      c.req.header(GUEST_PAGE_TOKENS_HEADER),
    );
    const claims = access ? guestClaims(access) : null;
    if (!claims || (!claims.ids.length && !claims.hashes.length)) {
      return problem(
        sharedContext,
        401,
        "GUEST_ACCESS_REQUIRED",
        "Open your feedback from its email link or the website widget.",
      );
    }
    const key = c.req.param("key");
    if (!key || key.length > 160 || !/^pk_[A-Za-z0-9_-]+$/.test(key)) throw notFound("Project");
    const writing = c.req.method === "POST";
    if (
      !(await consume(
        `guest:${writing ? "write" : "read"}:${key}:${clientIp(sharedContext, { privacy: true })}`,
        writing ? 20 : 120,
        60,
      ))
    ) {
      throw new ApiError(429, "RATE_LIMITED", "Too many requests. Try again in a minute.");
    }
    const [p] = await getDb()
      .select()
      .from(project)
      .where(and(eq(project.publicKey, key), isNull(project.archivedAt)));
    if (!p) throw notFound("Project");
    const ownership = or(
      claims.hashes.length ? inArray(feedback.reporterTokenHash, claims.hashes) : undefined,
      claims.ids.length ? inArray(feedback.id, claims.ids) : undefined,
    );
    if (!ownership) throw notFound("Feedback");
    c.set("project", p);
    c.set("ownership", ownership);
    await next();
  })
  .get("/guest/:key/feedback", async (c) => {
    const p = c.var.project;
    const [items, entitled] = await Promise.all([
      getDb()
        .select(columns)
        .from(feedback)
        .where(liveOwned(p, c.var.ownership))
        .orderBy(desc(feedback.createdAt))
        .limit(50),
      hasFeature("white_label"),
    ]);
    const brand = entitled ? await getOrgBranding(p.orgId) : null;
    return c.json({
      project: { name: p.name, key: p.publicKey, canReply: !parseWidgetConfig(p.widgetConfig).readOnly },
      branding: {
        productName: brand?.productName ?? "Pinwren",
        logoUrl: brand?.logoUrl ?? null,
        accent: brand?.accent ?? null,
        hidePoweredBy: entitled,
      },
      items,
    });
  })
  .get("/guest/:key/feedback/:id", async (c) => {
    const p = c.var.project;
    const id = c.req.param("id");
    if (!uuid.test(id)) throw notFound("Feedback");
    const [item] = await getDb()
      .select(columns)
      .from(feedback)
      .where(liveOwned(p, c.var.ownership, id));
    if (!item) throw notFound("Feedback");
    const replies = await getDb()
      .select({
        id: comment.id,
        body: comment.body,
        createdAt: comment.createdAt,
        authorName: sql<
          string | null
        >`coalesce((select u.name from "user" u where u.id = ${comment.authorId}), ${comment.authorGuest}->>'name')`,
        team: sql<boolean>`${comment.authorId} is not null`,
      })
      .from(comment)
      .where(and(eq(comment.orgId, p.orgId), eq(comment.feedbackId, id), eq(comment.visibility, "public")))
      .orderBy(asc(comment.createdAt));
    return c.json({ item, replies });
  })
  .post("/guest/:key/feedback/:id/comments", zValidator("json", guestReplyCreate), async (c) => {
    const p = c.var.project;
    const id = c.req.param("id");
    if (!uuid.test(id)) throw notFound("Feedback");
    const [item] = await getDb()
      .select({ id: feedback.id, reporter: feedback.reporterGuest })
      .from(feedback)
      .where(liveOwned(p, c.var.ownership, id));
    if (!item) throw notFound("Feedback");
    if (parseWidgetConfig(p.widgetConfig).readOnly)
      throw new ApiError(403, "READ_ONLY", "This project is not accepting replies.");
    const [created] = await getDb()
      .insert(comment)
      .values({
        orgId: p.orgId,
        feedbackId: id,
        authorGuest: item.reporter,
        body: c.req.valid("json").body,
        visibility: "public",
      })
      .returning({ id: comment.id, body: comment.body, createdAt: comment.createdAt });
    if (!created) throw new Error("guest reply insert failed");
    emit({
      type: "comment.created",
      orgId: p.orgId,
      feedbackId: id,
      commentId: created.id,
      actor: { kind: "guest", id: null },
    });
    return c.json({ comment: { ...created, authorName: item.reporter?.name ?? null, team: false } }, 201);
  });
