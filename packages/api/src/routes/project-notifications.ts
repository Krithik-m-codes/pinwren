import { type ProjectNotifications, projectNotificationsUpdate } from "@pinwren/core";
import { getDb, member, project, user } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, asc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import type { SessionVars } from "../context";
import { ApiError, notFound } from "../errors";
import { requirePermission } from "../permissions";

// Settings › Notifications › General and › Reporter, per project (BugPin model, wave-5 contract §3.2):
// who on the team gets new-report notifications (all members or chosen ones, plus extra addresses), and
// which emails the reporter gets. Every role may read; Admins change it (`settings.manage`).

const COLUMNS = {
  notifyMemberIds: project.notifyMemberIds,
  notifyEmails: project.notifyEmails,
  notifyReporter: project.notifyReporter,
  reporterEmailReceived: project.reporterEmailReceived,
  reporterEmailStatus: project.reporterEmailStatus,
  reporterEmailPriority: project.reporterEmailPriority,
  reporterEmailAssigned: project.reporterEmailAssigned,
};

type Row = {
  notifyMemberIds: string[] | null;
  notifyEmails: string[];
  notifyReporter: boolean;
  reporterEmailReceived: boolean;
  reporterEmailStatus: boolean;
  reporterEmailPriority: boolean;
  reporterEmailAssigned: boolean;
};

export const toProjectNotifications = (r: Row): ProjectNotifications => ({
  memberIds: r.notifyMemberIds,
  emails: r.notifyEmails,
  reporter: {
    enabled: r.notifyReporter,
    received: r.reporterEmailReceived,
    statusChanged: r.reporterEmailStatus,
    priorityChanged: r.reporterEmailPriority,
    assigned: r.reporterEmailAssigned,
  },
});

/** Pure: the extra addresses, trimmed, lower-cased and without duplicates (validated by zod already). */
export const normaliseEmails = (emails: readonly string[]) => [
  ...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)),
];

async function load(orgId: string, id: string): Promise<Row> {
  const [row] = await getDb()
    .select(COLUMNS)
    .from(project)
    .where(and(eq(project.id, id), eq(project.orgId, orgId)));
  if (!row) throw notFound("Project");
  return row;
}

export const projectNotifications = new Hono<{ Variables: SessionVars }>()
  .get("/projects/:id/notifications", async (c) => {
    const row = await load(c.var.orgId, c.req.param("id"));
    const members = await getDb()
      .select({ userId: user.id, name: user.name, email: user.email })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, c.var.orgId))
      .orderBy(asc(user.name));
    return c.json({ notifications: toProjectNotifications(row), members });
  })

  .patch(
    "/projects/:id/notifications",
    requirePermission("settings.manage"),
    zValidator("json", projectNotificationsUpdate),
    async (c) => {
      const id = c.req.param("id");
      const current = await load(c.var.orgId, id);
      const body = c.req.valid("json");
      const set: Partial<Row> = {};
      if (body.memberIds !== undefined) {
        const ids = body.memberIds === null ? null : [...new Set(body.memberIds)];
        if (ids?.length) {
          const found = await getDb()
            .select({ userId: member.userId })
            .from(member)
            .where(and(eq(member.organizationId, c.var.orgId), inArray(member.userId, ids)));
          if (found.length !== ids.length) {
            throw new ApiError(400, "INVALID_MEMBER", "Every recipient must be a member of this workspace");
          }
        }
        set.notifyMemberIds = ids;
      }
      if (body.emails !== undefined) set.notifyEmails = normaliseEmails(body.emails);
      const r = body.reporter;
      if (r?.enabled !== undefined) set.notifyReporter = r.enabled;
      if (r?.received !== undefined) set.reporterEmailReceived = r.received;
      if (r?.statusChanged !== undefined) set.reporterEmailStatus = r.statusChanged;
      if (r?.priorityChanged !== undefined) set.reporterEmailPriority = r.priorityChanged;
      if (r?.assigned !== undefined) set.reporterEmailAssigned = r.assigned;
      if (!Object.keys(set).length) return c.json({ notifications: toProjectNotifications(current) });
      const [row] = await getDb()
        .update(project)
        .set(set)
        .where(and(eq(project.id, id), eq(project.orgId, c.var.orgId)))
        .returning(COLUMNS);
      if (!row) throw notFound("Project");
      return c.json({ notifications: toProjectNotifications(row) });
    },
  );
