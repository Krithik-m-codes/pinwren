import {
  type IssueProvider,
  issueCreate,
  issueIntegrationCreate,
  issueIntegrationUpdate,
  normalizeTrackerRepo,
  trackerRepoError,
} from "@pinwren/core";
import { getDb, issueIntegration, project } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { requireOrgAdmin, type SessionVars } from "../context";
import { requirePermission } from "../permissions";
import { decryptSecret, encryptSecret, randomToken } from "../crypto";
import { ApiError, notFound } from "../errors";
import {
  jiraCredential,
  sendToTracker,
  splitJiraCredential,
  trackerConfig,
  webhookUrlFor,
} from "../integrations/issues";
import { assertFeatureWritable, hasFeature } from "../license";
import { checkAccess, TrackerError } from "../integrations/trackers";

type Integration = typeof issueIntegration.$inferSelect;

/** The Jira account email (stored with the API token); null for other providers or an unreadable value. */
function jiraEmail(i: Integration): string | null {
  if (i.provider !== "jira") return null;
  try {
    return splitJiraCredential(decryptSecret(i.token)).email || null;
  } catch {
    return null;
  }
}

/** Tokens and secrets never leave the server; the last 4 characters identify the token. */
export const integrationOut = (i: Integration) => ({
  id: i.id,
  projectId: i.projectId,
  provider: i.provider,
  repo: i.repo,
  apiUrl: i.apiUrl,
  email: jiraEmail(i),
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

const badRequest = (message: string) => new ApiError(400, "VALIDATION_ERROR", message);

/**
 * Jira is an Enterprise feature (blueprint 07): adding or changing one needs the licence feature, and after
 * the grace period the settings are read-only (ADR 0019). Other providers are Community.
 */
async function assertProviderWritable(provider: IssueProvider) {
  if (provider !== "jira") return;
  if (!(await hasFeature("jira"))) {
    throw new ApiError(
      403,
      "LICENSE_REQUIRED",
      "Jira is an Enterprise feature: install a licence with it (Settings › Licence)",
    );
  }
  await assertFeatureWritable("jira");
}

async function ownIntegration(orgId: string, id: string): Promise<Integration> {
  const [i] = await getDb()
    .select()
    .from(issueIntegration)
    .where(and(eq(issueIntegration.id, id), eq(issueIntegration.orgId, orgId)));
  if (!i) throw notFound("Integration");
  return i;
}

/**
 * GitHub / GitLab / Linear / Jira issue sync (F-076–F-079). Configuring is for workspace Admins
 * (`integrations.manage`); sending an item is for Admins and Editors (`feedback.update`).
 */
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
      await assertProviderWritable(body.provider);
      // Linear generates its own signing secret; the admin pastes it (now or later). Others get ours.
      const secret = body.webhookSecret ?? `whsec_${randomToken(24)}`;
      const stored = body.provider === "jira" ? jiraCredential(body.email ?? "", body.token) : body.token;
      const [i] = await db
        .insert(issueIntegration)
        .values({
          orgId: c.var.orgId,
          projectId: p.id,
          provider: body.provider,
          token: encryptSecret(stored),
          tokenHint: hint(body.token),
          repo: normalizeTrackerRepo(body.provider, body.repo),
          apiUrl: body.provider === "linear" ? null : (body.apiUrl ?? null),
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
    const provider = current.provider;
    // Pausing an unlicensed Jira integration is always allowed; anything else needs the licence.
    const onlyPausing = Object.keys(body).every((k) => k === "active") && body.active === false;
    if (!onlyPausing) await assertProviderWritable(provider);
    if (body.repo !== undefined) {
      const repoError = trackerRepoError(provider, body.repo);
      if (repoError) throw badRequest(repoError);
    }
    if (body.email !== undefined && provider !== "jira") throw badRequest("Only Jira takes an account email");
    if (body.apiUrl !== undefined && provider === "linear" && body.apiUrl !== null) {
      throw badRequest("Linear has no self-hosted URL");
    }
    if (body.apiUrl === null && provider === "jira") throw badRequest("Jira needs the site URL");
    const set: Partial<typeof issueIntegration.$inferInsert> = {};
    if (provider === "jira" && (body.token !== undefined || body.email !== undefined)) {
      let prev: { email: string; token: string };
      try {
        prev = splitJiraCredential(decryptSecret(current.token));
      } catch {
        if (body.token === undefined || body.email === undefined) {
          throw new ApiError(
            409,
            "SECRET_UNREADABLE",
            "The stored token can't be decrypted — enter the email and token again",
          );
        }
        prev = { email: "", token: "" };
      }
      const token = body.token ?? prev.token;
      set.token = encryptSecret(jiraCredential(body.email ?? prev.email, token));
      set.tokenHint = hint(token);
      set.lastError = null;
    } else if (body.token !== undefined) {
      set.token = encryptSecret(body.token);
      set.tokenHint = hint(body.token);
      set.lastError = null;
    }
    if (body.repo !== undefined) set.repo = normalizeTrackerRepo(provider, body.repo);
    if (body.apiUrl !== undefined) set.apiUrl = body.apiUrl;
    if (body.webhookSecret !== undefined) set.webhookSecret = encryptSecret(body.webhookSecret);
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

  /** "Send to GitHub/GitLab/Linear/Jira": creates the issue now (or returns the existing one). */
  .post(
    "/feedback/:id/issues",
    requirePermission("feedback.update"),
    zValidator("json", issueCreate),
    async (c) => {
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
    },
  );
