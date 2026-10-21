import { apiTokenCreate } from "@pinwren/core";
import { apiToken, getDb } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { isOrgAdmin, type SessionVars } from "../context";
import { hashToken, randomToken } from "../crypto";
import { notFound } from "../errors";

export const TOKEN_PREFIX = "ann_";
/** Characters of the token stored in clear to find it (and shown in lists): `ann_` + 8. */
export const TOKEN_LOOKUP_LENGTH = 12;

const tokenOut = (t: typeof apiToken.$inferSelect) => ({
  id: t.id,
  name: t.name,
  prefix: t.prefix,
  scopes: t.scopes,
  userId: t.userId,
  lastUsedAt: t.lastUsedAt,
  expiresAt: t.expiresAt,
  createdAt: t.createdAt,
});

/** Personal API tokens for the public API (F-081). Each member manages their own. */
export const tokens = new Hono<{ Variables: SessionVars }>()
  .get("/tokens", async (c) => {
    const rows = await getDb()
      .select()
      .from(apiToken)
      .where(and(eq(apiToken.orgId, c.var.orgId), eq(apiToken.userId, c.var.userId)))
      .orderBy(desc(apiToken.createdAt));
    return c.json({ tokens: rows.map(tokenOut) });
  })

  .post("/tokens", zValidator("json", apiTokenCreate), async (c) => {
    const body = c.req.valid("json");
    const secret = `${TOKEN_PREFIX}${randomToken(32)}`;
    const [t] = await getDb()
      .insert(apiToken)
      .values({
        orgId: c.var.orgId,
        userId: c.var.userId,
        name: body.name,
        prefix: secret.slice(0, TOKEN_LOOKUP_LENGTH),
        hash: await hashToken(secret),
        scopes: [...new Set(body.scopes)],
        expiresAt: body.expiresInDays ? new Date(Date.now() + body.expiresInDays * 86_400_000) : null,
      })
      .returning();
    if (!t) throw new Error("token insert failed");
    // The secret is returned once and never stored.
    return c.json({ token: tokenOut(t), secret }, 201);
  })

  .delete("/tokens/:id", async (c) => {
    const owner = isOrgAdmin(c.var.role) ? undefined : eq(apiToken.userId, c.var.userId);
    const rows = await getDb()
      .delete(apiToken)
      .where(and(eq(apiToken.id, c.req.param("id")), eq(apiToken.orgId, c.var.orgId), owner))
      .returning({ id: apiToken.id });
    if (!rows.length) throw notFound("Token");
    return c.body(null, 204);
  });
