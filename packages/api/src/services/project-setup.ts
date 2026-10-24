import { isOriginAllowed, projectCreate, type RejectedOrigin, type WidgetConfigInput } from "@pinwren/core";
import { emailDelivery, feedback, getDb, invitation, member, project } from "@pinwren/db";
import { and, count, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { resolveSmtp } from "../email/config";
import { setupNeeded } from "./setup";

// Install and onboarding (wave-5 contract §3.5): project presets, the "Allow" path for refused origins
// and the first-run setup checklist.

/**
 * What the project is for, asked when it is created. A public website keeps bug reports private
 * (visitors see no pins and can't resolve anything); a staging or client-review site shows the pins so
 * reviewers can follow each other's comments.
 */
export const PROJECT_PRESETS = ["public-site", "review"] as const;
export type ProjectPreset = (typeof PROJECT_PRESETS)[number];

/** `POST /api/projects`: the core schema plus the optional preset (install-onboarding owns it). */
export const projectCreateWithPreset = projectCreate.extend({
  preset: z.enum(PROJECT_PRESETS).optional(),
});

/** Column values and widget-config overrides a preset sets on the new project. */
export function presetValues(preset: ProjectPreset | undefined): {
  publicRead: boolean;
  widgetConfig: WidgetConfigInput;
} {
  if (preset === "review") return { publicRead: true, widgetConfig: { visitorsCanResolve: true } };
  // "public-site" and no answer get the safe defaults spelled out, so a later change of the column
  // defaults never makes a public site's reports visible.
  return { publicRead: false, widgetConfig: { visitorsCanResolve: false } };
}

/** Refused origins that the new allowlist now lets through are dropped from the Install tab's list. */
export function pruneRejected(
  rejected: readonly RejectedOrigin[],
  allowed: readonly string[],
): RejectedOrigin[] {
  return rejected.filter((r) => !isOriginAllowed(r.origin, allowed));
}

/** First-run checklist steps, in the order the dashboard shows them. */
export const SETUP_STEPS = ["admin", "email", "emailSent", "widget", "feedback", "team"] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export type SetupChecklist = {
  steps: Record<SetupStep, boolean>;
  done: number;
  total: number;
  /** The project the "Install the widget" step links to: the first one not yet seen, else the first. */
  projectId: string | null;
};

export function checklistOf(steps: Record<SetupStep, boolean>, projectId: string | null): SetupChecklist {
  return {
    steps,
    done: SETUP_STEPS.filter((s) => steps[s]).length,
    total: SETUP_STEPS.length,
    projectId,
  };
}

/** `GET /api/setup-checklist`: every step read from real state, never from a "done" flag. */
export async function setupChecklist(orgId: string): Promise<SetupChecklist> {
  const db = getDb();
  const [needed, smtp, projects, [fb], [sent], [members], [invites]] = await Promise.all([
    setupNeeded(),
    resolveSmtp(),
    db
      .select({ id: project.id, lastSeenAt: project.lastSeenAt })
      .from(project)
      .where(and(eq(project.orgId, orgId), isNull(project.archivedAt)))
      .orderBy(project.createdAt),
    db
      .select({ id: feedback.id })
      .from(feedback)
      .where(and(eq(feedback.orgId, orgId), isNull(feedback.deletedAt)))
      .limit(1),
    // SMTP is instance-wide: any email that went out (the test email included) proves delivery works.
    db
      .select({ id: emailDelivery.id })
      .from(emailDelivery)
      .where(and(eq(emailDelivery.status, "sent"), isNotNull(emailDelivery.sentAt)))
      .limit(1),
    db.select({ n: count() }).from(member).where(eq(member.organizationId, orgId)),
    db
      .select({ n: count() })
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, orgId),
          eq(invitation.status, "pending"),
          gt(invitation.expiresAt, sql`now()`),
        ),
      ),
  ]);
  const unseen = projects.find((p) => !p.lastSeenAt);
  return checklistOf(
    {
      admin: !needed,
      email: smtp !== null,
      emailSent: !!sent,
      widget: projects.some((p) => p.lastSeenAt !== null),
      feedback: !!fb,
      team: (members?.n ?? 0) > 1 || (invites?.n ?? 0) > 0,
    },
    unseen?.id ?? projects[0]?.id ?? null,
  );
}
