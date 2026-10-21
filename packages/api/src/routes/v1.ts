import { type ApiTokenScope, apiCommentCreate, feedbackListQuery, feedbackUpdate } from "@annota/core";
import { apiToken, getDb, member } from "@annota/db";
import { zValidator } from "@hono/zod-validator";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { sha256Hex, verifyToken } from "../crypto";
import { ApiError } from "../errors";
import { addTeamComment, getFeedbackDetail, listFeedback, updateFeedback } from "../services/feedback";
import { TOKEN_LOOKUP_LENGTH, TOKEN_PREFIX } from "./tokens";

type TokenVars = { orgId: string; userId: string; scopes: string[]; tokenId: string };

// scrypt is deliberately slow; remember which presented secrets already verified (by SHA-256, never
// the secret itself) so a busy integration doesn't pay it per request. The row is still re-read
// every time, so deleting a token takes effect immediately.
const verified = new Map<string, { tokenId: string; until: number }>();
const VERIFIED_TTL_MS = 5 * 60_000;
const LAST_USED_INTERVAL_MS = 60_000;

const invalidToken = () => new ApiError(401, "INVALID_TOKEN", "Missing, invalid or expired API token");

const requireToken = createMiddleware<{ Variables: TokenVars }>(async (c, next) => {
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
  if (!hit || hit.tokenId !== t.id || hit.until < Date.now()) {
    if (!(await verifyToken(secret, t.hash))) throw invalidToken();
    if (verified.size > 1000) verified.clear();
    verified.set(digest, { tokenId: t.id, until: Date.now() + VERIFIED_TTL_MS });
  }

  // A token never outlives its owner's membership.
  const [m] = await db
    .select({ id: member.id })
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
  await next();
});

const scope = (s: ApiTokenScope) =>
  createMiddleware<{ Variables: TokenVars }>(async (c, next) => {
    if (!c.var.scopes.includes(s)) {
      throw new ApiError(403, "INSUFFICIENT_SCOPE", `This token lacks the ${s} scope`);
    }
    await next();
  });

/** Public REST API (blueprint 04 §4), authenticated by `Authorization: Bearer ann_…`. */
export const v1 = new Hono<{ Variables: TokenVars }>()
  .use(requireToken)
  .get("/feedback", scope("feedback:read"), zValidator("query", feedbackListQuery), async (c) =>
    c.json(await listFeedback(c.var.orgId, c.req.valid("query"))),
  )
  .get("/feedback/:id", scope("feedback:read"), async (c) =>
    c.json(await getFeedbackDetail(c.var.orgId, c.req.param("id"))),
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
  );
