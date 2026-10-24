import {
  type ApiTokenScope,
  apiCommentCreate,
  feedbackListQuery,
  feedbackUpdate,
  reviewRoundUpdate,
  roleCan,
} from "@pinwren/core";
import { apiToken, feedback, getDb, member, project, user } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { sha256Hex, verifyToken } from "../crypto";
import { ApiError } from "../errors";
import { clientIp, isInternalRequest } from "../net";
import { consume, exhausted } from "../rate-limit";
import { audienceOf, isReadOnlyRole, readOnlyError } from "../permissions";
import { assetResponse } from "../services/assets";
import { addTeamComment, getFeedbackDetail, listFeedback, updateFeedback } from "../services/feedback";
import { reproductionContext } from "../services/reproduction";
import { getRound, listRounds, updateRound } from "../services/rounds";
import { TOKEN_LOOKUP_LENGTH, TOKEN_PREFIX } from "./tokens";

type TokenVars = { orgId: string; userId: string; scopes: string[]; tokenId: string; role: string };

// scrypt is deliberately slow; remember which presented secrets already verified (by SHA-256, never
// the secret itself) so a busy integration doesn't pay it per request. The row is still re-read
// every time, so deleting a token takes effect immediately.
const verified = new Map<string, { tokenId: string; until: number }>();
const VERIFIED_TTL_MS = 5 * 60_000;
const LAST_USED_INTERVAL_MS = 60_000;

const invalidToken = () => new ApiError(401, "INVALID_TOKEN", "Missing, invalid or expired API token");

/** Failed token checks per address in 10 minutes before the address is refused outright. */
export const MAX_TOKEN_FAILURES = 20;
export const TOKEN_FAILURE_WINDOW_S = 600;

/**
 * Brute-force guard (ADR 0021): every rejected token counts against the caller's address; past the
 * limit even a valid token gets 429 until the window ends. /mcp authenticates through here too.
 */
const requireToken = createMiddleware<{ Variables: TokenVars }>(async (c, next) => {
  // The /mcp endpoint's own calls: it applied this guard with the real caller's address already.
  if (isInternalRequest(c.req.raw.headers)) {
    await checkToken(c);
    await next();
    return;
  }
  const failKey = `tokfail:${clientIp(c)}`;
  if (await exhausted(failKey, MAX_TOKEN_FAILURES)) {
    throw new ApiError(429, "RATE_LIMITED", "Too many failed authentication attempts — try again later");
  }
  try {
    await checkToken(c);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401)
      await consume(failKey, MAX_TOKEN_FAILURES, TOKEN_FAILURE_WINDOW_S);
    throw err;
  }
  await next();
});

async function checkToken(c: Context<{ Variables: TokenVars }>) {
  const header = c.req.header("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const secret = match?.[1];
  if (!secret || !secret.startsWith(TOKEN_PREFIX) || secret.length < 40 || secret.length > 100)
    throw invalidToken();

  const db = getDb();
  const [t] = await db
    .select()
    .from(apiToken)
    .where(eq(apiToken.prefix, secret.slice(0, TOKEN_LOOKUP_LENGTH)));
  if (!t) throw invalidToken();
  if (t.expiresAt && t.expiresAt.getTime() <= Date.now()) throw invalidToken();

  const digest = sha256Hex(secret);
  const hit = verified.get(digest);
  if (hit?.tokenId !== t.id || hit.until < Date.now()) {
    if (!(await verifyToken(secret, t.hash))) throw invalidToken();
    if (verified.size > 1000) verified.clear();
    verified.set(digest, { tokenId: t.id, until: Date.now() + VERIFIED_TTL_MS });
  }

  // A token never outlives its owner's membership, and never has more rights than its owner's role.
  const [m] = await db
    .select({ id: member.id, role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, t.orgId), eq(member.userId, t.userId)));
  if (!m) throw invalidToken();

  if (!t.lastUsedAt || Date.now() - t.lastUsedAt.getTime() > LAST_USED_INTERVAL_MS) {
    await db.update(apiToken).set({ lastUsedAt: new Date() }).where(eq(apiToken.id, t.id));
  }
  c.set("orgId", t.orgId);
  c.set("userId", t.userId);
  c.set("scopes", t.scopes);
  c.set("tokenId", t.id);
  c.set("role", m.role);
}

/** A viewer's token reads like the viewer and writes nothing (wave-4 contract §4). */
const forbidViewerWrites = createMiddleware<{ Variables: TokenVars }>(async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD" && isReadOnlyRole(c.var.role)) throw readOnlyError();
  await next();
});

const scope = (s: ApiTokenScope) =>
  createMiddleware<{ Variables: TokenVars }>(async (c, next) => {
    if (!c.var.scopes.includes(s)) {
      throw new ApiError(403, "INSUFFICIENT_SCOPE", `This token lacks the ${s} scope`);
    }
    await next();
  });

/** Public REST API (blueprint 04 §4), authenticated by `Authorization: Bearer pwt_…`. */
export const v1 = new Hono<{ Variables: TokenVars }>()
  .use(requireToken)
  .use(forbidViewerWrites)

  /** Who this token acts as — used by the CLI and MCP clients to check a token. */
  .get("/token", async (c) => {
    const db = getDb();
    const [[t], [u]] = await Promise.all([
      db
        .select({ id: apiToken.id, name: apiToken.name, expiresAt: apiToken.expiresAt })
        .from(apiToken)
        .where(eq(apiToken.id, c.var.tokenId)),
      db.select({ id: user.id, name: user.name }).from(user).where(eq(user.id, c.var.userId)),
    ]);
    return c.json({
      token: { ...t, scopes: c.var.scopes },
      user: u ?? null,
      orgId: c.var.orgId,
      role: c.var.role,
    });
  })

  // Projects are needed to read feedback, so `feedback:read` covers them.
  .get("/projects", scope("feedback:read"), async (c) => {
    const rows = await getDb()
      .select({
        id: project.id,
        name: project.name,
        slug: project.slug,
        publicKey: project.publicKey,
        createdAt: project.createdAt,
        openCount: sql<number>`(select count(*)::int from ${feedback} f where f.project_id = ${project.id}
          and f.deleted_at is null and f.status in ('open','in_progress','in_review'))`,
      })
      .from(project)
      .where(and(eq(project.orgId, c.var.orgId), isNull(project.archivedAt)))
      .orderBy(asc(project.name));
    return c.json({ projects: rows });
  })

  .get("/feedback", scope("feedback:read"), zValidator("query", feedbackListQuery), async (c) => {
    const q = c.req.valid("query");
    // The trash is for Admins (wave-5 contract §3.7), whichever way it is asked for.
    if (q.trash && !roleCan(c.var.role, "feedback.restore")) {
      throw new ApiError(403, "FORBIDDEN_ROLE", "Your role doesn't allow this. Ask a workspace Admin.");
    }
    return c.json(await listFeedback(c.var.orgId, q));
  })
  .get("/feedback/:id", scope("feedback:read"), async (c) =>
    c.json(await getFeedbackDetail(c.var.orgId, c.req.param("id"), audienceOf(c.var.role))),
  )
  .get("/feedback/:id/reproduction", scope("feedback:read"), async (c) =>
    c.json(await reproductionContext(c.var.orgId, c.req.param("id"))),
  )
  .patch("/feedback/:id", scope("feedback:write"), zValidator("json", feedbackUpdate), async (c) => {
    const updated = await updateFeedback(
      c.var.orgId,
      { kind: "api", userId: c.var.userId },
      c.req.param("id"),
      c.req.valid("json"),
    );
    return c.json({ feedback: updated });
  })
  .post(
    "/feedback/:id/comments",
    scope("comments:write"),
    zValidator("json", apiCommentCreate),
    async (c) => {
      const created = await addTeamComment(
        c.var.orgId,
        { kind: "api", userId: c.var.userId },
        c.req.param("id"),
        c.req.valid("json"),
      );
      return c.json({ comment: created }, 201);
    },
  )

  .get("/assets/:id", scope("feedback:read"), (c) => assetResponse(c.var.orgId, c.req.param("id")))

  .get("/projects/:id/rounds", scope("feedback:read"), async (c) =>
    c.json({ rounds: await listRounds(c.var.orgId, c.req.param("id")) }),
  )
  .get("/rounds/:id", scope("feedback:read"), async (c) =>
    c.json({ round: await getRound(c.var.orgId, c.req.param("id")) }),
  )
  .patch("/rounds/:id", scope("feedback:write"), zValidator("json", reviewRoundUpdate), async (c) =>
    c.json({ round: await updateRound(c.var.orgId, c.req.param("id"), c.req.valid("json")) }),
  );
