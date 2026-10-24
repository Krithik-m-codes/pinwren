import {
  type FeedbackListQuery,
  type FeedbackUpdate,
  isClosedStatus,
  parseWidgetConfig,
  panelActionsFor,
  PRIORITIES,
} from "@pinwren/core";
import {
  activity,
  comment,
  diagnostics,
  feedback,
  feedbackAsset,
  feedbackLabel,
  feedbackWatcher,
  getDb,
  issueIntegration,
  issueLink,
  label,
  member,
  page,
  project,
  reviewLink,
  user,
} from "@pinwren/db";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  type SQL,
  sql,
} from "drizzle-orm";
import { ApiError, notFound } from "../errors";
import { emit, updateEvents } from "../events";
import { purgeFeedback } from "../jobs/maintenance";
import { publishDeleted, publishRestored } from "../realtime/publish";
import { assertRoundFor } from "./rounds";

export const ACTIVE_STATUSES = ["open", "in_progress", "in_review"] as const;

export type Actor = { kind: "user" | "api"; userId: string };

/** A list cursor: the sort key of the last row, opaque to callers (base64url JSON). */
type CursorKey = { v?: string; t: string; id: string };

export function encodeCursor(key: CursorKey): string {
  return Buffer.from(JSON.stringify(key)).toString("base64url");
}

/**
 * Decode a cursor. Before wave 5 the cursor was the last row's ISO `createdAt`; such a cursor still pages
 * the default order (newest first).
 */
export function decodeCursor(cursor: string): CursorKey | { legacy: Date } {
  if (/^\d{4}-\d{2}-\d{2}T/.test(cursor)) {
    const at = new Date(cursor);
    if (!Number.isNaN(at.getTime())) return { legacy: at };
  }
  try {
    const v: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      v &&
      typeof v === "object" &&
      "t" in v &&
      "id" in v &&
      typeof v.t === "string" &&
      typeof v.id === "string" &&
      UUID.test(v.id) &&
      (!("v" in v) || typeof v.v === "string")
    ) {
      return v as CursorKey;
    }
  } catch {
    // not JSON: refused below
  }
  throw new ApiError(400, "INVALID_CURSOR", "Invalid cursor");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `%text%` for ILIKE, with the pattern characters escaped. */
export const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/**
 * Search words as a prefix `tsquery` ("check out" → `check:* & out:*`). Only letters and digits reach
 * `to_tsquery`, so user input can't produce a syntax error. Null when there is no word.
 */
export function prefixQuery(text: string): string | null {
  const words = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 12);
  return words.length ? words.map((w) => `${w}:*`).join(" & ") : null;
}

/** `#12` or `12`: a search that names an item number. */
export function numberOf(text: string): number | null {
  const m = /^#?(\d{1,9})$/.exec(text.trim());
  return m ? Number(m[1]) : null;
}

export type ItemLabel = { id: string; name: string; color: string };

export type ListOptions = {
  /** Only these items (export of a selection). */
  ids?: string[];
  /** Count every match (`total`); off for export pages. */
  count?: boolean;
};

export async function listFeedback(orgId: string, q: FeedbackListQuery, opts: ListOptions = {}) {
  const where: SQL[] = [
    eq(feedback.orgId, orgId),
    q.trash ? isNotNull(feedback.deletedAt) : isNull(feedback.deletedAt),
  ];
  if (opts.ids) where.push(opts.ids.length ? inArray(feedback.id, opts.ids) : sql`false`);
  if (q.projectId) where.push(eq(feedback.projectId, q.projectId));
  if (q.status === "active") where.push(inArray(feedback.status, [...ACTIVE_STATUSES]));
  else if (q.status !== "all") where.push(eq(feedback.status, q.status));
  if (q.kind) where.push(eq(feedback.kind, q.kind));
  if (q.priority) where.push(eq(feedback.priority, q.priority));
  if (q.roundId) where.push(eq(feedback.roundId, q.roundId));
  if (q.reviewLinkId) where.push(eq(feedback.reviewLinkId, q.reviewLinkId));
  if (q.assigneeId) where.push(sql`${q.assigneeId} = any(${feedback.assigneeIds})`);
  if (q.since) where.push(gte(feedback.createdAt, new Date(q.since)));
  if (q.page) where.push(sql`strpos(${page.url}, ${q.page}) > 0`);
  if (q.labelId) {
    where.push(
      sql`exists(select 1 from ${feedbackLabel} fl where fl.feedback_id = ${feedback.id} and fl.label_id = ${q.labelId})`,
    );
  }
  if (q.reporter) {
    const like = likePattern(q.reporter);
    where.push(
      sql`(${feedback.reporterGuest}->>'name' ilike ${like} or ${feedback.reporterGuest}->>'email' ilike ${like}
        or exists(select 1 from ${user} u where u.id = ${feedback.reporterId} and (u.name ilike ${like} or u.email ilike ${like})))`,
    );
  }
  if (q.browser) where.push(sql`${feedback.environment}->>'browser' ilike ${likePattern(q.browser)}`);
  if (q.hasReplay !== undefined) {
    const replay = sql`exists(select 1 from ${feedbackAsset} a where a.feedback_id = ${feedback.id} and a.kind = 'replay')`;
    where.push(q.hasReplay ? replay : sql`not ${replay}`);
  }
  if (q.q) {
    // Words as prefixes, the item number (`#12`), the reporter's name or email, and the page URL.
    const like = likePattern(q.q);
    const tsq = prefixQuery(q.q);
    const n = numberOf(q.q);
    const any: SQL[] = [
      sql`${feedback.reporterGuest}->>'email' ilike ${like}`,
      sql`${feedback.reporterGuest}->>'name' ilike ${like}`,
      sql`${page.url} ilike ${like}`,
    ];
    if (tsq) any.push(sql`${feedback.search} @@ to_tsquery('simple', ${tsq})`);
    if (n !== null) any.push(eq(feedback.number, n));
    where.push(sql`(${sql.join(any, sql` or `)})`);
  }

  // Order by the sort column, then (for priority) the timestamp, then the id: a total order, so the
  // cursor (the last row's key) never skips or repeats a row.
  const dir = q.order === "asc" ? asc : desc;
  const ts = q.sort === "updated" ? feedback.updatedAt : feedback.createdAt;
  const order = q.sort === "priority" ? [feedback.priority, ts, feedback.id] : [ts, feedback.id];
  const paged = [...where];
  if (q.cursor) {
    const key = decodeCursor(q.cursor);
    const op = q.order === "asc" ? sql`>` : sql`<`;
    if ("legacy" in key) {
      paged.push(lt(feedback.createdAt, key.legacy));
    } else if (q.sort === "priority") {
      if (!key.v || !(PRIORITIES as readonly string[]).includes(key.v)) {
        throw new ApiError(400, "INVALID_CURSOR", "Invalid cursor");
      }
      paged.push(
        sql`(${feedback.priority}, ${ts}, ${feedback.id}) ${op} (${key.v}::priority, ${key.t}::timestamptz, ${key.id}::uuid)`,
      );
    } else {
      paged.push(sql`(${ts}, ${feedback.id}) ${op} (${key.t}::timestamptz, ${key.id}::uuid)`);
    }
  }

  const db = getDb();
  const [rows, total] = await Promise.all([
    db
      .select({
        id: feedback.id,
        number: feedback.number,
        kind: feedback.kind,
        status: feedback.status,
        priority: feedback.priority,
        title: feedback.title,
        body: feedback.body,
        assigneeIds: feedback.assigneeIds,
        reporterGuest: feedback.reporterGuest,
        createdAt: feedback.createdAt,
        updatedAt: feedback.updatedAt,
        deletedAt: feedback.deletedAt,
        dueAt: feedback.dueAt,
        projectId: feedback.projectId,
        projectName: project.name,
        pageUrl: page.url,
        roundId: feedback.roundId,
        hasReplay: sql<boolean>`exists(select 1 from ${feedbackAsset} a where a.feedback_id = ${feedback.id} and a.kind = 'replay')`,
        hasScreenshot: sql<boolean>`exists(select 1 from ${feedbackAsset} a where a.feedback_id = ${feedback.id} and a.kind in ('screenshot', 'screenshot_annotated'))`,
        // The card thumbnail (annotated first), so the board never fetches a detail for it.
        screenshotAssetId: sql<
          string | null
        >`(select a.id from ${feedbackAsset} a where a.feedback_id = ${feedback.id}
          and a.kind in ('screenshot', 'screenshot_annotated') order by (a.kind = 'screenshot_annotated') desc, a.created_at limit 1)`,
        attachmentCount: sql<number>`(select count(*)::int from ${feedbackAsset} a where a.feedback_id = ${feedback.id} and a.kind = 'attachment')`,
        commentCount: sql<number>`(select count(*)::int from ${comment} cm where cm.feedback_id = ${feedback.id})`,
        labels: sql<
          ItemLabel[]
        >`coalesce((select json_agg(json_build_object('id', l.id, 'name', l.name, 'color', l.color)
          order by lower(l.name)) from ${feedbackLabel} fl join ${label} l on l.id = fl.label_id
          where fl.feedback_id = ${feedback.id}), '[]'::json)`,
        // Full precision (microseconds) for the cursor: a JS Date would round it to milliseconds.
        sortTs: sql<string>`${ts}::text`,
      })
      .from(feedback)
      .innerJoin(project, eq(project.id, feedback.projectId))
      .leftJoin(page, eq(page.id, feedback.pageId))
      .where(and(...paged))
      .orderBy(...order.map((c) => dir(c)))
      .limit(q.limit + 1),
    opts.count === false
      ? Promise.resolve(null)
      : db
          .select({ n: count() })
          .from(feedback)
          .leftJoin(page, eq(page.id, feedback.pageId))
          .where(and(...where))
          .then((r) => r[0]?.n ?? 0),
  ]);

  const hasMore = rows.length > q.limit;
  const kept = hasMore ? rows.slice(0, q.limit) : rows;
  const last = kept.at(-1);
  const items = kept.map(({ sortTs: _key, ...row }) => row);
  const nextCursor =
    hasMore && last
      ? encodeCursor({ ...(q.sort === "priority" ? { v: last.priority } : {}), t: last.sortTs, id: last.id })
      : null;
  return { items, nextCursor, ...(total === null ? {} : { total }) };
}

export type DetailOptions = {
  /** The caller, for `watching`. */
  userId?: string;
  /** Open an item in the trash too (org admins, wave-5 contract §3.4). */
  includeDeleted?: boolean;
};

export async function getFeedbackDetail(
  orgId: string,
  id: string,
  audience: "admin" | "member" | "viewer" = "member",
  opts: DetailOptions = {},
) {
  const db = getDb();
  const [row] = await db
    .select({
      f: feedback,
      projectName: project.name,
      projectSlug: project.slug,
      widgetConfig: project.widgetConfig,
      publicRead: project.publicRead,
      notifyReporter: project.notifyReporter,
      pageUrl: page.url,
      pageTitle: page.title,
      reviewLink: { id: reviewLink.id, label: reviewLink.label },
    })
    .from(feedback)
    .innerJoin(project, eq(project.id, feedback.projectId))
    .leftJoin(page, eq(page.id, feedback.pageId))
    .leftJoin(reviewLink, eq(reviewLink.id, feedback.reviewLinkId))
    .where(
      and(
        eq(feedback.id, id),
        eq(feedback.orgId, orgId),
        opts.includeDeleted ? undefined : isNull(feedback.deletedAt),
      ),
    );
  if (!row) throw notFound("Feedback");

  const [labels, related, watching] = await Promise.all([
    db
      .select({ id: label.id, name: label.name, color: label.color })
      .from(feedbackLabel)
      .innerJoin(label, eq(label.id, feedbackLabel.labelId))
      .where(eq(feedbackLabel.feedbackId, id))
      .orderBy(sql`lower(${label.name})`),
    // The original this one duplicates, and the items marked as duplicates of this one (both ways).
    db
      .select({
        id: feedback.id,
        number: feedback.number,
        title: feedback.title,
        body: feedback.body,
        duplicateOfId: feedback.duplicateOfId,
      })
      .from(feedback)
      .where(
        and(
          eq(feedback.orgId, orgId),
          isNull(feedback.deletedAt),
          ne(feedback.id, id),
          row.f.duplicateOfId
            ? sql`(${feedback.id} = ${row.f.duplicateOfId} or ${feedback.duplicateOfId} = ${id})`
            : eq(feedback.duplicateOfId, id),
        ),
      )
      .orderBy(asc(feedback.number))
      .limit(51),
    opts.userId
      ? db
          .select({ n: feedbackWatcher.userId })
          .from(feedbackWatcher)
          .where(and(eq(feedbackWatcher.feedbackId, id), eq(feedbackWatcher.userId, opts.userId)))
          .then((r) => r.length > 0)
      : Promise.resolve(false),
  ]);
  const ref = (r: (typeof related)[number]) => ({
    id: r.id,
    number: r.number,
    title: r.title?.trim() || r.body.split("\n")[0]?.slice(0, 120) || "",
  });
  const original = related.find((r) => r.id === row.f.duplicateOfId);

  const [assets, comments, events, diag, assignees, issues, trackers] = await Promise.all([
    db
      .select({
        id: feedbackAsset.id,
        kind: feedbackAsset.kind,
        contentType: feedbackAsset.contentType,
        bytes: feedbackAsset.bytes,
        name: feedbackAsset.name,
        meta: feedbackAsset.meta,
        annotations: feedbackAsset.annotations,
        capture: feedbackAsset.capture,
      })
      .from(feedbackAsset)
      .where(eq(feedbackAsset.feedbackId, id))
      .orderBy(asc(feedbackAsset.createdAt)),
    db
      .select({
        id: comment.id,
        body: comment.body,
        visibility: comment.visibility,
        createdAt: comment.createdAt,
        editedAt: comment.editedAt,
        mentions: comment.mentions,
        authorGuest: comment.authorGuest,
        author: { id: user.id, name: user.name, image: user.image },
      })
      .from(comment)
      .leftJoin(user, eq(user.id, comment.authorId))
      .where(eq(comment.feedbackId, id))
      .orderBy(asc(comment.createdAt)),
    db
      .select({
        id: activity.id,
        type: activity.type,
        data: activity.data,
        createdAt: activity.createdAt,
        actorKind: activity.actorKind,
        actorName: user.name,
      })
      .from(activity)
      .leftJoin(user, eq(user.id, activity.actorId))
      .where(eq(activity.feedbackId, id))
      .orderBy(asc(activity.createdAt)),
    db.select().from(diagnostics).where(eq(diagnostics.feedbackId, id)),
    userNames(row.f.assigneeIds),
    db
      .select({
        id: issueLink.id,
        integrationId: issueLink.integrationId,
        provider: issueLink.provider,
        number: issueLink.number,
        url: issueLink.url,
        state: issueLink.state,
      })
      .from(issueLink)
      .where(eq(issueLink.feedbackId, id))
      .orderBy(asc(issueLink.createdAt)),
    // Trackers the item can be sent to ("Send to GitHub/GitLab"); never the token.
    db
      .select({ id: issueIntegration.id, provider: issueIntegration.provider, repo: issueIntegration.repo })
      .from(issueIntegration)
      .where(and(eq(issueIntegration.projectId, row.f.projectId), eq(issueIntegration.active, true)))
      .orderBy(asc(issueIntegration.provider)),
  ]);

  // Activity rows store ids (assignees, labels, the duplicated item); resolve them so the timeline can
  // read them. A label or item deleted since resolves to null.
  const ids = { users: new Set<string>(), labels: new Set<string>(), items: new Set<string>() };
  for (const e of events) {
    const bucket =
      e.type === "assigneeIds_changed"
        ? ids.users
        : e.type === "labelIds_changed"
          ? ids.labels
          : e.type === "duplicateOfId_changed"
            ? ids.items
            : null;
    if (!bucket) continue;
    for (const k of ["from", "to"] as const) {
      const v = e.data[k];
      if (Array.isArray(v)) for (const x of v) if (typeof x === "string") bucket.add(x);
      if (typeof v === "string") bucket.add(v);
    }
  }
  const [userRows, labelRows, itemRows] = await Promise.all([
    userNames([...ids.users]),
    ids.labels.size
      ? db
          .select({ id: label.id, name: label.name, color: label.color })
          .from(label)
          .where(inArray(label.id, [...ids.labels]))
      : Promise.resolve([]),
    ids.items.size
      ? db
          .select({ id: feedback.id, number: feedback.number })
          .from(feedback)
          .where(and(eq(feedback.orgId, orgId), inArray(feedback.id, [...ids.items])))
      : Promise.resolve([]),
  ]);
  const names = new Map(userRows.map((u) => [u.id, u.name]));
  const labelsById = new Map(labelRows.map((l) => [l.id, l]));
  const numbers = new Map(itemRows.map((r) => [r.id, r.number]));
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
  const activityOut = events.map((e) => {
    if (e.type === "assigneeIds_changed") {
      const named = (v: unknown) => list(v).map((x) => ({ id: x, name: names.get(x) ?? null }));
      return { ...e, data: { ...e.data, fromUsers: named(e.data.from), toUsers: named(e.data.to) } };
    }
    if (e.type === "labelIds_changed") {
      const from = list(e.data.from);
      const to = list(e.data.to);
      const label_ = (x: string) => labelsById.get(x) ?? { id: x, name: null, color: null };
      return {
        ...e,
        data: {
          ...e.data,
          added: to.filter((x) => !from.includes(x)).map(label_),
          removed: from.filter((x) => !to.includes(x)).map(label_),
        },
      };
    }
    if (e.type === "duplicateOfId_changed") {
      const num = (v: unknown) => (typeof v === "string" ? (numbers.get(v) ?? null) : null);
      return { ...e, data: { ...e.data, fromNumber: num(e.data.from), toNumber: num(e.data.to) } };
    }
    return e;
  });

  const { reporterTokenHash: _hidden, ...f } = row.f;
  return {
    feedback: {
      ...f,
      projectName: row.projectName,
      projectSlug: row.projectSlug,
      pageUrl: row.pageUrl,
      pageTitle: row.pageTitle,
      /** The review link a guest sent it through (F-012), shown as its source. */
      reviewLink: row.reviewLink,
      labels,
      duplicateOf: original ? ref(original) : null,
    },
    /** Items marked as duplicates of this one. */
    duplicates: related.filter((r) => r.duplicateOfId === id).map(ref),
    watching,
    /** Where a public reply goes (the composer says so): under the pin, by email, or nowhere. */
    replyReach: {
      publicRead: row.publicRead,
      notifyReporter: row.notifyReporter,
      reporterHasEmail: !!row.f.reporterGuest?.email,
    },
    // Team-only actions included (wave-3 contract §1), but no webhook URL, and nothing team-only for
    // viewers (ADR 0021).
    panelActions: panelActionsFor(parseWidgetConfig(row.widgetConfig).panelActions, audience, "detail"),
    issues,
    integrations: trackers,
    assignees,
    assets,
    comments,
    activity: activityOut,
    diagnostics: diag[0] ?? null,
  };
}

async function userNames(ids: string[]) {
  if (!ids.length) return [];
  return getDb()
    .select({ id: user.id, name: user.name, email: user.email, image: user.image })
    .from(user)
    .where(inArray(user.id, ids));
}

export async function updateFeedback(orgId: string, actor: Actor, id: string, patch: FeedbackUpdate) {
  const db = getDb();
  if (patch.assigneeIds?.length) {
    const unique = [...new Set(patch.assigneeIds)];
    const found = await db
      .select({ id: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, orgId), inArray(member.userId, unique)));
    if (found.length !== unique.length) {
      throw new ApiError(400, "INVALID_ASSIGNEE", "Assignees must be members of this organisation");
    }
    patch = { ...patch, assigneeIds: unique };
  }
  const { labelIds, dueAt, kind, ...columns } = patch;
  const { before, after, labels } = await db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(feedback)
      .where(and(eq(feedback.id, id), eq(feedback.orgId, orgId), isNull(feedback.deletedAt)))
      .for("update");
    if (!before) throw notFound("Feedback");
    if (patch.roundId) await assertRoundFor(orgId, before.projectId, patch.roundId);
    if (patch.duplicateOfId) await assertDuplicateTarget(tx, before, patch.duplicateOfId);

    const set: Partial<typeof feedback.$inferInsert> = { ...columns };
    if (kind) set.kind = kind;
    if (dueAt !== undefined) set.dueAt = dueAt === null ? null : new Date(dueAt);
    if (patch.status && patch.status !== before.status) {
      set.resolvedAt = isClosedStatus(patch.status) ? new Date() : null;
    }
    // A labels-only patch changes no feedback column; bump updatedAt so lists still re-sort.
    if (!Object.keys(set).length) set.updatedAt = new Date();
    const [after] = await tx.update(feedback).set(set).where(eq(feedback.id, id)).returning();
    if (!after) throw notFound("Feedback");

    const fields = Object.keys(set).filter(
      (k) => k !== "resolvedAt" && k !== "updatedAt",
    ) as (keyof typeof after)[];
    const entries: { field: string; from: unknown; to: unknown }[] = fields
      .filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
      .map((k) => ({ field: k, from: before[k] ?? null, to: after[k] ?? null }));
    const labels = labelIds ? await replaceLabels(tx, before, labelIds) : null;
    if (labels && !sameSet(labels.from, labels.to)) entries.push({ field: "labelIds", ...labels });

    if (entries.length) {
      await tx.insert(activity).values(
        entries.map(({ field, from, to }) => ({
          orgId,
          feedbackId: id,
          actorId: actor.userId,
          // A token acts as its owner; the timeline shows the person either way.
          actorKind: "user",
          type: `${field}_changed`,
          data: { from, to, ...(actor.kind === "api" ? { via: "api" } : {}) },
        })),
      );
    }
    return { before, after, labels };
  });
  emit(
    ...updateEvents(
      { orgId, feedbackId: id, actor: { kind: actor.kind, id: actor.userId } },
      { ...before, labelIds: labels?.from },
      { ...after, labelIds: labels?.to },
      [
        ...Object.keys(columns),
        ...(kind ? ["kind"] : []),
        ...(dueAt !== undefined ? ["dueAt"] : []),
        ...(labels ? ["labelIds"] : []),
      ],
    ),
  );
  const { reporterTokenHash: _hidden, ...out } = after;
  return { ...out, ...(labels ? { labelIds: labels.to } : {}) };
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
type FeedbackRow = typeof feedback.$inferSelect;

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/** A duplicate points at another live item of the same project. */
async function assertDuplicateTarget(tx: Tx, item: FeedbackRow, targetId: string) {
  if (targetId === item.id) {
    throw new ApiError(400, "INVALID_DUPLICATE", "An item can't be a duplicate of itself");
  }
  const [target] = await tx
    .select({ id: feedback.id })
    .from(feedback)
    .where(
      and(eq(feedback.id, targetId), eq(feedback.projectId, item.projectId), isNull(feedback.deletedAt)),
    );
  if (!target) {
    throw new ApiError(400, "INVALID_DUPLICATE", "Pick an item of the same project as the original");
  }
}

/** Replace the item's labels with `ids` (labels of its own project only). Returns the ids before and after. */
async function replaceLabels(tx: Tx, item: FeedbackRow, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length) {
    const found = await tx
      .select({ id: label.id })
      .from(label)
      .where(and(eq(label.projectId, item.projectId), inArray(label.id, unique)));
    if (found.length !== unique.length) {
      throw new ApiError(400, "INVALID_LABEL", "Labels must belong to this item's project");
    }
  }
  const prev = await tx
    .select({ id: feedbackLabel.labelId })
    .from(feedbackLabel)
    .where(eq(feedbackLabel.feedbackId, item.id));
  const from = prev.map((r) => r.id);
  if (!sameSet(from, unique)) {
    await tx.delete(feedbackLabel).where(eq(feedbackLabel.feedbackId, item.id));
    if (unique.length) {
      await tx.insert(feedbackLabel).values(unique.map((labelId) => ({ feedbackId: item.id, labelId })));
    }
  }
  return { from, to: unique };
}

// --- Trash (wave-5 contract §3.4): soft delete, restore, delete forever --------------------------------

/** Move an item to the trash: logged in the timeline, announced to webhooks / notifications and streams. */
export async function trashFeedback(orgId: string, actor: Actor, id: string): Promise<void> {
  const f = await getDb().transaction(async (tx) => {
    const [f] = await tx
      .update(feedback)
      .set({ deletedAt: new Date() })
      .where(and(eq(feedback.id, id), eq(feedback.orgId, orgId), isNull(feedback.deletedAt)))
      .returning({ id: feedback.id, projectId: feedback.projectId });
    if (!f) throw notFound("Feedback");
    await tx
      .insert(activity)
      .values({ orgId, feedbackId: id, actorId: actor.userId, type: "deleted", data: {} });
    return f;
  });
  emit({ type: "feedback.deleted", orgId, feedbackId: id, actor: { kind: actor.kind, id: actor.userId } });
  publishDeleted(orgId, f.projectId, id);
}

/** Take an item out of the trash. Open inboxes see it arrive again (stream `feedback.created`). */
export async function restoreFeedback(orgId: string, actor: Actor, id: string) {
  const { before, after } = await getDb().transaction(async (tx) => {
    const [before] = await tx
      .select({ deletedAt: feedback.deletedAt })
      .from(feedback)
      .where(and(eq(feedback.id, id), eq(feedback.orgId, orgId), isNotNull(feedback.deletedAt)))
      .for("update");
    if (!before?.deletedAt) throw notFound("Feedback in the trash");
    const [after] = await tx.update(feedback).set({ deletedAt: null }).where(eq(feedback.id, id)).returning();
    if (!after) throw notFound("Feedback");
    await tx.insert(activity).values({
      orgId,
      feedbackId: id,
      actorId: actor.userId,
      type: "restored",
      data: { deletedAt: before.deletedAt.toISOString() },
    });
    return { before, after };
  });
  emit({
    type: "feedback.updated",
    orgId,
    feedbackId: id,
    actor: { kind: actor.kind, id: actor.userId },
    changes: { deletedAt: { from: before.deletedAt?.toISOString() ?? null, to: null } },
  });
  publishRestored(orgId, after);
  const { reporterTokenHash: _hidden, ...out } = after;
  return out;
}

/** Delete an item in the trash for good, with its files. Live items must go to the trash first. */
export async function purgeTrashed(orgId: string, id: string): Promise<void> {
  const [f] = await getDb()
    .select({ deletedAt: feedback.deletedAt })
    .from(feedback)
    .where(and(eq(feedback.id, id), eq(feedback.orgId, orgId)));
  if (!f) throw notFound("Feedback");
  if (!f.deletedAt) {
    throw new ApiError(400, "NOT_IN_TRASH", "Move the item to the trash before deleting it for good");
  }
  await purgeFeedback([id]);
}

/** The user ids a comment mentions: unique, without the author. */
export function mentionIds(ids: readonly string[] | undefined, authorId: string): string[] {
  return [...new Set(ids ?? [])].filter((id) => id !== authorId);
}

export async function addTeamComment(
  orgId: string,
  actor: Actor,
  feedbackId: string,
  body: { body: string; visibility: "public" | "internal"; mentions?: string[] | undefined },
) {
  const db = getDb();
  const [f] = await db
    .select({ id: feedback.id })
    .from(feedback)
    .where(and(eq(feedback.id, feedbackId), eq(feedback.orgId, orgId), isNull(feedback.deletedAt)));
  if (!f) throw notFound("Feedback");
  // Mentions (wave-5 contract §3.2): members of this workspace only; duplicates and the author dropped.
  const mentions = mentionIds(body.mentions, actor.userId);
  if (mentions.length) {
    const found = await db
      .select({ id: member.userId })
      .from(member)
      .where(and(eq(member.organizationId, orgId), inArray(member.userId, mentions)));
    if (found.length !== mentions.length) {
      throw new ApiError(400, "INVALID_MENTION", "Only members of this workspace can be mentioned");
    }
  }
  const [created] = await db
    .insert(comment)
    .values({
      orgId,
      feedbackId,
      authorId: actor.userId,
      body: body.body,
      visibility: body.visibility,
      mentions,
    })
    .returning();
  if (!created) throw new Error("comment insert failed");
  emit({
    type: "comment.created",
    orgId,
    feedbackId,
    commentId: created.id,
    actor: { kind: actor.kind, id: actor.userId },
  });
  return created;
}
