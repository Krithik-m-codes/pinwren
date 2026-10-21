import { issueCreate, issueIntegrationCreate, issueIntegrationUpdate } from "@pinwren/core";
import { getDb, issueIntegration, project } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { requireOrgAdmin, type SessionVars } from "../context";
import { decryptSecret, encryptSecret, randomToken } from "../crypto";
import { ApiError, notFound } from "../errors";
import { sendToTracker, trackerConfig, webhookUrlFor } from "../integrations/issues";
import { checkAccess, TrackerError } from "../integrations/trackers";

type Integration = typeof issueIntegration.$inferSelect;

/** Tokens and secrets never leave the server; the last 4 characters identify the token. */
export const integrationOut = (i: Integration) => ({
  id: i.id,
  projectId: i.projectId,
  provider: i.provider,
  repo: i.repo,
  apiUrl: i.apiUrl,
  labels: i.labels,
  autoCreate: i.autoCreate,
  active: i.active,
  tokenHint: i.tokenHint,
  lastError: i.lastError,
  webhookUrl: webhookUrlFor(i.provider),
  createdAt: i.createdAt,
  updatedAt: i.updatedAt,
});

const hint = (token: string) => `…${token.slice(-4)}`;

async function ownIntegration(orgId: string, id: string): Promise<Integration> {
  const [i] = await getDb()
    .select()
    .from(issueIntegration)
    .where(and(eq(issueIntegration.id, id), eq(issueIntegration.orgId, orgId)));
  if (!i) throw notFound("Integration");
  return i;
}

/** GitHub / GitLab issue sync (F-076/F-077). Configuring is for org admins; sending is for anyone. */
export const integrations = new Hono<{ Variables: SessionVars }>()
  .get("/projects/:id/integrations", requireOrgAdmin, async (c) => {
    const rows = await getDb()
      .select()
      .from(issueIntegration)
      .where(and(eq(issueIntegration.projectId, c.req.param("id")), eq(issueIntegration.orgId, c.var.orgId)))
      .orderBy(asc(issueIntegration.provider));
    return c.json({ integrations: rows.map(integrationOut) });
  })

  .post(
    "/projects/:id/integrations",
    requireOrgAdmin,
    zValidator("json", issueIntegrationCreate),
    async (c) => {
      const body = c.req.valid("json");
      const db = getDb();
      const [p] = await db
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.id, c.req.param("id")), eq(project.orgId, c.var.orgId)));
      if (!p) throw notFound("Project");
      const secret = `whsec_${randomToken(24)}`;
      const [i] = await db
        .insert(issueIntegration)
        .values({
          orgId: c.var.orgId,
          projectId: p.id,
          provider: body.provider,
          token: encryptSecret(body.token),
          tokenHint: hint(body.token),
          repo: body.repo,
          apiUrl: body.apiUrl ?? null,
          labels: [...new Set(body.labels)],
          autoCreate: body.autoCreate,
          webhookSecret: encryptSecret(secret),
          createdBy: c.var.userId,
        })
        .onConflictDoNothing({ target: [issueIntegration.projectId, issueIntegration.provider] })
        .returning();
      if (!i) {
        throw new ApiError(
          409,
          "INTEGRATION_EXISTS",
          "This project already has that integration — edit it instead",
        );
      }
      // The inbound webhook secret is also revealable later; the token never is.
      return c.json({ integration: integrationOut(i), webhookSecret: secret }, 201);
    },
  )

  .patch("/integrations/:id", requireOrgAdmin, zValidator("json", issueIntegrationUpdate), async (c) => {
    const body = c.req.valid("json");
    const current = await ownIntegration(c.var.orgId, c.req.param("id"));
    if (body.repo && current.provider === "github" && body.repo.split("/").length !== 2) {
      throw new ApiError(400, "VALIDATION_ERROR", "GitHub repositories are owner/name");
    }
    const set: Partial<typeof issueIntegration.$inferInsert> = {};
    if (body.token !== undefined) {
      set.token = encryptSecret(body.token);
      set.tokenHint = hint(body.token);
      set.lastError = null;
    }
    if (body.repo !== undefined) set.repo = body.repo;
    if (body.apiUrl !== undefined) set.apiUrl = body.apiUrl;
    if (body.labels !== undefined) set.labels = [...new Set(body.labels)];
    if (body.autoCreate !== undefined) set.autoCreate = body.autoCreate;
    if (body.active !== undefined) set.active = body.active;
    if (!Object.keys(set).length) return c.json({ integration: integrationOut(current) });
    const [i] = await getDb()
      .update(issueIntegration)
      .set(set)
      .where(eq(issueIntegration.id, current.id))
      .returning();
    if (!i) throw notFound("Integration");
    return c.json({ integration: integrationOut(i) });
  })

  .delete("/integrations/:id", requireOrgAdmin, async (c) => {
    const i = await ownIntegration(c.var.orgId, c.req.param("id"));
    await getDb().delete(issueIntegration).where(eq(issueIntegration.id, i.id));
    return c.body(null, 204);
  })

  /** Can the token see the repository? Always 200; `{ ok, message }`. */
  .post("/integrations/:id/test", requireOrgAdmin, async (c) => {
    const i = await ownIntegration(c.var.orgId, c.req.param("id"));
    let result: Awaited<ReturnType<typeof checkAccess>>;
    try {
      result = await checkAccess(trackerConfig(i));
    } catch (err) {
      result = { ok: false, message: err instanceof TrackerError ? err.message : "failed" };
    }
    await getDb()
      .update(issueIntegration)
      .set({ lastError: result.ok ? null : result.message.slice(0, 300) })
      .where(eq(issueIntegration.id, i.id));
    return c.json(result);
  })

  /** Secret + URL to paste into the repository's webhook settings. */
  .get("/integrations/:id/webhook-secret", requireOrgAdmin, async (c) => {
    const i = await ownIntegration(c.var.orgId, c.req.param("id"));
    let secret: string;
    try {
      secret = decryptSecret(i.webhookSecret);
    } catch {
      throw new ApiError(409, "SECRET_UNREADABLE", "The secret can't be decrypted — rotate it");
    }
    return c.json({ secret, url: webhookUrlFor(i.provider) });
  })

  .post("/integrations/:id/rotate-webhook-secret", requireOrgAdmin, async (c) => {
    const i = await ownIntegration(c.var.orgId, c.req.param("id"));
    const secret = `whsec_${randomToken(24)}`;
    await getDb()
      .update(issueIntegration)
      .set({ webhookSecret: encryptSecret(secret) })
      .where(eq(issueIntegration.id, i.id));
    return c.json({ secret, url: webhookUrlFor(i.provider) });
  })

  /** "Send to GitHub/GitLab": creates the issue now (or returns the existing one). */
  .post("/feedback/:id/issues", zValidator("json", issueCreate), async (c) => {
    const link = await sendToTracker(c.var.orgId, c.req.param("id"), c.req.valid("json").integrationId);
    return c.json(
      {
        issue: {
          id: link.id,
          integrationId: link.integrationId,
          provider: link.provider,
          number: link.number,
          url: link.url,
          state: link.state,
        },
      },
      201,
    );
  });
