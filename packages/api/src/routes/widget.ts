import {
  ATTACHMENT_CONTENT_TYPES,
  isClosedStatus,
  isOriginAllowed,
  MAX_ATTACHMENT_BYTES,
  normalizePageUrl,
  parseCaptureConfig,
  parseWidgetBranding,
  parseWidgetConfig,
  publicWidgetConfig,
  MAX_REPLAY_BYTES,
  REPLAY_CONTENT_TYPE,
  REPORTER_TOKEN_HEADER,
  urlPatternRegexSource,
  type WidgetFeedbackCreate,
  widgetCommentCreate,
  widgetFeedbackCreate,
  widgetFeedbackStatusUpdate,
} from "@pinwren/core";
import {
  activity,
  comment,
  diagnostics,
  feedback,
  feedbackAsset,
  getDb,
  page,
  project,
  type ReporterGuest,
  reviewRound,
} from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { randomToken, safeEqualHex, sha256Hex } from "../crypto";
import { env } from "../env";
import { ApiError, notFound } from "../errors";
import { emit } from "../events";
import { clientIp, family } from "../net";
import { hasFeature } from "../license";
import { consume } from "../rate-limit";
import { verifyIdentity } from "../services/identity";
import { decodeDataUrl, decodeImageDataUrl, EXTENSIONS, storage } from "../storage";

const LAST_SEEN_INTERVAL_MS = 60_000;
/** Postgres regex capturing the path of a stored (normalised, absolute) page URL. */
const URL_PATH_RE = "^[a-z][a-z0-9+.-]*://[^/?#]*([^?#]*)";

type WidgetVars = { project: typeof project.$inferSelect; origin: string };

const corsHeaders = (origin: string) => ({
  "access-control-allow-origin": origin,
  "access-control-allow-methods": "GET, POST, PATCH, OPTIONS",
  "access-control-allow-headers": `content-type, x-pinwren-key, ${REPORTER_TOKEN_HEADER}`,
  "access-control-max-age": "600",
  vary: "Origin",
});

const inPrivacyMode = (p: typeof project.$inferSelect) => parseWidgetConfig(p.widgetConfig).privacyMode;

/** Per-project override (dashboard setting) or the instance default. */
const rateLimitFor = (p: typeof project.$inferSelect) =>
  p.widgetRateLimitPerMin ?? env().WIDGET_RATE_LIMIT_PER_MIN;

/**
 * Privacy mode (F-021), enforced on the server too so an old or modified widget can't send more:
 * console entries above errors are dropped, `metadata.performance` is removed and the user agent is
 * reduced to the browser/OS family.
 */
function privacyFilter(input: WidgetFeedbackCreate): WidgetFeedbackCreate {
  const environment = input.environment;
  const browser = family(environment.browser);
  const os = family(environment.os);
  const out: WidgetFeedbackCreate = {
    ...input,
    environment: {
      ...environment,
      userAgent: [browser, os].filter(Boolean).join(" on ") || "unknown",
      ...(browser ? { browser } : {}),
      ...(os ? { os } : {}),
    },
  };
  if (!browser) delete out.environment.browser;
  if (!os) delete out.environment.os;
  if (input.metadata && "performance" in input.metadata) {
    const { performance: _drop, ...rest } = input.metadata;
    out.metadata = rest;
  }
  if (input.diagnostics?.console) {
    out.diagnostics = {
      ...input.diagnostics,
      console: input.diagnostics.console.filter((e) => e.level === "error"),
    };
  }
  return out;
}

type StoredAsset = {
  kind: "screenshot" | "attachment" | "replay";
  key: string;
  contentType: string;
  bytes: number;
  name: string | null;
  meta: Record<string, unknown> | null;
};

/** The project's active review round, when it has exactly one (wave-4 contract §2). */
async function activeRoundOf(projectId: string): Promise<{ id: string; name: string } | null> {
  const rows = await getDb()
    .select({ id: reviewRound.id, name: reviewRound.name })
    .from(reviewRound)
    .where(and(eq(reviewRound.projectId, projectId), eq(reviewRound.status, "active")))
    .limit(2);
  return rows.length === 1 ? (rows[0] ?? null) : null;
}

/**
 * Public widget API (blueprint 04 §2). Authenticated by the public project key plus the browser's
 * Origin, which must be on the project's allowlist. No secret ever reaches the browser.
 */
export const widget = new Hono<{ Variables: WidgetVars }>()
  .options("*", (c) => {
    const origin = c.req.header("origin");
    return origin ? c.body(null, 204, corsHeaders(origin)) : c.body(null, 204);
  })
  .use("*", async (c, next) => {
    const key = c.req.header("x-pinwren-key") ?? c.req.query("key");
    const origin = c.req.header("origin");
    if (!key) throw new ApiError(401, "MISSING_PROJECT_KEY", "x-pinwren-key header is required");
    const [p] = await getDb()
      .select()
      .from(project)
      .where(and(eq(project.publicKey, key), isNull(project.archivedAt)));
    if (!p) throw new ApiError(401, "INVALID_PROJECT_KEY", "Unknown project key");
    if (!origin || !isOriginAllowed(origin, p.allowedOrigins)) {
      throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "This site is not on the project's allowed origins");
    }
    c.set("project", p);
    c.set("origin", origin);
    await next();
    for (const [k, v] of Object.entries(corsHeaders(origin))) c.res.headers.set(k, v);
  })

  .get("/config", async (c) => {
    const p = c.var.project;
    // Mark the project as installed — powers the dashboard's live "verify install" check.
    // Only write when stale: an UPDATE on every widget load turns the project row into a lock hot
    // spot under traffic (found by the k6 load test).
    if (!p.lastSeenAt || Date.now() - p.lastSeenAt.getTime() > LAST_SEEN_INTERVAL_MS) {
      await getDb().update(project).set({ lastSeenAt: new Date() }).where(eq(project.id, p.id));
    }
    // Stored JSON holds only what an admin changed; the widget always gets every key. Privacy mode
    // and dashboard-only actions are applied here (wave-3 contract §1, §3).
    const { widget: w, capture } = publicWidgetConfig(
      parseWidgetConfig(p.widgetConfig),
      parseCaptureConfig(p.captureConfig),
    );
    const [activeRound, whiteLabel] = await Promise.all([activeRoundOf(p.id), hasFeature("white_label")]);
    const branding = parseWidgetBranding(p.widgetBranding);
    return c.json({
      // slug fills `{projectSlug}` in panel-action links (wave-3 contract §1).
      project: { name: p.name, slug: p.slug, publicRead: p.publicRead },
      widget: w,
      capture,
      // Hiding "Powered by Pinwren" is Enterprise white-label: without the entitlement the stored
      // setting is kept but not applied (wave-4 contract §6).
      branding: { ...branding, hidePoweredBy: branding.hidePoweredBy && whiteLabel },
      activeRound,
    });
  })

  .get("/feedback", async (c) => {
    const p = c.var.project;
    if (!p.publicRead) return c.json({ items: [] });
    const url = c.req.query("url");
    const urlPattern = c.req.query("urlPattern");
    const where = [eq(feedback.projectId, p.id), isNull(feedback.deletedAt)];
    // Closed items stay off the page unless asked for; the widget only pins what is still open.
    if (c.req.query("include") !== "closed") {
      where.push(inArray(feedback.status, ["open", "in_progress", "in_review"]));
    }
    if (urlPattern) {
      // Page scope (wave-4 contract §4): pins of every page reported under this pattern or whose path
      // matches it, so `/product/:id` groups all product pages.
      const re = urlPatternRegexSource(urlPattern);
      if (!re) return c.json({ items: [] });
      const pages = await getDb()
        .select({ id: page.id })
        .from(page)
        .where(
          and(
            eq(page.projectId, p.id),
            sql`(${page.urlPattern} = ${urlPattern} or substring(${page.url} from ${URL_PATH_RE}) ~ ${re})`,
          ),
        )
        .limit(1000);
      if (!pages.length) return c.json({ items: [] });
      where.push(
        inArray(
          feedback.pageId,
          pages.map((x) => x.id),
        ),
      );
    } else if (url) {
      const [pg] = await getDb()
        .select({ id: page.id })
        .from(page)
        .where(and(eq(page.projectId, p.id), eq(page.url, normalizePageUrl(url))));
      if (!pg) return c.json({ items: [] });
      where.push(eq(feedback.pageId, pg.id));
    }
    const items = await getDb()
      .select({
        id: feedback.id,
        number: feedback.number,
        kind: feedback.kind,
        status: feedback.status,
        priority: feedback.priority,
        title: feedback.title,
        body: sql<string>`left(${feedback.body}, 500)`,
        anchor: feedback.anchor,
        createdAt: feedback.createdAt,
        reporterName: sql<string | null>`${feedback.reporterGuest}->>'name'`,
        reporterVerified: sql<boolean>`coalesce((${feedback.reporterGuest}->>'verified')::boolean, false)`,
        pageUrl: sql<string | null>`(select pg.url from ${page} pg where pg.id = ${feedback.pageId})`,
        replyCount: sql<number>`(select count(*)::int from ${comment} cm where cm.feedback_id = ${feedback.id} and cm.visibility = 'public')`,
      })
      .from(feedback)
      .where(and(...where))
      .orderBy(desc(feedback.createdAt))
      .limit(100);
    return c.json({ items });
  })

  .get("/feedback/:id/comments", async (c) => {
    const p = c.var.project;
    if (!p.publicRead) throw notFound("Feedback");
    const items = await getDb()
      .select({
        id: comment.id,
        body: comment.body,
        createdAt: comment.createdAt,
        authorName: sql<
          string | null
        >`coalesce((select name from "user" u where u.id = ${comment.authorId}), ${comment.authorGuest}->>'name')`,
        team: sql<boolean>`${comment.authorId} is not null`,
        authorVerified: sql<boolean>`coalesce((${comment.authorGuest}->>'verified')::boolean, false)`,
      })
      .from(comment)
      .innerJoin(feedback, eq(feedback.id, comment.feedbackId))
      .where(
        and(
          eq(comment.feedbackId, c.req.param("id")),
          eq(feedback.projectId, p.id),
          eq(comment.visibility, "public"),
        ),
      )
      .orderBy(asc(comment.createdAt));
    return c.json({ items });
  })

  .post("/feedback", zValidator("json", widgetFeedbackCreate), async (c) => {
    const p = c.var.project;
    const privacy = inPrivacyMode(p);
    const input = privacy ? privacyFilter(c.req.valid("json")) : c.req.valid("json");
    const ip = clientIp(c, { privacy });
    if (!(await consume(`w:${p.id}:${ip}`, rateLimitFor(p), 60))) {
      throw new ApiError(429, "RATE_LIMITED", "Too many reports — try again in a minute");
    }
    if (parseWidgetConfig(p.widgetConfig).readOnly) {
      throw new ApiError(403, "READ_ONLY", "This project is not accepting feedback from the page");
    }

    const db = getDb();
    // Idempotency: the widget retries with the same clientId after a network failure. The replay
    // never carries the reporter token — it was handed out once, with the 201.
    const [existing] = await db
      .select({ id: feedback.id, number: feedback.number })
      .from(feedback)
      .where(and(eq(feedback.projectId, p.id), eq(feedback.clientId, input.clientId)));
    if (existing) return c.json({ feedback: existing }, 200);

    // Decode and type-check every file before anything is written.
    const decoded: {
      kind: StoredAsset["kind"];
      bytes: Uint8Array;
      contentType: string;
      name: string | null;
      meta: Record<string, unknown> | null;
    }[] = [];
    if (input.screenshot) {
      try {
        decoded.push({ kind: "screenshot", name: null, meta: null, ...decodeImageDataUrl(input.screenshot) });
      } catch (err) {
        throw new ApiError(
          400,
          "INVALID_SCREENSHOT",
          err instanceof Error ? err.message : "Invalid screenshot",
        );
      }
    }
    for (const [i, att] of (input.attachments ?? []).entries()) {
      try {
        const file = decodeDataUrl(att.dataUrl, ATTACHMENT_CONTENT_TYPES, MAX_ATTACHMENT_BYTES);
        if (file.contentType !== att.contentType) throw new Error("data URL type differs from contentType");
        decoded.push({ kind: "attachment", name: att.name, meta: null, ...file });
      } catch (err) {
        throw new ApiError(
          400,
          "INVALID_ATTACHMENT",
          `Attachment ${i + 1}: ${err instanceof Error ? err.message : "invalid file"}`,
        );
      }
    }
    // Session replay (F-007): stored only when the project records replays, so an old or modified
    // widget can't make the server keep one the admin didn't ask for.
    if (input.replay && parseCaptureConfig(p.captureConfig).replay.enabled) {
      try {
        const file = decodeDataUrl(input.replay.dataUrl, [REPLAY_CONTENT_TYPE], MAX_REPLAY_BYTES);
        decoded.push({
          kind: "replay",
          name: null,
          meta: { durationMs: input.replay.durationMs, events: input.replay.events },
          ...file,
        });
      } catch (err) {
        throw new ApiError(
          400,
          "INVALID_REPLAY",
          `Session replay: ${err instanceof Error ? err.message : "invalid file"} (gzip, at most 10 MB)`,
        );
      }
    }
    const pageUrl = normalizePageUrl(input.page.url);

    // Signed identity (wave-4 contract §4). The signature itself is never stored.
    let reporter: ReporterGuest | null = null;
    if (input.reporter) {
      const { signature, ...who } = input.reporter;
      reporter = { ...who, verified: verifyIdentity(p.identitySecret, who.externalId, signature) };
    }

    // Resolve the page outside the transaction and without touching an existing row: an upsert
    // that updates the row locks it, and every report on a busy page would queue behind it.
    const [inserted] = await db
      .insert(page)
      .values({
        orgId: p.orgId,
        projectId: p.id,
        url: pageUrl,
        urlPattern: input.page.urlPattern,
        title: input.page.title,
      })
      .onConflictDoNothing({ target: [page.projectId, page.url] })
      .returning({ id: page.id });
    const pageId =
      inserted?.id ??
      (
        await db
          .select({ id: page.id })
          .from(page)
          .where(and(eq(page.projectId, p.id), eq(page.url, pageUrl)))
      )[0]?.id;

    // Write files before the insert, so the per-project counter row is locked only for a few
    // inserts, never for disk or network I/O.
    const assets: StoredAsset[] = [];
    const removeAll = async () => {
      await Promise.all(
        assets.map((a) =>
          storage()
            .remove(a.key)
            .catch(() => {
              // Orphaned files are swept by the nightly cleanup job.
            }),
        ),
      );
    };
    try {
      for (const f of decoded) {
        const key = `${p.id}/${crypto.randomUUID()}.${EXTENSIONS[f.contentType] ?? "bin"}`;
        await storage().put(key, f.bytes, f.contentType);
        assets.push({
          kind: f.kind,
          key,
          contentType: f.contentType,
          bytes: f.bytes.length,
          name: f.name,
          meta: f.meta,
        });
      }
    } catch (err) {
      await removeAll();
      throw err;
    }

    // Proof of authorship for resolve/reopen from the page: random, returned once, stored hashed.
    const reporterToken = randomToken(32);

    // One statement allocates the per-project number and writes the report with its diagnostics,
    // file records and activity entry. The counter row is locked only for the length of this
    // statement; with separate round trips a busy event loop held it long enough for reports to
    // queue behind each other (k6 load test: ~30 connections waiting on that one row; ADR 0013).
    const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
    const diag = input.diagnostics;
    const assetRows = assets.map((a) => ({
      kind: a.kind,
      storage_key: a.key,
      content_type: a.contentType,
      bytes: a.bytes,
      name: a.name,
      meta: a.meta,
    }));
    let created: { id: string; number: number } | undefined;
    try {
      const rows = await db.execute<{ id: string; number: number }>(sql`
        with counter as (
          update ${project} set feedback_counter = feedback_counter + 1
          where id = ${p.id}
          returning feedback_counter as n
        ), f as (
          insert into ${feedback}
            (org_id, project_id, page_id, number, kind, title, body, priority, client_id,
             anchor, environment, metadata, reporter_guest, reporter_token_hash, consent, round_id)
          select ${p.orgId}, ${p.id}, ${pageId ?? null}, counter.n, ${input.kind}::feedback_kind,
             ${input.title ?? null}, ${input.body}, ${input.priority ?? "none"}::priority, ${input.clientId},
             ${json(input.anchor)}::jsonb, ${json(input.environment)}::jsonb, ${json(input.metadata)}::jsonb,
             ${json(reporter)}::jsonb, ${sha256Hex(reporterToken)}, ${json(input.consent)}::jsonb,
             -- The round asked for when it is an active round of this project, else the project's only
             -- active round (a stale widget config still lands somewhere sensible), else none.
             coalesce(
               (select r.id from ${reviewRound} r where r.id = ${input.roundId ?? null}::uuid
                  and r.project_id = ${p.id} and r.status = 'active'),
               (select (array_agg(r.id))[1] from ${reviewRound} r
                  where r.project_id = ${p.id} and r.status = 'active' having count(*) = 1)
             )
          from counter
          returning id, number
        ), d as (
          insert into ${diagnostics} (feedback_id, console, network)
          select f.id, ${json(diag?.console)}::jsonb, ${json(diag?.network)}::jsonb
          from f where ${diag !== undefined}
        ), a as (
          insert into ${feedbackAsset} (org_id, feedback_id, kind, storage_key, content_type, bytes, name, meta)
          select ${p.orgId}, f.id, x.kind::asset_kind, x.storage_key, x.content_type, x.bytes, x.name, x.meta
          from f, jsonb_to_recordset(${JSON.stringify(assetRows)}::jsonb)
            as x(kind text, storage_key text, content_type text, bytes int, name text, meta jsonb)
        ), act as (
          insert into ${activity} (org_id, feedback_id, actor_kind, type, data)
          select ${p.orgId}, f.id, 'guest', 'created', '{"source":"widget"}'::jsonb from f
        )
        select id, number from f
      `);
      created = rows[0];
      if (!created) throw new Error("insert failed");
    } catch (err) {
      await removeAll();
      // Two retries of the same report racing each other: the unique (project, clientId) index
      // lets exactly one win; answer the other with the stored record.
      const [dup] = await db
        .select({ id: feedback.id, number: feedback.number })
        .from(feedback)
        .where(and(eq(feedback.projectId, p.id), eq(feedback.clientId, input.clientId)));
      if (dup) return c.json({ feedback: dup }, 200);
      throw err;
    }

    emit({
      type: "feedback.created",
      orgId: p.orgId,
      feedbackId: created.id,
      actor: { kind: "guest", id: null },
    });
    return c.json({ feedback: { id: created.id, number: created.number, reporterToken } }, 201);
  })

  /**
   * Resolve or reopen from the page (wave-1 contract §5). Allowed when the project lets visitors
   * resolve, or when the caller proves it filed the report with its reporter token.
   */
  .patch("/feedback/:id", zValidator("json", widgetFeedbackStatusUpdate), async (c) => {
    const p = c.var.project;
    const { status } = c.req.valid("json");
    const db = getDb();
    const [f] = await db
      .select({ id: feedback.id, status: feedback.status, tokenHash: feedback.reporterTokenHash })
      .from(feedback)
      .where(
        and(eq(feedback.id, c.req.param("id")), eq(feedback.projectId, p.id), isNull(feedback.deletedAt)),
      );
    if (!f) throw notFound("Feedback");

    const token = c.req.header(REPORTER_TOKEN_HEADER);
    const isReporter = !!token && !!f.tokenHash && safeEqualHex(sha256Hex(token), f.tokenHash);
    const config = parseWidgetConfig(p.widgetConfig);
    const visitorAllowed = config.visitorsCanResolve && p.publicRead && !config.readOnly;
    if (!isReporter && !visitorAllowed) {
      throw new ApiError(403, "RESOLVE_NOT_ALLOWED", "You can't change the status of this feedback");
    }
    if (f.status === status) return c.json({ feedback: { id: f.id, status: f.status } });

    // Status and timeline entry in one statement; matching on the old status guards against a
    // concurrent change.
    const rows = await db.execute<{ id: string; status: string }>(sql`
      with u as (
        update ${feedback} set status = ${status}::feedback_status,
          resolved_at = ${isClosedStatus(status) ? sql`now()` : sql`null`}, updated_at = now()
        where id = ${f.id} and status = ${f.status}::feedback_status
        returning id, status
      ), act as (
        insert into ${activity} (org_id, feedback_id, actor_kind, type, data)
        select ${p.orgId}, u.id, 'guest', 'status_changed',
          ${JSON.stringify({ from: f.status, to: status, via: isReporter ? "reporter" : "visitor" })}::jsonb
        from u
      )
      select id, status from u
    `);
    const updated = rows[0];
    if (!updated) throw new ApiError(409, "CONFLICT", "The status changed meanwhile — reload and try again");
    const base = { orgId: p.orgId, feedbackId: f.id, actor: { kind: "guest" as const, id: null } };
    const changes = { status: { from: f.status, to: status } };
    emit(
      { ...base, type: "feedback.updated", changes },
      { ...base, type: "feedback.status_changed", changes },
    );
    return c.json({ feedback: { id: updated.id, status: updated.status } });
  })

  .post("/feedback/:id/comments", zValidator("json", widgetCommentCreate), async (c) => {
    const p = c.var.project;
    if (!p.publicRead) throw notFound("Feedback");
    if (parseWidgetConfig(p.widgetConfig).readOnly) {
      throw new ApiError(403, "READ_ONLY", "This project is not accepting replies from the page");
    }
    if (!(await consume(`wc:${p.id}:${clientIp(c, { privacy: inPrivacyMode(p) })}`, rateLimitFor(p), 60))) {
      throw new ApiError(429, "RATE_LIMITED", "Too many replies — try again in a minute");
    }
    const db = getDb();
    const [f] = await db
      .select({ id: feedback.id })
      .from(feedback)
      .where(
        and(eq(feedback.id, c.req.param("id")), eq(feedback.projectId, p.id), isNull(feedback.deletedAt)),
      );
    if (!f) throw notFound("Feedback");
    const body = c.req.valid("json");
    let authorGuest: ReporterGuest | null = null;
    if (body.author) {
      const { signature, ...who } = body.author;
      authorGuest = { ...who, verified: verifyIdentity(p.identitySecret, who.externalId, signature) };
    }
    const [created] = await db
      .insert(comment)
      .values({
        orgId: p.orgId,
        feedbackId: f.id,
        body: body.body,
        authorGuest,
        visibility: "public",
      })
      .returning({ id: comment.id, body: comment.body, createdAt: comment.createdAt });
    if (!created) throw new Error("comment insert failed");
    emit({
      type: "comment.created",
      orgId: p.orgId,
      feedbackId: f.id,
      commentId: created.id,
      actor: { kind: "guest", id: null },
    });
    return c.json(
      {
        comment: {
          ...created,
          authorName: body.author?.name ?? null,
          team: false,
          authorVerified: authorGuest?.verified === true,
        },
      },
      201,
    );
  });
