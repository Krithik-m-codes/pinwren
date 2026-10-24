import { normalizePageUrl, parseWidgetConfig } from "@pinwren/core";
import { feedback, getDb, page, project } from "@pinwren/db";
import { and, eq, inArray, sql } from "drizzle-orm";

// Page grouping (wave-5 contract §2): `normalizePageUrl` now drops tracking parameters, folds a trailing slash
// and applies each project's `ignoredQueryParams`. Pages stored under the old rules (one row per distinct
// URL) are merged into the row their URL normalises to, so `/pricing?utm_source=x` and `/pricing/` join
// `/pricing`. Runs at startup; idempotent, and cheap once everything is merged (only rows whose URL has a
// query or a trailing slash are looked at).

export type PageRow = { id: string; url: string };
export type PageMove = { from: string; to: string; url: string };

/**
 * For one project's pages: which rows move (`from` → `to`, the row already holding the normalised URL or the
 * first row that normalises to it) and which rows just get their URL rewritten (`rename`).
 */
export function planPageMerge(
  rows: readonly PageRow[],
  existing: ReadonlyMap<string, string>,
  ignored: readonly string[],
): { moves: PageMove[]; renames: PageRow[] } {
  const target = new Map(existing); // normalised url → row id that keeps it
  const moves: PageMove[] = [];
  const renames: PageRow[] = [];
  for (const r of rows) {
    let key: string;
    try {
      key = normalizePageUrl(r.url, ignored);
    } catch {
      continue; // not a URL (never written by the widget); leave it alone
    }
    if (key === r.url) continue;
    const keep = target.get(key);
    if (keep && keep !== r.id) moves.push({ from: r.id, to: keep, url: key });
    else {
      target.set(key, r.id);
      renames.push({ id: r.id, url: key });
    }
  }
  return { moves, renames };
}

/** Rows whose URL has a query or a trailing slash: the only ones a newer rule can change. */
const STALE = sql`(${page.url} like '%?%' or ${page.url} ~ '^[a-z]+://[^/]+/.*/$')`;

/** Merge every project's stale page rows (startup). Returns how many rows were merged or renamed. */
export async function mergeStalePages(): Promise<number> {
  const candidates = await getDb()
    .select({ id: page.id, url: page.url, projectId: page.projectId })
    .from(page)
    .where(STALE)
    .limit(50_000);
  const byProject = new Map<string, PageRow[]>();
  for (const r of candidates) byProject.set(r.projectId, [...(byProject.get(r.projectId) ?? []), r]);
  let changed = 0;
  for (const [projectId, rows] of byProject) changed += await mergeProjectPages(projectId, rows);
  return changed;
}

/**
 * Re-group one project's pages now, e.g. right after its ignored query parameters changed (Page Review ›
 * URL grouping). `rows` defaults to the project's stale rows.
 */
export async function mergeProjectPages(projectId: string, rows?: PageRow[]): Promise<number> {
  const db = getDb();
  const list =
    rows ??
    (await db
      .select({ id: page.id, url: page.url })
      .from(page)
      .where(and(eq(page.projectId, projectId), STALE))
      .limit(50_000));
  if (!list.length) return 0;
  const [p] = await db
    .select({ widgetConfig: project.widgetConfig })
    .from(project)
    .where(eq(project.id, projectId));
  if (!p) return 0;
  const ignored = parseWidgetConfig(p.widgetConfig).ignoredQueryParams;
  const keys = new Set<string>();
  for (const r of list) {
    try {
      keys.add(normalizePageUrl(r.url, ignored));
    } catch {
      // skipped by planPageMerge too
    }
  }
  if (!keys.size) return 0;
  const existing = await db
    .select({ id: page.id, url: page.url })
    .from(page)
    .where(and(eq(page.projectId, projectId), inArray(page.url, [...keys])));
  const plan = planPageMerge(list, new Map(existing.map((e) => [e.url, e.id])), ignored);
  if (!plan.moves.length && !plan.renames.length) return 0;
  await db.transaction(async (tx) => {
    for (const m of plan.moves) {
      await tx.update(feedback).set({ pageId: m.to }).where(eq(feedback.pageId, m.from));
      await tx.delete(page).where(eq(page.id, m.from));
    }
    for (const r of plan.renames) await tx.update(page).set({ url: r.url }).where(eq(page.id, r.id));
  });
  return plan.moves.length + plan.renames.length;
}
