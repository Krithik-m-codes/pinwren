import {
  type ApiRelease,
  MAX_RELEASES_PER_PROJECT,
  type ReleaseCreate,
  type ReleaseUpdate,
} from "@pinwren/core";
import { activity, feedback, getDb, project, projectRelease } from "@pinwren/db";
import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { ApiError, notFound } from "../errors";
import { emit } from "../events";

// Releases (ADR 0029): the versions a project shipped. Recorded from the dashboard or by CI
// (`POST /api/v1/projects/:id/releases`); items are marked "fixed in" one of them, or in "the next release",
// which the next release recorded takes over.

type Row = typeof projectRelease.$inferSelect;

const rid = sql.raw(`"project_release"."id"`);
const rorg = sql.raw(`"project_release"."org_id"`);
const rproject = sql.raw(`"project_release"."project_id"`);
const rversion = sql.raw(`"project_release"."version"`);

/** The row plus its two counts, in the shape the API returns. */
const withCounts = {
  r: projectRelease,
  fixedCount: sql<number>`(select count(*)::int from feedback f where f.fixed_in_release_id = ${rid} and f.org_id = ${rorg} and f.deleted_at is null)`,
  regressionCount: sql<number>`(select count(*)::int from feedback f where f.project_id = ${rproject} and f.org_id = ${rorg} and f.deleted_at is null and f.regression_of_id is not null and lower(f.metadata->>'release') = lower(${rversion}))`,
};

const out = (r: Row, fixedCount = 0, regressionCount = 0): ApiRelease => ({
  id: r.id,
  projectId: r.projectId,
  version: r.version,
  commit: r.commit,
  notes: r.notes,
  deployedAt: r.deployedAt.toISOString(),
  createdAt: r.createdAt.toISOString(),
  fixedCount,
  regressionCount,
});

async function assertProject(orgId: string, projectId: string) {
  const [p] = await getDb()
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.orgId, orgId)));
  if (!p) throw notFound("Project");
}

/** Newest deploy first. */
export async function listReleases(orgId: string, projectId: string, limit = 200): Promise<ApiRelease[]> {
  await assertProject(orgId, projectId);
  const rows = await getDb()
    .select(withCounts)
    .from(projectRelease)
    .where(and(eq(projectRelease.orgId, orgId), eq(projectRelease.projectId, projectId)))
    .orderBy(desc(projectRelease.deployedAt), desc(projectRelease.createdAt))
    .limit(limit);
  return rows.map((x) => out(x.r, x.fixedCount, x.regressionCount));
}

export async function getRelease(orgId: string, id: string): Promise<ApiRelease> {
  const [x] = await getDb()
    .select(withCounts)
    .from(projectRelease)
    .where(and(eq(projectRelease.id, id), eq(projectRelease.orgId, orgId)));
  if (!x) throw notFound("Release");
  return out(x.r, x.fixedCount, x.regressionCount);
}

/**
 * Record a release. The same version again (a CI re-run) updates what the request names and answers
 * `created: false`; a new one also takes over the items promised for "the next release".
 */
export async function recordRelease(
  orgId: string,
  actorId: string | null,
  projectId: string,
  input: ReleaseCreate,
): Promise<{ release: ApiRelease; created: boolean; adopted: number }> {
  await assertProject(orgId, projectId);
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    // Serialise recordings of one project: the same version posted twice at once yields one row.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`release:${projectId}`}))`);
    const [existing] = await tx
      .select()
      .from(projectRelease)
      .where(
        and(
          eq(projectRelease.projectId, projectId),
          eq(projectRelease.orgId, orgId),
          sql`lower(${projectRelease.version}) = lower(${input.version})`,
        ),
      );
    if (existing) {
      const set: Partial<typeof projectRelease.$inferInsert> = {};
      if (input.commit !== undefined) set.commit = input.commit;
      if (input.notes !== undefined) set.notes = input.notes;
      if (input.deployedAt) set.deployedAt = new Date(input.deployedAt);
      if (!Object.keys(set).length) return { row: existing, created: false, adopted: [] };
      const [row] = await tx
        .update(projectRelease)
        .set(set)
        .where(eq(projectRelease.id, existing.id))
        .returning();
      return { row: row ?? existing, created: false, adopted: [] };
    }
    const [total] = await tx
      .select({ n: count() })
      .from(projectRelease)
      .where(eq(projectRelease.projectId, projectId));
    if ((total?.n ?? 0) >= MAX_RELEASES_PER_PROJECT) {
      throw new ApiError(
        409,
        "RELEASE_LIMIT",
        `A project keeps at most ${MAX_RELEASES_PER_PROJECT} releases. Delete old ones first.`,
      );
    }
    const [row] = await tx
      .insert(projectRelease)
      .values({
        orgId,
        projectId,
        version: input.version,
        commit: input.commit ?? null,
        notes: input.notes ?? null,
        deployedAt: input.deployedAt ? new Date(input.deployedAt) : new Date(),
        createdBy: actorId,
      })
      .returning();
    if (!row) throw new Error("release insert failed");
    // "Fixed in the next release" resolves to the first release recorded after the promise.
    const adopted = await tx
      .update(feedback)
      .set({ fixedInReleaseId: row.id, fixedInNextRelease: false })
      .where(
        and(
          eq(feedback.orgId, orgId),
          eq(feedback.projectId, projectId),
          eq(feedback.fixedInNextRelease, true),
          eq(feedback.status, "resolved"),
          isNull(feedback.deletedAt),
        ),
      )
      .returning({ id: feedback.id });
    if (adopted.length) {
      await tx.insert(activity).values(
        adopted.map((a) => ({
          orgId,
          feedbackId: a.id,
          actorId,
          actorKind: actorId ? "user" : "system",
          type: "fixedIn_changed",
          data: {
            from: { version: null, next: true },
            to: { version: row.version, next: false },
            via: "release",
          },
        })),
      );
    }
    return { row, created: true, adopted: adopted.map((a) => a.id) };
  });
  for (const feedbackId of result.adopted) {
    emit({
      type: "feedback.updated",
      orgId,
      feedbackId,
      actor: actorId ? { kind: "user", id: actorId } : { kind: "api", id: null },
      changes: { fixedInReleaseId: { from: null, to: result.row.id } },
    });
  }
  const [counts] = await db
    .select({ fixedCount: withCounts.fixedCount, regressionCount: withCounts.regressionCount })
    .from(projectRelease)
    .where(eq(projectRelease.id, result.row.id));
  return {
    release: out(result.row, counts?.fixedCount ?? 0, counts?.regressionCount ?? 0),
    created: result.created,
    adopted: result.adopted.length,
  };
}

export async function updateRelease(orgId: string, id: string, patch: ReleaseUpdate): Promise<ApiRelease> {
  const set: Partial<typeof projectRelease.$inferInsert> = {};
  if (patch.commit !== undefined) set.commit = patch.commit;
  if (patch.notes !== undefined) set.notes = patch.notes;
  if (patch.deployedAt) set.deployedAt = new Date(patch.deployedAt);
  const db = getDb();
  if (Object.keys(set).length) {
    const [row] = await db
      .update(projectRelease)
      .set(set)
      .where(and(eq(projectRelease.id, id), eq(projectRelease.orgId, orgId)))
      .returning({ id: projectRelease.id });
    if (!row) throw notFound("Release");
  }
  return getRelease(orgId, id);
}

/** Delete a release; items fixed in it lose the link (the foreign key clears it). */
export async function deleteRelease(orgId: string, id: string): Promise<void> {
  const [row] = await getDb()
    .delete(projectRelease)
    .where(and(eq(projectRelease.id, id), eq(projectRelease.orgId, orgId)))
    .returning({ id: projectRelease.id });
  if (!row) throw notFound("Release");
}

/** The release when it belongs to the project (the same workspace is implied by the composite keys). */
export async function releaseOfProject(
  orgId: string,
  projectId: string,
  releaseId: string,
): Promise<{ id: string; version: string; deployedAt: Date }> {
  const [r] = await getDb()
    .select({ id: projectRelease.id, version: projectRelease.version, deployedAt: projectRelease.deployedAt })
    .from(projectRelease)
    .where(
      and(
        eq(projectRelease.id, releaseId),
        eq(projectRelease.orgId, orgId),
        eq(projectRelease.projectId, projectId),
      ),
    );
  if (!r) throw new ApiError(400, "INVALID_RELEASE", "Pick a release of this item's project");
  return r;
}
