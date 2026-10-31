import { withOrg } from "@pinwren/db";
import { projectForPublicKey } from "../db/bootstrap";
import { requestBoundary, withOrgResponse } from "../tenant-scope";
import {
  anchorBundle,
  ATTACHMENT_CONTENT_TYPES,
  isClosedStatus,
  isOriginAllowed,
  MAX_ATTACHMENT_BYTES,
  MAX_REPORTER_TOKENS,
  normalizePageUrl,
  PAGE_LINK_TOKEN_HEADER,
  parseCaptureConfig,
  parseWidgetBranding,
  parseWidgetConfig,
  publicWidgetConfig,
  MAX_REPLAY_BYTES,
  REPLAY_CONTENT_TYPE,
  REPORTER_TOKEN_HEADER,
  REPORTER_TOKENS_HEADER,
  REVIEW_TOKEN_HEADER,
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
import { and, asc, desc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import { randomToken, safeEqualHex, sha256Hex } from "../crypto";
import { env } from "../env";
import { ApiError, notFound } from "../errors";
import { emit } from "../events";
import { publishDeleted } from "../realtime/publish";
import { clientIp, family } from "../net";
import { hasFeature } from "../license";
import { consume, consumeAmount } from "../rate-limit";
import { updateAnchor } from "../services/anchor";
import { verifyIdentity } from "../services/identity";
import { verifyPageLinkToken } from "../services/page-link";
import { recordRejectedOrigin } from "../services/rejected-origins";
import { findReviewLink } from "../services/review-links";
import { decodeDataUrl, decodeImageDataUrl, EXTENSIONS, storage } from "../storage";

const LAST_SEEN_INTERVAL_MS = 60_000;
/** Postgres regex capturing the path of a stored (normalised, absolute) page URL. */
const URL_PATH_RE = "^[a-z][a-z0-9+.-]*://[^/?#]*([^?#]*)";

type WidgetVars = { project: typeof project.$inferSelect; origin: string };
type Project = typeof project.$inferSelect;

const corsHeaders = (origin: string) => ({
  "access-control-allow-origin": origin,
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "access-control-allow-headers": [
    "content-type",
    "x-pinwren-key",
    REPORTER_TOKEN_HEADER,
    REPORTER_TOKENS_HEADER,
    PAGE_LINK_TOKEN_HEADER,
    REVIEW_TOKEN_HEADER,
  ].join(", "),
  "access-control-max-age": "600",
  vary: "Origin",
});

const inPrivacyMode = (p: Project) => parseWidgetConfig(p.widgetConfig).privacyMode;

/** Page URLs are grouped with the built-in ignored parameters plus the project's own (wave-5 §2). */
const pageKey = (p: Project, url: string) =>
  normalizePageUrl(url, parseWidgetConfig(p.widgetConfig).ignoredQueryParams);

/** One pin as the widget lists it (`GET /w/feedback`, `/w/mine`, `/w/feedback/:id`). */
const pinColumns = {
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
};

/** A live item's public replies, oldest first. */
async function publicReplies(p: Project, feedbackId: string) {
  return getDb()
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
        eq(comment.feedbackId, feedbackId),
        eq(feedback.projectId, p.id),
        // A deleted (trashed) item's thread is gone from the page too.
        isNull(feedback.deletedAt),
        eq(comment.visibility, "public"),
      ),
    )
    .orderBy(asc(comment.createdAt));
}

/** Reporter tokens from `x-pinwren-reporter-tokens`: well-formed, deduplicated, at most 50. */
export function reporterTokensOf(header: string | undefined): string[] {
  if (!header) return [];
  const out = new Set<string>();
  for (const raw of header.split(",")) {
    const t = raw.trim();
    if (/^[A-Za-z0-9_-]{16,128}$/.test(t)) out.add(t);
    if (out.size >= MAX_REPORTER_TOKENS) break;
  }
  return [...out];
}

/**
 * Which items are "on this page": the page the URL normalises to, or with a page scope (wave-4 contract §4)
 * every page reported under the pattern or whose path matches it, so `/product/:id` groups all product
 * pages. null = no page filter; "none" = nothing can match.
 */
async function pageFilter(
  p: Project,
  url: string | undefined,
  urlPattern: string | undefined,
): Promise<SQL | null | "none"> {
  if (urlPattern) {
    const re = urlPatternRegexSource(urlPattern);
    if (!re) return "none";
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
    if (!pages.length) return "none";
    return inArray(
      feedback.pageId,
      pages.map((x) => x.id),
    );
  }
  if (!url) return null;
  let key: string;
  try {
    key = pageKey(p, url);
  } catch {
    return "none"; // not a URL
  }
  const [pg] = await getDb()
    .select({ id: page.id })
    .from(page)
    .where(and(eq(page.projectId, p.id), eq(page.url, key)));
  return pg ? eq(feedback.pageId, pg.id) : "none";
}

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/**
 * Whether this request may read (and reply to) one item although the project keeps pins private: the visitor
 * opened a signed page link for this item, or the reporter proves authorship with its token (wave-5 §3.3).
 */
async function privateAccess(
  header: (name: string) => string | undefined,
  p: Project,
  feedbackId: string,
): Promise<boolean> {
  if (verifyPageLinkToken(header(PAGE_LINK_TOKEN_HEADER))?.feedbackId === feedbackId) return true;
  const token = header(REPORTER_TOKEN_HEADER);
  if (!token) return false;
  const [f] = await getDb()
    .select({ tokenHash: feedback.reporterTokenHash })
    .from(feedback)
    .where(and(eq(feedback.id, feedbackId), eq(feedback.projectId, p.id)));
  return !!f?.tokenHash && safeEqualHex(sha256Hex(token), f.tokenHash);
}

/**
 * Largest valid report: replay (14 MB of base64) + screenshot (11 MB) + three attachments (7 MB each)
 * + text and diagnostics. Anything bigger is refused while it streams in, before it is parsed.
 */
const MAX_REPORT_BODY = 48 * 1024 * 1024;
const MAX_SMALL_BODY = 64 * 1024;

const tooLarge = () => new ApiError(413, "PAYLOAD_TOO_LARGE", "Request body too large");
const limitBody = (maxSize: number) =>
  bodyLimit({
    maxSize,
    onError: () => {
      throw tooLarge();
    },
  });

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
  /** Screenshot only (wave-5 §3.3): the reporter's vector shapes and the viewport it was taken in. */
  annotations: WidgetFeedbackCreate["annotations"] | null;
  capture: WidgetFeedbackCreate["capture"] | null;
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
 * Rate limits for a new report, checked before the body is read or parsed: per sender address and,
 * because addresses can be many, per project whatever the sender (WIDGET_PROJECT_REPORTS_PER_MIN).
 * A report must declare its length, so its size is known before a byte is buffered.
 */
const reportIntake = createMiddleware<{ Variables: WidgetVars }>(async (c, next) => {
  const p = c.var.project;
  const length = c.req.header("content-length");
  if (!length || c.req.header("transfer-encoding")) {
    throw new ApiError(411, "LENGTH_REQUIRED", "Send the report with a Content-Length");
  }
  if (Number(length) > MAX_REPORT_BODY) throw tooLarge();
  const ip = clientIp(c, { privacy: inPrivacyMode(p) });
  if (!(await consume(`w:${p.id}:${ip}`, rateLimitFor(p), 60))) {
    throw new ApiError(429, "RATE_LIMITED", "Too many reports — try again in a minute");
  }
  if (!(await consume(`wp:${p.id}`, env().WIDGET_PROJECT_REPORTS_PER_MIN, 60))) {
    throw new ApiError(
      429,
      "PROJECT_RATE_LIMITED",
      "This project is receiving too many reports — try again soon",
    );
  }
  await next();
});

/** Replies: rate-limited before the body is parsed. */
const replyIntake = createMiddleware<{ Variables: WidgetVars }>(async (c, next) => {
  const p = c.var.project;
  if (!(await consume(`wc:${p.id}:${clientIp(c, { privacy: inPrivacyMode(p) })}`, rateLimitFor(p), 60))) {
    throw new ApiError(429, "RATE_LIMITED", "Too many replies — try again in a minute");
  }
  await next();
});

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
    if (env().PINWREN_MODE !== "cloud") {
      const [p] = await getDb()
        .select()
        .from(project)
        .where(and(eq(project.publicKey, key), isNull(project.archivedAt)));
      if (!p) throw new ApiError(401, "INVALID_PROJECT_KEY", "Unknown project key");
      if (!origin || !isOriginAllowed(origin, p.allowedOrigins)) {
        // Remembered for the Install tab ("Blocked a request from … — Allow"); throttled, never fails the request.
        if (origin) await recordRejectedOrigin(p, origin);
        throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "This site is not on the project's allowed origins");
      }
      c.set("project", p);
      c.set("origin", origin);
      await next();
    } else {
      const boot = await projectForPublicKey(key);
      if (!boot) throw new ApiError(401, "INVALID_PROJECT_KEY", "Unknown project key");
      if (!origin || !isOriginAllowed(origin, boot.allowedOrigins)) {
        if (origin)
          await withOrg(boot.orgId, async (db) => {
            const [p] = await db
              .select({ id: project.id, rejectedOrigins: project.rejectedOrigins })
              .from(project)
              .where(and(eq(project.id, boot.id), eq(project.publicKey, key), isNull(project.archivedAt)));
            if (p) await recordRejectedOrigin(p, origin);
          });
        throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "This site is not on the project's allowed origins");
      }
      const prepare = async () => {
        const [p] = await getDb()
          .select()
          .from(project)
          .where(and(eq(project.id, boot.id), eq(project.publicKey, key), isNull(project.archivedAt)));
        if (!p) throw new ApiError(401, "INVALID_PROJECT_KEY", "Unknown project key");
        if (!isOriginAllowed(origin, p.allowedOrigins))
          throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "This site is not on the project's allowed origins");
        c.set("project", p);
        c.set("origin", origin);
      };
      if (requestBoundary(c)?.databaseLifetime === "finite") {
        await withOrgResponse(boot.orgId, c, async () => {
          await prepare();
          await next();
        });
      } else {
        await withOrg(boot.orgId, prepare);
        await next();
      }
    }
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
    const onPage = await pageFilter(p, url, urlPattern);
    if (onPage === "none") return c.json({ items: [] });
    if (onPage) where.push(onPage);
    const items = await getDb()
      .select(pinColumns)
      .from(feedback)
      .where(and(...where))
      .orderBy(desc(feedback.createdAt))
      .limit(100);
    return c.json({ items });
  })

  /**
   * The reporter's own items, whatever `publicRead` says (wave-5 §3.3): the widget sends the reporter tokens
   * it holds for this project. Closed items are included, so "Mine" shows what the team resolved.
   */
  .get("/mine", async (c) => {
    const p = c.var.project;
    const tokens = reporterTokensOf(c.req.header(REPORTER_TOKENS_HEADER));
    if (!tokens.length) return c.json({ items: [] });
    // Optional `url` / `urlPattern`: only this page's items, matched like `GET /w/feedback`.
    const onPage = await pageFilter(p, c.req.query("url"), c.req.query("urlPattern"));
    if (onPage === "none") return c.json({ items: [] });
    const items = await getDb()
      .select(pinColumns)
      .from(feedback)
      .where(
        and(
          eq(feedback.projectId, p.id),
          isNull(feedback.deletedAt),
          inArray(
            feedback.reporterTokenHash,
            tokens.map((t) => sha256Hex(t)),
          ),
          onPage ?? undefined,
        ),
      )
      .orderBy(desc(feedback.createdAt))
      .limit(MAX_REPORTER_TOKENS);
    return c.json({ items });
  })

  /**
   * One item opened from a signed page link (`?pinwren=<id>&pwt=<token>`), with its public replies, even when
   * the project keeps pins private. A missing, forged, expired or foreign token is a plain 404.
   */
  .get("/feedback/:id", async (c) => {
    const p = c.var.project;
    const id = c.req.param("id");
    const claim = verifyPageLinkToken(c.req.header(PAGE_LINK_TOKEN_HEADER));
    if (!isUuid(id) || claim?.feedbackId !== id) throw notFound("Feedback");
    const [item] = await getDb()
      .select(pinColumns)
      .from(feedback)
      .where(and(eq(feedback.id, id), eq(feedback.projectId, p.id), isNull(feedback.deletedAt)));
    if (!item) throw notFound("Feedback");
    return c.json({ item, replies: await publicReplies(p, id), scope: claim.scope });
  })

  .get("/feedback/:id/comments", async (c) => {
    const p = c.var.project;
    const id = c.req.param("id");
    if (!isUuid(id)) throw notFound("Feedback");
    if (!p.publicRead && !(await privateAccess((n) => c.req.header(n), p, id))) throw notFound("Feedback");
    return c.json({ items: await publicReplies(p, id) });
  })

  /**
   * Re-pin from the page (F-031): the widget holds a team-issued `repin` page link for this item and sends the
   * anchor of the element the team member picked. The old anchor stays in the activity history.
   */
  .patch(
    "/feedback/:id/anchor",
    limitBody(MAX_SMALL_BODY),
    zValidator("json", z.object({ anchor: anchorBundle })),
    async (c) => {
      const p = c.var.project;
      const id = c.req.param("id");
      const claim = verifyPageLinkToken(c.req.header(PAGE_LINK_TOKEN_HEADER));
      if (claim?.feedbackId !== id || claim.scope !== "repin") {
        throw new ApiError(403, "REPIN_NOT_ALLOWED", "This link doesn't allow moving the pin");
      }
      const [f] = await getDb()
        .select({ id: feedback.id })
        .from(feedback)
        .where(and(eq(feedback.id, id), eq(feedback.projectId, p.id), isNull(feedback.deletedAt)));
      if (!f) throw notFound("Feedback");
      const out = await updateAnchor(
        p.orgId,
        f.id,
        c.req.valid("json").anchor,
        { kind: "guest", id: null },
        "widget",
      );
      return c.json({ feedback: out });
    },
  )

  .post(
    "/feedback",
    reportIntake,
    limitBody(MAX_REPORT_BODY),
    zValidator("json", widgetFeedbackCreate),
    async (c) => {
      const p = c.var.project;
      const privacy = inPrivacyMode(p);
      const input = privacy ? privacyFilter(c.req.valid("json")) : c.req.valid("json");
      if (parseWidgetConfig(p.widgetConfig).readOnly) {
        throw new ApiError(403, "READ_ONLY", "This project is not accepting feedback from the page");
      }

      // Idempotency: the widget retries with the same clientId after a network failure. The replay
      // never carries the reporter token — it was handed out once, with the 201.
      const [existing] = await withOrg(p.orgId, (db) =>
        db
          .select({ id: feedback.id, number: feedback.number })
          .from(feedback)
          .where(and(eq(feedback.projectId, p.id), eq(feedback.clientId, input.clientId))),
      );
      if (existing) return c.json({ feedback: existing }, 200);

      // Decode and type-check every file before anything is written.
      const decoded: {
        kind: StoredAsset["kind"];
        bytes: Uint8Array;
        contentType: string;
        name: string | null;
        meta: Record<string, unknown> | null;
        annotations?: StoredAsset["annotations"];
        capture?: StoredAsset["capture"];
      }[] = [];
      if (input.screenshot) {
        try {
          decoded.push({
            kind: "screenshot",
            name: null,
            meta: null,
            annotations: input.annotations ?? null,
            capture: input.capture ?? null,
            ...decodeImageDataUrl(input.screenshot),
          });
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
      // Disk budget per project and hour (WIDGET_PROJECT_MB_PER_HOUR), counted in KiB of files kept, so
      // many senders together can't fill the disk.
      const fileKib = decoded.reduce((n, f) => n + f.bytes.length, 0) / 1024;
      if (
        fileKib > 0 &&
        !(await consumeAmount(`wb:${p.id}`, fileKib, env().WIDGET_PROJECT_MB_PER_HOUR * 1024, 3600))
      ) {
        throw new ApiError(
          429,
          "PROJECT_STORAGE_LIMITED",
          "This project has received too many files this hour",
        );
      }
      const pageUrl = pageKey(p, input.page.url);
      // Signed identity (wave-4 contract §4). The signature itself is never stored.
      let reporter: ReporterGuest | null = null;
      if (input.reporter) {
        const { signature, ...who } = input.reporter;
        reporter = { ...who, verified: verifyIdentity(p.identitySecret, who.externalId, signature) };
      }

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
            annotations: f.annotations ?? null,
            capture: f.capture ?? null,
          });
        }
      } catch (err) {
        await removeAll();
        throw err;
      }

      // Proof of authorship for resolve/reopen from the page: random, returned once, stored hashed.
      const reporterToken = randomToken(32);

      // Keep the counter/report/asset/activity writes together (ADR 0013). Diagnostics follow in
      // the same finite transaction so their parent-derived RLS policy can see the feedback row.
      // All uploads finish before the counter row is locked.
      const json = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));
      const diag = input.diagnostics;
      const assetRows = assets.map((a) => ({
        kind: a.kind,
        storage_key: a.key,
        content_type: a.contentType,
        bytes: a.bytes,
        name: a.name,
        meta: a.meta,
        annotations: a.annotations,
        capture: a.capture,
      }));
      let created: { id: string; number: number } | undefined;
      try {
        created = await withOrg(p.orgId, async (db) => {
          // Revalidate the project capability after uploads and before creating any database rows.
          const [current] = await db
            .select({
              id: project.id,
              allowedOrigins: project.allowedOrigins,
              widgetConfig: project.widgetConfig,
            })
            .from(project)
            .where(and(eq(project.id, p.id), eq(project.publicKey, p.publicKey), isNull(project.archivedAt)));
          if (!current) throw new ApiError(401, "INVALID_PROJECT_KEY", "Unknown project key");
          if (!isOriginAllowed(c.var.origin, current.allowedOrigins))
            throw new ApiError(
              403,
              "ORIGIN_NOT_ALLOWED",
              "This site is not on the project's allowed origins",
            );
          if (parseWidgetConfig(current.widgetConfig).readOnly)
            throw new ApiError(403, "READ_ONLY", "This project is not accepting feedback from the page");
          // A guest who came through a review link (wave-5 §3.5): the report records the link as its source.
          // A revoked or expired link doesn't refuse the report; it just isn't attributed.
          const via = await findReviewLink(p.id, c.req.header(REVIEW_TOKEN_HEADER));

          // Resolve the page in the final database unit, after uploads, without updating an existing row.
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

          const rows = await db.execute<{ id: string; number: number }>(sql`
        with counter as (
          update ${project} set feedback_counter = feedback_counter + 1
          where id = ${p.id}
          returning feedback_counter as n
        ), f as (
          insert into ${feedback}
            (org_id, project_id, page_id, number, kind, title, body, priority, client_id,
             anchor, environment, metadata, reporter_guest, reporter_token_hash, consent, round_id,
             review_link_id)
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
             ),
             ${via?.id ?? null}::uuid
          from counter
          returning id, number
        ), a as (
          insert into ${feedbackAsset}
            (org_id, feedback_id, kind, storage_key, content_type, bytes, name, meta, annotations, capture)
          select ${p.orgId}, f.id, x.kind::asset_kind, x.storage_key, x.content_type, x.bytes, x.name, x.meta,
            x.annotations, x.capture
          from f, jsonb_to_recordset(${JSON.stringify(assetRows)}::jsonb)
            as x(kind text, storage_key text, content_type text, bytes int, name text, meta jsonb,
                 annotations jsonb, capture jsonb)
        ), act as (
          insert into ${activity} (org_id, feedback_id, actor_kind, type, data)
          select ${p.orgId}, f.id, 'guest', 'created',
            ${JSON.stringify(via ? { source: "widget", reviewLink: via.label } : { source: "widget" })}::jsonb from f
        )
        select id, number from f
      `);
          const result = rows[0];
          if (!result) throw new Error("insert failed");
          // A parent-derived RLS check cannot see a parent inserted in the same CTE snapshot.
          // A second command in this transaction sees the new feedback and remains atomic with it.
          if (diag !== undefined)
            await db.insert(diagnostics).values({
              feedbackId: result.id,
              console: diag.console ?? null,
              network: diag.network ?? null,
            });
          return result;
        });
      } catch (err) {
        await removeAll();
        // Two retries of the same report racing each other: the unique (project, clientId) index
        // lets exactly one win; answer the other with the stored record.
        const [dup] = await withOrg(p.orgId, async (db) => {
          const [current] = await db
            .select({ id: project.id })
            .from(project)
            .where(and(eq(project.id, p.id), eq(project.publicKey, p.publicKey), isNull(project.archivedAt)));
          if (!current) throw err;
          return db
            .select({ id: feedback.id, number: feedback.number })
            .from(feedback)
            .where(and(eq(feedback.projectId, p.id), eq(feedback.clientId, input.clientId)));
        });
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
    },
  )

  /**
   * Resolve or reopen from the page (wave-1 contract §5). Allowed when the project lets visitors
   * resolve, or when the caller proves it filed the report with its reporter token.
   */
  .patch(
    "/feedback/:id",
    limitBody(MAX_SMALL_BODY),
    zValidator("json", widgetFeedbackStatusUpdate),
    async (c) => {
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
      if (!updated)
        throw new ApiError(409, "CONFLICT", "The status changed meanwhile — reload and try again");
      const base = { orgId: p.orgId, feedbackId: f.id, actor: { kind: "guest" as const, id: null } };
      const changes = { status: { from: f.status, to: status } };
      emit(
        { ...base, type: "feedback.updated", changes },
        { ...base, type: "feedback.status_changed", changes },
      );
      return c.json({ feedback: { id: updated.id, status: updated.status } });
    },
  )

  // --- Wave 5 (widget look and feel): delete from the sidebar ----------------------------------------
  /**
   * The reporter deletes their own feedback from the page, proven by the reporter token this browser got
   * when it sent the item. It goes to the trash (an Admin can restore it), like a dashboard delete.
   */
  .delete("/feedback/:id", async (c) => {
    const p = c.var.project;
    if (parseWidgetConfig(p.widgetConfig).readOnly) {
      throw new ApiError(403, "READ_ONLY", "This project is not accepting changes from the page");
    }
    const db = getDb();
    const [f] = await db
      .select({ id: feedback.id, tokenHash: feedback.reporterTokenHash })
      .from(feedback)
      .where(
        and(eq(feedback.id, c.req.param("id")), eq(feedback.projectId, p.id), isNull(feedback.deletedAt)),
      );
    if (!f) throw notFound("Feedback");
    const token = c.req.header(REPORTER_TOKEN_HEADER);
    if (!token || !f.tokenHash || !safeEqualHex(sha256Hex(token), f.tokenHash)) {
      throw new ApiError(403, "DELETE_NOT_ALLOWED", "Only the person who sent this feedback can delete it");
    }
    const trashed = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(feedback)
        .set({ deletedAt: new Date() })
        .where(and(eq(feedback.id, f.id), isNull(feedback.deletedAt)))
        .returning({ id: feedback.id });
      if (!row) return false;
      await tx.insert(activity).values({
        orgId: p.orgId,
        feedbackId: f.id,
        actorKind: "guest",
        type: "deleted",
        data: { via: "reporter" },
      });
      return true;
    });
    if (trashed) {
      emit({
        type: "feedback.deleted",
        orgId: p.orgId,
        feedbackId: f.id,
        actor: { kind: "guest", id: null },
      });
      publishDeleted(p.orgId, p.id, f.id);
    }
    return c.body(null, 204);
  })

  .post(
    "/feedback/:id/comments",
    replyIntake,
    limitBody(MAX_SMALL_BODY),
    zValidator("json", widgetCommentCreate),
    async (c) => {
      const p = c.var.project;
      const id = c.req.param("id");
      // Private pins: the reporter (token) or a signed page-link holder may still reply (wave-5 §3.3).
      if (!isUuid(id) || (!p.publicRead && !(await privateAccess((n) => c.req.header(n), p, id)))) {
        throw notFound("Feedback");
      }
      if (parseWidgetConfig(p.widgetConfig).readOnly) {
        throw new ApiError(403, "READ_ONLY", "This project is not accepting replies from the page");
      }
      const db = getDb();
      const [f] = await db
        .select({ id: feedback.id })
        .from(feedback)
        .where(and(eq(feedback.id, id), eq(feedback.projectId, p.id), isNull(feedback.deletedAt)));
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
    },
  );
