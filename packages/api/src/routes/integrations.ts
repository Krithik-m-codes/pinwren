import { withOrg } from "@pinwren/db";
import {
  cleanTrackerSettings,
  isBoardProvider,
  type IssueProvider,
  issueCreate,
  issueIntegrationCreate,
  issueIntegrationUpdate,
  normalizeTrackerRepo,
  trackerRepoError,
  trackerSettingsError,
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
  splitTrelloCredential,
  trackerConfig,
  trelloCredential,
  webhookUrlFor,
} from "../integrations/issues";
import { assertFeatureWritable, hasFeature } from "../license";
import { adapterFor, checkAccess, TrackerError } from "../integrations/trackers";
import { safeFetch } from "../outbound/safe-fetch";

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

/** The Trello API key (stored with the token); null for other providers or an unreadable value. */
function trelloKey(i: Integration): string | null {
  if (i.provider !== "trello") return null;
  try {
    return splitTrelloCredential(decryptSecret(i.token)).apiKey || null;
  } catch {
    return null;
  }
}

/** Providers whose signing secret the admin pastes (Linear shows one; Trello's is the Power-Up's app secret). */
const PASTED_SECRET: readonly IssueProvider[] = ["linear", "trello"];
/** Providers that wait for their signing secret after connecting (Asana, Notion: handed over; Trello: pasted). */
const AWAITS_SECRET: readonly IssueProvider[] = ["trello", "asana", "notion"];

/** Tokens and secrets never leave the server; the last 4 characters identify the token. */
export const integrationOut = (i: Integration) => ({
  id: i.id,
  projectId: i.projectId,
  provider: i.provider,
  repo: i.repo,
  apiUrl: i.apiUrl,
  email: jiraEmail(i),
  /** Trello's API key identifies the Power-Up and is not a secret on its own. */
  apiKey: trelloKey(i),
  labels: i.labels,
  autoCreate: i.autoCreate,
  active: i.active,
  tokenHint: i.tokenHint,
  lastError: i.lastError,
  /** Board trackers: target list / status / priority mapping. */
  settings: i.settings,
  webhookUrl: webhookUrlFor(i.provider, i.id),
  /** Pinwren registered a webhook at the tracker (Trello, Asana, ClickUp). */
  webhookRegistered: i.webhookRef !== null,
  /** Connected, but the signing secret hasn't arrived (Asana, Notion) or been pasted (Trello) yet. */
  webhookPending: i.webhookPending,
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

/** Best effort: take the webhook Pinwren registered out of the tracker. A failure never blocks the caller. */
async function unregisterWebhook(i: Integration): Promise<void> {
  const hooks = adapterFor(i.provider).webhooks;
  if (!i.webhookRef || !hooks?.unregister) return;
  try {
    await hooks.unregister(trackerConfig(i), i.webhookRef, safeFetch);
  } catch {
    // The token may be revoked already; the stale webhook will fail its signature and be ignored.
  }
}

/**
 * Issue sync with GitHub / GitLab / Linear / Jira / Trello / Asana / ClickUp / Notion (F-076–F-079, ADR 0035).
 * Configuring is for workspace Admins (`integrations.manage`); sending an item is for Admins and Editors
 * (`feedback.update`).
 */
export const integrations = new Hono<{ Variables: SessionVars }>()
  .get("/projects/:id/integrations", requireOrgAdmin, async (c) => {
    const db = getDb();
    const [p] = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, c.req.param("id")), eq(project.orgId, c.var.orgId)));
    if (!p) throw notFound("Project");
    const rows = await db
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
      // Linear and Trello are signed with a secret the admin pastes; the rest get ours, or the tracker's own.
      if (body.webhookSecret !== undefined && !PASTED_SECRET.includes(body.provider)) {
        throw badRequest("This tracker provides its own signing secret");
      }
      const secret = body.webhookSecret ?? `whsec_${randomToken(24)}`;
      const stored =
        body.provider === "jira"
          ? jiraCredential(body.email ?? "", body.token)
          : body.provider === "trello"
            ? trelloCredential(body.apiKey ?? "", body.token)
            : body.token;
      const board = isBoardProvider(body.provider);
      const [i] = await db
        .insert(issueIntegration)
        .values({
          orgId: c.var.orgId,
          projectId: p.id,
          provider: body.provider,
          token: encryptSecret(stored),
          tokenHint: hint(body.token),
          repo: normalizeTrackerRepo(body.provider, body.repo),
          apiUrl: board || body.provider === "linear" ? null : (body.apiUrl ?? null),
          labels: [...new Set(body.labels)],
          autoCreate: body.autoCreate,
          webhookSecret: encryptSecret(secret),
          webhookPending:
            AWAITS_SECRET.includes(body.provider) && !(body.provider === "trello" && body.webhookSecret),
          settings: board ? cleanTrackerSettings(body.settings) : {},
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
    if (body.apiKey !== undefined && provider !== "trello") throw badRequest("Only Trello takes an API key");
    if (
      body.apiUrl !== undefined &&
      body.apiUrl !== null &&
      !["github", "gitlab", "jira"].includes(provider)
    ) {
      throw badRequest("This tracker has no self-hosted URL");
    }
    if (body.apiUrl === null && provider === "jira") throw badRequest("Jira needs the site URL");
    if (body.webhookSecret !== undefined && !PASTED_SECRET.includes(provider)) {
      throw badRequest("This tracker provides its own signing secret");
    }
    let settings: Record<string, string> | undefined;
    if (body.settings !== undefined) {
      settings = cleanTrackerSettings(body.settings);
      const settingsError = trackerSettingsError(provider, settings);
      if (settingsError) throw badRequest(settingsError);
    }
    const set: Partial<typeof issueIntegration.$inferInsert> = {};
    const pair = provider === "jira" ? "email" : provider === "trello" ? "apiKey" : null;
    if (pair && (body.token !== undefined || body[pair] !== undefined)) {
      // Jira keeps `email:token`, Trello `apiKey:token`: changing either half re-seals both.
      let prev: { half: string; token: string };
      try {
        const stored = decryptSecret(current.token);
        const c2 = splitJiraCredential(stored);
        prev = { half: c2.email, token: c2.token };
      } catch {
        if (body.token === undefined || body[pair] === undefined) {
          throw new ApiError(
            409,
            "SECRET_UNREADABLE",
            `The stored token can't be decrypted — enter the ${pair === "email" ? "email" : "API key"} and token again`,
          );
        }
        prev = { half: "", token: "" };
      }
      const token = body.token ?? prev.token;
      const half = body[pair] ?? prev.half;
      set.token = encryptSecret(
        pair === "email" ? jiraCredential(half, token) : trelloCredential(half, token),
      );
      set.tokenHint = hint(token);
      set.lastError = null;
    } else if (body.token !== undefined) {
      set.token = encryptSecret(body.token);
      set.tokenHint = hint(body.token);
      set.lastError = null;
    }
    if (body.repo !== undefined) set.repo = normalizeTrackerRepo(provider, body.repo);
    if (body.apiUrl !== undefined) set.apiUrl = body.apiUrl;
    if (body.webhookSecret !== undefined) {
      set.webhookSecret = encryptSecret(body.webhookSecret);
      set.webhookPending = false;
    }
    if (settings !== undefined) set.settings = settings;
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
    await unregisterWebhook(i);
    await getDb().delete(issueIntegration).where(eq(issueIntegration.id, i.id));
    return c.body(null, 204);
  })

  /** Can the token see the repository / board / list / database? Always 200; `{ ok, message }`. */
  .post("/integrations/:id/test", requireOrgAdmin, async (c) => {
    const i = await withOrg(c.var.orgId, () => ownIntegration(c.var.orgId, c.req.param("id")));
    let result: Awaited<ReturnType<typeof checkAccess>>;
    try {
      result = await checkAccess(trackerConfig(i));
    } catch (err) {
      result = { ok: false, message: err instanceof TrackerError ? err.message : "failed" };
    }
    await withOrg(c.var.orgId, (db) =>
      db
        .update(issueIntegration)
        .set({
          lastError: result.ok ? null : result.message.slice(0, 300),
          // Trello resolves a board's short link to the long id its webhooks carry.
          ...(result.ok && result.repo && result.repo !== i.repo ? { repo: result.repo } : {}),
        })
        .where(eq(issueIntegration.id, i.id)),
    );
    return c.json(result);
  })

  /**
   * Register the webhook at the tracker (Trello, Asana, ClickUp), replacing a previous one. Notion has no API
   * for it: the admin adds the URL in the integration's settings and Pinwren captures the verification token.
   */
  .post("/integrations/:id/register-webhook", requireOrgAdmin, async (c) => {
    const i = await ownIntegration(c.var.orgId, c.req.param("id"));
    const hooks = adapterFor(i.provider).webhooks;
    if (!hooks?.register) {
      throw badRequest(`${adapterFor(i.provider).name} webhooks are added by hand — see the setup steps`);
    }
    if (i.provider === "trello" && i.webhookPending) {
      throw badRequest("Paste the Power-Up's app secret first: Trello signs every delivery with it");
    }
    const url = webhookUrlFor(i.provider, i.id);
    try {
      const cfg = trackerConfig(i);
      await unregisterWebhook(i);
      // Asana hands the secret over while this call is open: let the route accept that handshake.
      if (i.provider === "asana") {
        await getDb()
          .update(issueIntegration)
          .set({ webhookPending: true })
          .where(eq(issueIntegration.id, i.id));
      }
      const r = await hooks.register(cfg, url, safeFetch);
      await getDb()
        .update(issueIntegration)
        .set({
          webhookRef: r.ref,
          lastError: null,
          ...(r.secret ? { webhookSecret: encryptSecret(r.secret), webhookPending: false } : {}),
        })
        .where(eq(issueIntegration.id, i.id));
    } catch (err) {
      const message = err instanceof TrackerError ? err.message : "failed";
      await getDb()
        .update(issueIntegration)
        .set({ lastError: message.slice(0, 300) })
        .where(eq(issueIntegration.id, i.id));
      throw new ApiError(502, "TRACKER_ERROR", `${adapterFor(i.provider).name}: ${message}`);
    }
    const after = await ownIntegration(c.var.orgId, i.id);
    if (i.provider === "asana" && after.webhookPending) {
      throw new ApiError(
        502,
        "TRACKER_ERROR",
        "Asana did not complete the webhook handshake — check PINWREN_URL",
      );
    }
    return c.json({ integration: integrationOut(after) });
  })

  /**
   * Secret + URL to paste into the tracker's webhook settings. Of the board trackers only Notion's secret is
   * shown (once it has arrived): Notion asks the admin to type its own verification token back. The others'
   * secrets are the tracker's, or the admin's, and are never needed again.
   */
  .get("/integrations/:id/webhook-secret", requireOrgAdmin, async (c) => {
    const i = await ownIntegration(c.var.orgId, c.req.param("id"));
    if (isBoardProvider(i.provider) && (i.provider !== "notion" || i.webhookPending)) {
      return c.json({ secret: null, url: webhookUrlFor(i.provider, i.id), pending: i.webhookPending });
    }
    let secret: string;
    try {
      secret = decryptSecret(i.webhookSecret);
    } catch {
      throw new ApiError(409, "SECRET_UNREADABLE", "The secret can't be decrypted — rotate it");
    }
    return c.json({ secret, url: webhookUrlFor(i.provider, i.id), pending: false });
  })

  .post("/integrations/:id/rotate-webhook-secret", requireOrgAdmin, async (c) => {
    const i = await ownIntegration(c.var.orgId, c.req.param("id"));
    if (isBoardProvider(i.provider) && i.provider !== "notion") {
      // Asana / ClickUp / Trello hand over or are given their secret: registering the webhook again replaces it.
      throw new ApiError(
        409,
        "NOT_ROTATABLE",
        i.provider === "trello"
          ? "Trello is signed with the Power-Up's app secret: paste a new one instead"
          : "Register the webhook again to get a new secret",
      );
    }
    const secret = `whsec_${randomToken(24)}`;
    await getDb()
      .update(issueIntegration)
      // Notion: wait for the next verification token (Notion › Webhooks › Resend).
      .set({
        webhookSecret: encryptSecret(secret),
        ...(i.provider === "notion" ? { webhookPending: true } : {}),
      })
      .where(eq(issueIntegration.id, i.id));
    return c.json({
      secret: i.provider === "notion" ? null : secret,
      url: webhookUrlFor(i.provider, i.id),
      pending: i.provider === "notion",
    });
  })

  /** "Send to GitHub/GitLab/Linear/Jira/Trello/Asana/ClickUp/Notion": creates the item now (or returns the existing one). */
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
            externalId: link.externalId,
            url: link.url,
            state: link.state,
          },
        },
        201,
      );
    },
  );
