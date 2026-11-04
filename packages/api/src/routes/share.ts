import {
  CLOSED_STATUSES,
  parseWidgetConfig,
  SHARE_TOKEN_HEADER,
  SHARE_UNLOCK_HEADER,
  shareCommentCreate,
  type ShareReportResponse,
  type ShareRoundResponse,
  shareUnlock,
  signoffCreate,
  signoffState,
  summarizeDiagnostics,
} from "@pinwren/core";
import {
  afterOrgCommit,
  comment,
  diagnostics,
  feedback,
  feedbackAsset,
  getDb,
  page,
  project,
  reviewRound,
  roundSignoff,
  shareLink,
  withOrg,
} from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { projectForPublicKey } from "../db/bootstrap";
import { verifyToken } from "../crypto";
import { env } from "../env";
import { ApiError, notFound } from "../errors";
import { emit } from "../events";
import { hasFeature } from "../license";
import { clientIp } from "../net";
import { consume } from "../rate-limit";
import { respondWithAsset } from "../services/assets";
import { getOrgBranding } from "../services/branding";
import {
  findShareLink,
  plausibleShareToken,
  SHARE_POSTS_PER_HOUR,
  SHARE_READS_PER_MIN,
  SHARE_UNLOCKS_PER_10MIN,
  SHARE_WRITES_PER_MIN,
  unlockToken,
  verifyUnlockToken,
} from "../services/share-links";
import { announceSignoff, signoffOut } from "../services/signoff";
import { withOrgResponse } from "../tenant-scope";

// What a share link opens (packages/core/src/share.ts): a read-only view of one report or of a review round, for
// someone with no account. The token (header, from the URL fragment) is the whole credential; the project key
// in the path only says which workspace to look in. Reports show public comments and a masked diagnostics
// summary, never internal notes, assignees, the reporter's identity or raw captures.

type Project = typeof project.$inferSelect;
type Link = typeof shareLink.$inferSelect;
type Vars = { project: Project; link: Link };

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Only these file kinds are served under a share link; attachments (arbitrary reporter files) never are. */
const SHARED_ASSET_KINDS = ["screenshot_annotated", "screenshot", "thumbnail", "replay"] as const;
const SCREENSHOT_ORDER = ["screenshot_annotated", "screenshot", "thumbnail"] as const;

/**
 * Resolve the link before any handler runs. `write` picks the rate-limit bucket; `locked: false` is the
 * password check itself, the only route that works before the visitor has unlocked a protected link.
 * `external` is for the asset stream: the handler does its own short transaction and reads storage outside it.
 */
const gate = (opts: { write?: boolean; locked?: boolean; external?: boolean } = {}) =>
  createMiddleware<{ Variables: Vars }>(async (c, next) => {
    c.header("cache-control", "private, no-store");
    c.header("referrer-policy", "no-referrer");
    c.header("x-robots-tag", "noindex, nofollow");
    const key = c.req.param("key") ?? "";
    const token = c.req.header(SHARE_TOKEN_HEADER);
    if (key.length > 160 || !/^pk_[A-Za-z0-9_-]+$/.test(key) || !plausibleShareToken(token)) {
      throw notFound("Share link");
    }
    const ip = clientIp(c, { privacy: true });
    const write = opts.write ?? false;
    if (
      !(await consume(
        `share:${write ? "write" : "read"}:${key}:${ip}`,
        write ? SHARE_WRITES_PER_MIN : SHARE_READS_PER_MIN,
        60,
      ))
    ) {
      throw new ApiError(429, "RATE_LIMITED", "Too many requests. Try again in a minute.");
    }
    const resolve = async () => {
      const [p] = await getDb()
        .select()
        .from(project)
        .where(and(eq(project.publicKey, key), isNull(project.archivedAt)));
      if (!p) throw notFound("Share link");
      const link = await findShareLink(p.id, token);
      if (!link) throw notFound("Share link");
      if (link.revokedAt || link.expiresAt <= new Date()) {
        throw new ApiError(410, "SHARE_LINK_UNAVAILABLE", "This link has expired or was revoked.");
      }
      if (
        (opts.locked ?? true) &&
        link.passwordHash &&
        !verifyUnlockToken(c.req.header(SHARE_UNLOCK_HEADER), link.id)
      ) {
        throw new ApiError(401, "SHARE_PASSWORD_REQUIRED", "This link needs a password.");
      }
      c.set("project", p);
      c.set("link", link);
    };
    if (env().PINWREN_MODE === "cloud") {
      const boot = await projectForPublicKey(key);
      if (!boot) throw notFound("Share link");
      // Streams resolve the link in a finite transaction and read storage outside it.
      if (opts.external) {
        await withOrg(boot.orgId, resolve);
        await next();
      } else {
        await withOrgResponse(boot.orgId, c, async () => {
          await resolve();
          await next();
        });
      }
    } else {
      await resolve();
      await next();
    }
  });

async function head(p: Project, link: Link, canComment: boolean) {
  const entitled = await hasFeature("white_label");
  const brand = entitled ? await getOrgBranding(p.orgId) : null;
  return {
    project: { name: p.name, key: p.publicKey },
    branding: {
      productName: brand?.productName ?? "Pinwren",
      logoUrl: brand?.logoUrl ?? null,
      accent: brand?.accent ?? null,
      hidePoweredBy: entitled,
    },
    link: { label: link.label, expiresAt: link.expiresAt.toISOString(), canComment },
  };
}

async function reportView(p: Project, link: Link, feedbackId: string): Promise<ShareReportResponse> {
  const db = getDb();
  const [row] = await db
    .select({
      id: feedback.id,
      number: feedback.number,
      kind: feedback.kind,
      status: feedback.status,
      priority: feedback.priority,
      title: feedback.title,
      body: feedback.body,
      environment: feedback.environment,
      createdAt: feedback.createdAt,
      pageUrl: page.url,
    })
    .from(feedback)
    .leftJoin(page, and(eq(page.id, feedback.pageId), eq(page.orgId, feedback.orgId)))
    .where(
      and(
        eq(feedback.id, feedbackId),
        eq(feedback.orgId, p.orgId),
        eq(feedback.projectId, p.id),
        isNull(feedback.deletedAt),
      ),
    );
  if (!row) throw notFound("Report");
  const [assets, [diag], comments] = await Promise.all([
    db
      .select({ id: feedbackAsset.id, kind: feedbackAsset.kind, contentType: feedbackAsset.contentType })
      .from(feedbackAsset)
      .where(
        and(
          eq(feedbackAsset.feedbackId, feedbackId),
          eq(feedbackAsset.orgId, p.orgId),
          inArray(feedbackAsset.kind, [...SHARED_ASSET_KINDS]),
        ),
      ),
    db
      .select({ console: diagnostics.console, network: diagnostics.network })
      .from(diagnostics)
      .where(eq(diagnostics.feedbackId, feedbackId)),
    db
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
      .where(
        and(
          eq(comment.orgId, p.orgId),
          eq(comment.feedbackId, feedbackId),
          // Internal notes never leave the team.
          eq(comment.visibility, "public"),
        ),
      )
      .orderBy(asc(comment.createdAt))
      .limit(200),
  ]);
  const env = (row.environment ?? {}) as { browser?: unknown; os?: unknown };
  const shot = SCREENSHOT_ORDER.map((k) => assets.find((a) => a.kind === k)).find(Boolean);
  const replay = assets.find((a) => a.kind === "replay");
  const readOnly = parseWidgetConfig(p.widgetConfig).readOnly;
  return {
    kind: "report",
    ...(await head(p, link, link.allowComments && !readOnly)),
    report: {
      id: row.id,
      number: row.number,
      kind: row.kind,
      status: row.status,
      priority: row.priority,
      title: row.title,
      body: row.body,
      pageUrl: row.pageUrl,
      browser: typeof env.browser === "string" ? env.browser : null,
      os: typeof env.os === "string" ? env.os : null,
      createdAt: row.createdAt.toISOString(),
      screenshot: shot ? { id: shot.id, kind: shot.kind, contentType: shot.contentType } : null,
      replay: replay ? { id: replay.id, kind: replay.kind, contentType: replay.contentType } : null,
      diagnostics: summarizeDiagnostics(diag),
    },
    comments: comments.map((x) => ({ ...x, createdAt: x.createdAt.toISOString() })),
  };
}

async function roundView(p: Project, link: Link, roundId: string): Promise<ShareRoundResponse> {
  const db = getDb();
  const [round] = await db
    .select()
    .from(reviewRound)
    .where(and(eq(reviewRound.id, roundId), eq(reviewRound.orgId, p.orgId), eq(reviewRound.projectId, p.id)));
  if (!round) throw notFound("Round");
  const [items, signoffs] = await Promise.all([
    db
      .select({
        id: feedback.id,
        number: feedback.number,
        kind: feedback.kind,
        status: feedback.status,
        priority: feedback.priority,
        title: feedback.title,
        body: feedback.body,
        pageUrl: page.url,
      })
      .from(feedback)
      .leftJoin(page, and(eq(page.id, feedback.pageId), eq(page.orgId, feedback.orgId)))
      .where(
        and(
          eq(feedback.roundId, roundId),
          eq(feedback.orgId, p.orgId),
          eq(feedback.projectId, p.id),
          isNull(feedback.deletedAt),
        ),
      )
      .orderBy(asc(feedback.number))
      .limit(300),
    db
      .select()
      .from(roundSignoff)
      .where(and(eq(roundSignoff.roundId, roundId), eq(roundSignoff.orgId, p.orgId)))
      .orderBy(desc(roundSignoff.createdAt))
      .limit(20),
  ]);
  const closed = items.filter((i) => (CLOSED_STATUSES as readonly string[]).includes(i.status)).length;
  return {
    kind: "round",
    ...(await head(p, link, false)),
    round: {
      id: round.id,
      name: round.name,
      status: round.status,
      dueAt: round.dueAt?.toISOString() ?? null,
      counts: { total: items.length, open: items.length - closed, closed },
      requireSignoff: round.requireSignoff,
    },
    items: items.map((i) => ({ ...i, body: i.body.slice(0, 1000) })),
    signoffs: signoffs.map((s) => {
      const { email: _email, ...rest } = signoffOut(s);
      return rest;
    }),
    state: signoffState(signoffs[0]),
  };
}

/** Public routes, mounted before the dashboard's session middleware. They never grant team membership. */
export const share = new Hono<{ Variables: Vars }>()
  .get("/share/:key", gate(), async (c) => {
    const { project: p, link } = c.var;
    // Counted per load; the route is rate-limited per visitor, and the dashboard shows the total.
    await getDb()
      .update(shareLink)
      .set({ viewCount: sql`${shareLink.viewCount} + 1`, lastViewedAt: new Date() })
      .where(and(eq(shareLink.id, link.id), eq(shareLink.orgId, p.orgId)));
    if (link.feedbackId) return c.json(await reportView(p, link, link.feedbackId));
    if (link.roundId) return c.json(await roundView(p, link, link.roundId));
    throw notFound("Share link");
  })

  /** Check the password; on success hand back a signed, link-bound proof so it is sent only once. */
  .post(
    "/share/:key/unlock",
    gate({ write: true, locked: false }),
    zValidator("json", shareUnlock),
    async (c) => {
      const { link } = c.var;
      if (!link.passwordHash) return c.json({ unlock: unlockToken(link.id) });
      const ip = clientIp(c, { privacy: true });
      const ok =
        (await consume(`share:unlock:${link.id}:${ip}`, SHARE_UNLOCKS_PER_10MIN, 600)) &&
        // And all visitors together, so rotating addresses doesn't make guessing free.
        (await consume(`share:unlock-all:${link.id}`, SHARE_UNLOCKS_PER_10MIN * 10, 3600));
      if (!ok) throw new ApiError(429, "RATE_LIMITED", "Too many attempts. Try again later.");
      if (!(await verifyToken(c.req.valid("json").password, link.passwordHash))) {
        throw new ApiError(401, "SHARE_PASSWORD_INVALID", "That password is not right.");
      }
      return c.json({ unlock: unlockToken(link.id) });
    },
  )

  /** A screenshot or replay of the shared report, and nothing else. */
  .get("/share/:key/assets/:id", gate({ external: true }), async (c) => {
    const { project: p, link } = c.var;
    const id = c.req.param("id");
    if (!uuid.test(id) || !link.feedbackId) throw notFound("Asset");
    const feedbackId = link.feedbackId;
    const [a] = await withOrg(p.orgId, (db) =>
      db
        .select()
        .from(feedbackAsset)
        .where(
          and(
            eq(feedbackAsset.id, id),
            eq(feedbackAsset.orgId, p.orgId),
            eq(feedbackAsset.feedbackId, feedbackId),
            inArray(feedbackAsset.kind, [...SHARED_ASSET_KINDS]),
          ),
        ),
    );
    if (!a) throw notFound("Asset");
    return respondWithAsset(a);
  })

  .post("/share/:key/comments", gate({ write: true }), zValidator("json", shareCommentCreate), async (c) => {
    const { project: p, link } = c.var;
    if (!link.feedbackId || !link.allowComments || parseWidgetConfig(p.widgetConfig).readOnly) {
      throw new ApiError(403, "COMMENTS_DISABLED", "Comments are turned off for this link.");
    }
    if (!(await consume(`share:post:${link.id}`, SHARE_POSTS_PER_HOUR, 3600))) {
      throw new ApiError(429, "RATE_LIMITED", "Too many comments on this link. Try again later.");
    }
    const [item] = await getDb()
      .select({ id: feedback.id })
      .from(feedback)
      .where(
        and(
          eq(feedback.id, link.feedbackId),
          eq(feedback.orgId, p.orgId),
          eq(feedback.projectId, p.id),
          isNull(feedback.deletedAt),
        ),
      );
    if (!item) throw notFound("Report");
    const body = c.req.valid("json");
    const [created] = await getDb()
      .insert(comment)
      .values({
        orgId: p.orgId,
        feedbackId: item.id,
        authorGuest: { name: body.name },
        body: body.body,
        // Always public: a share link can never write an internal note.
        visibility: "public",
      })
      .returning({ id: comment.id, body: comment.body, createdAt: comment.createdAt });
    if (!created) throw new Error("share comment insert failed");
    emit({
      type: "comment.created",
      orgId: p.orgId,
      feedbackId: item.id,
      commentId: created.id,
      actor: { kind: "guest", id: null },
    });
    return c.json(
      {
        comment: {
          id: created.id,
          body: created.body,
          createdAt: created.createdAt.toISOString(),
          authorName: body.name,
          team: false,
        },
      },
      201,
    );
  })

  .post("/share/:key/signoff", gate({ write: true }), zValidator("json", signoffCreate), async (c) => {
    const { project: p, link } = c.var;
    if (!link.roundId) throw new ApiError(400, "NOT_A_ROUND_LINK", "Only round links take a sign-off.");
    if (!(await consume(`share:post:${link.id}`, SHARE_POSTS_PER_HOUR, 3600))) {
      throw new ApiError(429, "RATE_LIMITED", "Too many answers on this link. Try again later.");
    }
    const [round] = await getDb()
      .select({
        id: reviewRound.id,
        name: reviewRound.name,
        projectId: reviewRound.projectId,
        status: reviewRound.status,
      })
      .from(reviewRound)
      .where(
        and(
          eq(reviewRound.id, link.roundId),
          eq(reviewRound.orgId, p.orgId),
          eq(reviewRound.projectId, p.id),
        ),
      );
    if (!round) throw notFound("Round");
    if (round.status === "closed") throw new ApiError(409, "ROUND_CLOSED", "This round is already closed.");
    const body = c.req.valid("json");
    const [entry] = await getDb()
      .insert(roundSignoff)
      .values({
        orgId: p.orgId,
        roundId: round.id,
        shareLinkId: link.id,
        decision: body.decision,
        name: body.name,
        email: body.email,
        note: body.note,
      })
      .returning();
    if (!entry) throw new Error("sign-off insert failed");
    // After the commit and in its own transaction, so a broken mail setup can't undo the answer.
    const ctx = { id: round.id, name: round.name, projectId: round.projectId, orgId: p.orgId };
    afterOrgCommit(() => withOrg(p.orgId, () => announceSignoff(ctx, entry, link.label || null)));
    const { email: _email, ...out } = signoffOut(entry);
    return c.json({ signoff: out }, 201);
  });
