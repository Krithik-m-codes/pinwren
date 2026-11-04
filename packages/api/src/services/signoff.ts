import { signoffState, trimTrailingSlashes, type SignoffOut, type SignoffState } from "@pinwren/core";
import { getDb, project, roundSignoff, webhookEndpoint } from "@pinwren/db";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { renderEmail } from "../email/render";
import { env } from "../env";
import { membersWanting, notify, teamRenderOptions } from "../jobs/notify";
import { queueDelivery } from "../webhooks/deliver";
import { WEBHOOK_API_VERSION, type WebhookPayload } from "../webhooks/format";

// Client sign-off on a review round: a guest with a round share link answers "Approve" or "Request changes".
// The newest answer is the round's sign-off state. A round can be made to require an approval before it closes.

type Row = typeof roundSignoff.$inferSelect;

export const DECISION_LABEL: Record<Row["decision"], string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
};

export const signoffOut = (r: Row): SignoffOut => ({
  id: r.id,
  decision: r.decision,
  name: r.name,
  email: r.email,
  note: r.note,
  createdAt: r.createdAt.toISOString(),
});

/** Newest first. */
export async function listSignoffs(orgId: string, roundId: string, limit = 50): Promise<Row[]> {
  return getDb()
    .select()
    .from(roundSignoff)
    .where(and(eq(roundSignoff.orgId, orgId), eq(roundSignoff.roundId, roundId)))
    .orderBy(desc(roundSignoff.createdAt))
    .limit(limit);
}

export async function currentSignoffState(orgId: string, roundId: string): Promise<SignoffState> {
  const [latest] = await listSignoffs(orgId, roundId, 1);
  return signoffState(latest);
}

export const roundDashboardUrl = (projectId: string) =>
  `${trimTrailingSlashes(env().PINWREN_URL)}/projects/${projectId}/rounds`;

type RoundCtx = { id: string; name: string; projectId: string; orgId: string };

/**
 * Tell the project's team: a bell entry and email for members who want status changes, and the
 * `round.signoff` webhook for endpoints subscribed to it. Failures here are logged, never thrown: the
 * client's answer is already saved and must not fail because a mail server is down.
 */
export async function announceSignoff(round: RoundCtx, entry: Row, linkLabel: string | null): Promise<void> {
  try {
    const [p] = await getDb()
      .select({ name: project.name })
      .from(project)
      .where(and(eq(project.id, round.projectId), eq(project.orgId, round.orgId)));
    const projectName = p?.name ?? "";
    const decision = DECISION_LABEL[entry.decision];
    const link = roundDashboardUrl(round.projectId);
    const recipients = await membersWanting(round.orgId, round.projectId, "statusChanges");
    await notify({
      orgId: round.orgId,
      eventId: `round.signoff:${entry.id}`,
      type: "round.signoff",
      feedbackId: null,
      actorId: null,
      projectId: round.projectId,
      recipients,
      data: {
        roundId: round.id,
        roundName: round.name,
        projectId: round.projectId,
        projectName,
        decision: entry.decision,
        reviewerName: entry.name,
      },
      render: () =>
        renderEmail(
          round.orgId,
          "round_signoff",
          {
            projectName,
            roundName: round.name,
            decision,
            reviewerName: entry.name,
            reviewerEmail: entry.email,
            note: entry.note || "-",
            link,
          },
          teamRenderOptions(),
        ),
    });
    await signoffWebhooks(round, projectName, entry, link, linkLabel);
  } catch (err) {
    console.warn("[pinwren] round sign-off announcement failed", err);
  }
}

async function signoffWebhooks(
  round: RoundCtx,
  projectName: string,
  entry: Row,
  link: string,
  linkLabel: string | null,
): Promise<void> {
  const endpoints = await getDb()
    .select()
    .from(webhookEndpoint)
    .where(
      and(
        eq(webhookEndpoint.orgId, round.orgId),
        eq(webhookEndpoint.active, true),
        sql`'round.signoff' = any(${webhookEndpoint.events})`,
        or(isNull(webhookEndpoint.projectId), eq(webhookEndpoint.projectId, round.projectId)),
      ),
    );
  if (!endpoints.length) return;
  const at = entry.createdAt.toISOString();
  const payload: WebhookPayload = {
    id: entry.id,
    event: "round.signoff",
    apiVersion: WEBHOOK_API_VERSION,
    createdAt: at,
    data: {
      // A stand-in, so the payload keeps its one shape (see WebhookPayload).
      feedback: {
        id: round.id,
        number: 0,
        projectId: round.projectId,
        projectName,
        kind: "feedback",
        status: "open",
        priority: "none",
        title: `${round.name}: ${DECISION_LABEL[entry.decision]}`,
        body: entry.note || DECISION_LABEL[entry.decision],
        pageUrl: null,
        reporterName: entry.name,
        reviewLink: linkLabel,
        assigneeIds: [],
        createdAt: at,
        updatedAt: at,
        url: link,
      },
      round: { id: round.id, name: round.name, projectId: round.projectId },
      signoff: { decision: entry.decision, name: entry.name, email: entry.email, note: entry.note },
      actor: { kind: "guest", id: null },
    },
  };
  for (const ep of endpoints) await queueDelivery(ep, payload, entry.id);
}
