import { CLOSED_STATUSES, type FeedbackStatus, isClosedStatus, kindLabel } from "@pinwren/core";
import { activity, feedback, getDb, issueIntegration, issueLink } from "@pinwren/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { decryptSecret } from "../crypto";
import { env } from "../env";
import { ApiError, notFound } from "../errors";
import { emit } from "../events";
import { enqueue, QUEUES } from "../jobs/boss";
import { emailBrand } from "../services/branding";
import { type FeedbackContext, feedbackLink, loadFeedbackContext } from "../services/feedback-payload";
import { hasFeature } from "../license";
import {
  adfText,
  createIssue,
  mdEscape,
  PROVIDER_NAMES,
  setIssueState,
  type TrackerConfig,
  TrackerError,
} from "./trackers";

// Issue sync (F-076 GitHub, F-077 GitLab, F-078 Linear, F-079 Jira Cloud). Creating an issue and pushing a
// state change are jobs (retried with backoff) — a tracker outage never blocks ingest or triage. The
// inbound side lives in `routes/inbound.ts`. Jira is an Enterprise feature (blueprint 07): without the
// `jira` licence feature a Jira integration can't be added and an existing one does nothing.

type Integration = typeof issueIntegration.$inferSelect;
type Link = typeof issueLink.$inferSelect;

export type IssueJob =
  | { type: "create"; feedbackId: string; integrationId: string }
  | { type: "state"; linkId: string; state: "open" | "closed" };

export { PROVIDER_NAMES };

/** Jira stores `email:apiToken` in one encrypted value (the email can't hold a colon here; tokens never do). */
export const jiraCredential = (email: string, token: string) => `${email}:${token}`;

export function splitJiraCredential(stored: string): { email: string; token: string } {
  const at = stored.lastIndexOf(":");
  return at < 0 ? { email: "", token: stored } : { email: stored.slice(0, at), token: stored.slice(at + 1) };
}

export function trackerConfig(i: Integration): TrackerConfig {
  let token: string;
  try {
    token = decryptSecret(i.token);
  } catch {
    throw new TrackerError(
      "The stored token can't be decrypted (PINWREN_SECRET changed?) — enter it again",
      null,
    );
  }
  if (i.provider === "jira") {
    const c = splitJiraCredential(token);
    return { provider: i.provider, token: c.token, email: c.email, repo: i.repo, apiUrl: i.apiUrl };
  }
  return { provider: i.provider, token, repo: i.repo, apiUrl: i.apiUrl };
}

/** Jira without the licence feature: kept configured, but inert (ADR 0019). */
export async function providerLicensed(provider: Integration["provider"]): Promise<boolean> {
  return provider !== "jira" || (await hasFeature("jira"));
}

export const webhookUrlFor = (provider: Integration["provider"]) =>
  `${env().PINWREN_URL.replace(/\/$/, "")}/api/integrations/${provider}/webhook`;

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function issueTitle(f: { number: number; title: string | null; body: string }): string {
  const what = f.title?.trim() || f.body.replace(/\s+/g, " ").trim();
  // Titles are plain text on both trackers; only length and line breaks matter.
  return truncate(`#${f.number} ${what}`.replace(/[\r\n]+/g, " "), 250);
}

export type IssueBodyInput = {
  number: number;
  kind: string;
  projectName: string;
  body: string;
  pageUrl: string | null;
  reporterName: string | null;
  environment: { browser?: string; os?: string; viewport?: { w: number; h: number } } | null;
  link: string;
  productName: string;
};

/** The facts every issue lists, unescaped (each format escapes them its own way). */
function issueFacts(f: IssueBodyInput): [string, string][] {
  const e = f.environment;
  return [
    ["Project", f.projectName],
    ["Kind", kindLabel(f.kind)],
    ["Page", f.pageUrl ? truncate(f.pageUrl, 500) : "—"],
    ["Browser", [e?.browser, e?.os].filter(Boolean).join(" · ") || "—"],
    ["Viewport", e?.viewport ? `${Math.round(e.viewport.w)} × ${Math.round(e.viewport.h)}` : "—"],
    ["Reporter", f.reporterName ? truncate(f.reporterName, 120) : "anonymous visitor"],
  ];
}

/**
 * Issue body: the reporter's text quoted and escaped, the environment, and a link to the item in the
 * dashboard. Screenshots and diagnostics stay behind the dashboard's sign-in — no public or signed
 * asset URL is ever put in an issue. GitHub and GitLab get a table; Linear (no HTML) a list.
 */
export function issueBody(f: IssueBodyInput, flavor: "github" | "linear" = "github"): string {
  const quoted = truncate(f.body, 6000)
    .split(/\r?\n/)
    .map((l) => `> ${mdEscape(l)}`)
    .join("\n");
  const facts = issueFacts(f).map(([k, v]): [string, string] => [k, k === "Viewport" ? v : mdEscape(v)]);
  const product = mdEscape(f.productName);
  const open = `**[Open #${f.number} in ${product}](${f.link})** — screenshot, console and network details are there (sign-in required).`;
  if (flavor === "linear") {
    return [
      quoted,
      "",
      ...facts.map(([k, v]) => `- **${k}:** ${v}`),
      "",
      open,
      "",
      `_Created by ${product}. Completing or reopening this issue updates the item._`,
    ].join("\n");
  }
  return [
    quoted,
    "",
    "| | |",
    "|---|---|",
    ...facts.map(([k, v]) => `| **${k}** | ${v} |`),
    "",
    open,
    "",
    `<sub>Created by ${product}. Closing or reopening this issue updates the item.</sub>`,
  ].join("\n");
}

const adfPara = (...content: object[]) => ({ type: "paragraph", content });
const adfStr = (text: string, marks?: object[]) => ({ type: "text", text, ...(marks ? { marks } : {}) });

/**
 * The same issue as an Atlassian Document Format document for Jira. ADF text nodes are never parsed as
 * markup, so the reporter's text needs no escaping; links exist only where we add a link mark.
 */
export function issueAdf(f: IssueBodyInput): object {
  const quote = adfText(truncate(f.body, 6000)) as { content: object[] };
  return {
    type: "doc",
    version: 1,
    content: [
      { type: "blockquote", content: quote.content },
      {
        type: "bulletList",
        content: issueFacts(f).map(([k, v]) => ({
          type: "listItem",
          content: [adfPara(adfStr(`${k}: `, [{ type: "strong" }]), adfStr(v))],
        })),
      },
      adfPara(
        adfStr(`Open #${f.number} in ${f.productName}`, [
          { type: "strong" },
          { type: "link", attrs: { href: f.link } },
        ]),
        adfStr(" — screenshot, console and network details are there (sign-in required)."),
      ),
      adfPara(
        adfStr(
          `Created by ${f.productName}. Moving this issue to Done or back reopens or resolves the item.`,
          [{ type: "em" }],
        ),
      ),
    ],
  };
}

async function integrationFor(id: string): Promise<Integration | null> {
  const [i] = await getDb().select().from(issueIntegration).where(eq(issueIntegration.id, id));
  return i ?? null;
}

async function recordError(i: Integration, err: unknown) {
  const message = err instanceof Error ? err.message.slice(0, 300) : "failed";
  await getDb()
    .update(issueIntegration)
    .set({ lastError: message })
    .where(eq(issueIntegration.id, i.id))
    .catch(() => {
      // Best effort: the job's own failure (and retry) is what matters.
    });
}

/**
 * Create the issue for one feedback item (idempotent: an existing link is returned). Throws
 * `TrackerError` on tracker failures so the job retries and the "Send to …" button can say why.
 */
export async function createIssueFor(feedbackId: string, integrationId: string): Promise<Link> {
  const db = getDb();
  const i = await integrationFor(integrationId);
  if (!i) throw notFound("Integration");
  const [existing] = await db
    .select()
    .from(issueLink)
    .where(and(eq(issueLink.feedbackId, feedbackId), eq(issueLink.integrationId, i.id)));
  if (existing) return existing;
  const ctx = await loadFeedbackContext(feedbackId);
  if (ctx?.payload.projectId !== i.projectId) throw notFound("Feedback");
  const [row] = await db
    .select({ environment: feedback.environment, status: feedback.status })
    .from(feedback)
    .where(eq(feedback.id, feedbackId));
  if (!(await providerLicensed(i.provider))) {
    throw new TrackerError(
      "Jira is an Enterprise feature: install a licence with it (Settings › Licence)",
      null,
    );
  }
  const brand = await emailBrand(i.orgId);
  const f = ctx.payload;
  const input: IssueBodyInput = {
    number: f.number,
    kind: f.kind,
    projectName: f.projectName,
    body: f.body,
    pageUrl: f.pageUrl,
    reporterName: f.reporterName,
    environment: row?.environment ?? null,
    link: feedbackLink(ctx.orgId, f.id),
    productName: brand.productName,
  };
  let ref: Awaited<ReturnType<typeof createIssue>>;
  try {
    ref = await createIssue(trackerConfig(i), {
      title: issueTitle(f),
      body: issueBody(input, i.provider === "linear" ? "linear" : "github"),
      labels: i.labels,
      kind: f.kind,
      ...(i.provider === "jira" ? { adf: issueAdf(input) } : {}),
    });
  } catch (err) {
    await recordError(i, err);
    throw err;
  }
  const [link] = await db
    .insert(issueLink)
    .values({
      orgId: i.orgId,
      feedbackId,
      integrationId: i.id,
      provider: i.provider,
      number: ref.number,
      url: ref.url,
      state: "open",
    })
    .onConflictDoNothing({ target: [issueLink.feedbackId, issueLink.integrationId] })
    .returning();
  if (i.lastError) {
    await db.update(issueIntegration).set({ lastError: null }).where(eq(issueIntegration.id, i.id));
  }
  if (!link) {
    // A concurrent create won the race; keep theirs.
    const [other] = await db
      .select()
      .from(issueLink)
      .where(and(eq(issueLink.feedbackId, feedbackId), eq(issueLink.integrationId, i.id)));
    if (!other) throw new Error("issue link vanished");
    return other;
  }
  await db.insert(activity).values({
    orgId: i.orgId,
    feedbackId,
    actorKind: "integration",
    type: "issue_linked",
    data: {
      provider: i.provider,
      number: ref.number,
      url: ref.url,
      via: i.provider,
      ...(ref.key ? { key: ref.key } : {}),
    },
  });
  // Already closed in Pinwren (e.g. sent after resolving): close the new issue too.
  if (row && isClosedStatus(row.status)) {
    await enqueue(QUEUES.issues, { type: "state", linkId: link.id, state: "closed" } satisfies IssueJob);
  }
  return link;
}

/** On `feedback.created`: queue issue creation for integrations set to auto-create. */
export async function autoCreateIssues(ctx: FeedbackContext): Promise<void> {
  const rows = await getDb()
    .select({
      id: issueIntegration.id,
      autoCreate: issueIntegration.autoCreate,
      provider: issueIntegration.provider,
    })
    .from(issueIntegration)
    .where(and(eq(issueIntegration.projectId, ctx.payload.projectId), eq(issueIntegration.active, true)));
  for (const r of rows) {
    if (!(await providerLicensed(r.provider))) continue;
    if (r.autoCreate === "all" || (r.autoCreate === "bugs" && ctx.payload.kind === "bug")) {
      await enqueue(QUEUES.issues, {
        type: "create",
        feedbackId: ctx.payload.id,
        integrationId: r.id,
      } satisfies IssueJob);
    }
  }
}

/** On an Pinwren status change: close or reopen linked issues whose state differs. */
export async function syncIssueState(feedbackId: string, status: string): Promise<void> {
  const want = isClosedStatus(status as FeedbackStatus) ? "closed" : "open";
  const links = await getDb()
    .select({ id: issueLink.id, state: issueLink.state })
    .from(issueLink)
    .innerJoin(issueIntegration, eq(issueIntegration.id, issueLink.integrationId))
    .where(and(eq(issueLink.feedbackId, feedbackId), eq(issueIntegration.active, true)));
  for (const l of links) {
    if (l.state !== want) {
      await enqueue(QUEUES.issues, { type: "state", linkId: l.id, state: want } satisfies IssueJob);
    }
  }
}

/** `issues.sync` handler. Throws on tracker errors so pg-boss retries with backoff. */
export async function runIssueJob(job: IssueJob): Promise<void> {
  if (job.type === "create") {
    const i = await integrationFor(job.integrationId);
    if (!i?.active || !(await providerLicensed(i.provider))) return;
    await createIssueFor(job.feedbackId, job.integrationId);
    return;
  }
  const db = getDb();
  const [row] = await db
    .select({ l: issueLink, i: issueIntegration })
    .from(issueLink)
    .innerJoin(issueIntegration, eq(issueIntegration.id, issueLink.integrationId))
    .where(eq(issueLink.id, job.linkId));
  if (!row?.i.active || row.l.state === job.state || !(await providerLicensed(row.i.provider))) return;
  try {
    await setIssueState(trackerConfig(row.i), row.l.number, job.state);
  } catch (err) {
    await recordError(row.i, err);
    throw err;
  }
  await db.update(issueLink).set({ state: job.state }).where(eq(issueLink.id, row.l.id));
}

/**
 * Inbound (tracker → Pinwren): the issue was closed or reopened. Closing resolves an open item;
 * reopening reopens a closed one. Written as the integration (no user), and the resulting event is
 * not pushed back to the tracker.
 */
export async function applyInboundState(
  i: Integration,
  number: number,
  state: "open" | "closed",
): Promise<{ feedbackId: string; status: string } | null> {
  const db = getDb();
  const [link] = await db
    .select()
    .from(issueLink)
    .where(and(eq(issueLink.integrationId, i.id), eq(issueLink.number, number)));
  if (!link) return null;
  await db.update(issueLink).set({ state }).where(eq(issueLink.id, link.id));
  const [f] = await db
    .select({ id: feedback.id, status: feedback.status, orgId: feedback.orgId })
    .from(feedback)
    .where(and(eq(feedback.id, link.feedbackId), isNull(feedback.deletedAt)));
  if (!f) return null;
  const closed = (CLOSED_STATUSES as readonly string[]).includes(f.status);
  const to: FeedbackStatus | null =
    state === "closed" && !closed ? "resolved" : state === "open" && closed ? "open" : null;
  if (!to) return { feedbackId: f.id, status: f.status };
  const rows = await db.execute<{ id: string }>(sql`
    with u as (
      update ${feedback} set status = ${to}::feedback_status,
        resolved_at = ${to === "resolved" ? sql`now()` : sql`null`}, updated_at = now()
      where id = ${f.id} and status = ${f.status}::feedback_status
      returning id
    ), act as (
      insert into ${activity} (org_id, feedback_id, actor_kind, type, data)
      select ${f.orgId}, u.id, 'integration', 'status_changed',
        ${JSON.stringify({ from: f.status, to, via: i.provider, issue: number })}::jsonb
      from u
    )
    select id from u
  `);
  if (!rows[0]) return { feedbackId: f.id, status: f.status };
  const base = { orgId: f.orgId, feedbackId: f.id, actor: { kind: "integration" as const, id: null } };
  const changes = { status: { from: f.status, to } };
  emit({ ...base, type: "feedback.updated", changes }, { ...base, type: "feedback.status_changed", changes });
  return { feedbackId: f.id, status: to };
}

/** Synchronous "Send to GitHub/GitLab/Linear/Jira" from the dashboard. */
export async function sendToTracker(orgId: string, feedbackId: string, integrationId: string): Promise<Link> {
  const db = getDb();
  const [i] = await db
    .select()
    .from(issueIntegration)
    .where(and(eq(issueIntegration.id, integrationId), eq(issueIntegration.orgId, orgId)));
  if (!i) throw notFound("Integration");
  const [f] = await db
    .select({ id: feedback.id })
    .from(feedback)
    .where(
      and(
        eq(feedback.id, feedbackId),
        eq(feedback.orgId, orgId),
        eq(feedback.projectId, i.projectId),
        isNull(feedback.deletedAt),
      ),
    );
  if (!f) throw notFound("Feedback");
  if (!i.active) throw new ApiError(409, "INTEGRATION_DISABLED", "This integration is switched off");
  if (!(await providerLicensed(i.provider))) {
    throw new ApiError(403, "LICENSE_REQUIRED", "Jira is an Enterprise feature: install a licence with it");
  }
  try {
    return await createIssueFor(feedbackId, integrationId);
  } catch (err) {
    if (err instanceof TrackerError) {
      throw new ApiError(502, "TRACKER_ERROR", `${PROVIDER_NAMES[i.provider]}: ${err.message}`);
    }
    throw err;
  }
}
