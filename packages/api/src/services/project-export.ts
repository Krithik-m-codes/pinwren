import { randomUUID } from "node:crypto";
import {
  activity,
  comment,
  feedback,
  feedbackAsset,
  feedbackLabel,
  getDb,
  label,
  orgSetting,
  page,
  project,
  user,
} from "@pinwren/db";
import { and, asc, eq, gt, inArray, isNull } from "drizzle-orm";
import { ApiError, notFound } from "../errors";
import { EXTENSIONS, storage } from "../storage";
import { buildZip, ZIP_MAX_ENTRIES, type ZipEntry } from "./zip";

// Project data export (F-095, wave-5 contract §3.5): an Admin asks for it on Project › Privacy & data, a
// background job (`project.export`) writes one zip to storage — `project.json`, `feedback.json` and every
// file under `assets/` — and the tab offers it for download for EXPORT_TTL_DAYS. One export per project:
// a new request replaces the previous file. The state lives in `org_setting` (`project-export:<id>`).

export const EXPORT_TTL_DAYS = 7;
/** Files beyond this total are left out (listed in `skippedAssets`); the archive is built in memory. */
export const EXPORT_MAX_ASSET_BYTES = 512 * 1024 * 1024;
const PAGE = 500;

export const EXPORT_STATUSES = ["pending", "running", "ready", "failed"] as const;
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

export type ProjectExportState = {
  status: ExportStatus;
  requestedAt: string;
  requestedBy: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
  storageKey: string | null;
  bytes: number | null;
  items: number | null;
  assets: number | null;
  skippedAssets: number | null;
  error: string | null;
};

/** What the dashboard sees: never the storage key. */
export type ProjectExportView = Omit<ProjectExportState, "storageKey" | "requestedBy"> & {
  downloadUrl: string | null;
};

export type ProjectExportJob = { orgId: string; projectId: string };

const keyOf = (projectId: string) => `project-export:${projectId}`;

/** A ready export past its expiry shows as gone (its file is replaced on the next request). */
export function exportView(
  projectId: string,
  s: ProjectExportState | null,
  now = Date.now(),
): ProjectExportView | null {
  if (!s) return null;
  const expired = s.status === "ready" && s.expiresAt !== null && Date.parse(s.expiresAt) <= now;
  if (expired) return null;
  const { storageKey: _key, requestedBy: _by, ...rest } = s;
  return {
    ...rest,
    downloadUrl: s.status === "ready" ? `/api/projects/${projectId}/export/download` : null,
  };
}

async function readState(orgId: string, projectId: string): Promise<ProjectExportState | null> {
  const [row] = await getDb()
    .select({ value: orgSetting.value })
    .from(orgSetting)
    .where(and(eq(orgSetting.orgId, orgId), eq(orgSetting.key, keyOf(projectId))));
  return (row?.value as ProjectExportState | undefined) ?? null;
}

async function writeState(orgId: string, projectId: string, state: ProjectExportState, userId?: string) {
  await getDb()
    .insert(orgSetting)
    .values({ orgId, key: keyOf(projectId), value: state, updatedBy: userId ?? null })
    .onConflictDoUpdate({
      target: [orgSetting.orgId, orgSetting.key],
      set: { value: state, updatedAt: new Date(), ...(userId ? { updatedBy: userId } : {}) },
    });
}

async function assertProject(orgId: string, projectId: string) {
  const [p] = await getDb()
    .select()
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.orgId, orgId)));
  if (!p) throw notFound("Project");
  return p;
}

export async function getExport(orgId: string, projectId: string): Promise<ProjectExportView | null> {
  await assertProject(orgId, projectId);
  return exportView(projectId, await readState(orgId, projectId));
}

/** Record the request; the caller queues the job. A running export is not started twice. */
export async function requestExport(
  orgId: string,
  projectId: string,
  userId: string,
): Promise<ProjectExportView> {
  await assertProject(orgId, projectId);
  const current = await readState(orgId, projectId);
  if (current && (current.status === "pending" || current.status === "running")) {
    // A stuck job (crash mid-run) must not block exports for ever.
    if (Date.now() - Date.parse(current.requestedAt) < 60 * 60 * 1000) {
      throw new ApiError(409, "EXPORT_RUNNING", "An export of this project is already being prepared");
    }
  }
  const state: ProjectExportState = {
    status: "pending",
    requestedAt: new Date().toISOString(),
    requestedBy: userId,
    finishedAt: null,
    expiresAt: null,
    storageKey: current?.storageKey ?? null,
    bytes: null,
    items: null,
    assets: null,
    skippedAssets: null,
    error: null,
  };
  await writeState(orgId, projectId, state, userId);
  const view = exportView(projectId, state);
  if (!view) throw new Error("unreachable");
  return view;
}

/** The finished archive, for `GET /api/projects/:id/export/download`. */
export async function exportDownload(orgId: string, projectId: string): Promise<Response> {
  const p = await assertProject(orgId, projectId);
  const s = await readState(orgId, projectId);
  if (s?.status !== "ready" || !s.storageKey || !exportView(projectId, s)) throw notFound("Export");
  const file = await storage().get(s.storageKey);
  if (!file) throw notFound("Export file");
  const day = (s.finishedAt ?? s.requestedAt).slice(0, 10);
  const headers: Record<string, string> = {
    "content-type": "application/zip",
    "content-disposition": `attachment; filename="pinwren-${p.slug}-${day}.zip"`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  };
  if (file.bytes) headers["content-length"] = String(file.bytes);
  return new Response(file.body, { headers });
}

async function readAll(body: ReadableStream): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let n = 0;
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(chunk);
    n += chunk.length;
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const json = (v: unknown) => new TextEncoder().encode(`${JSON.stringify(v, null, 2)}\n`);

/** The `project.export` job. Never throws: a failure is recorded on the export for the dashboard. */
export async function runProjectExport({ orgId, projectId }: ProjectExportJob): Promise<void> {
  const state = await readState(orgId, projectId);
  if (!state || state.status === "ready") return;
  await writeState(orgId, projectId, { ...state, status: "running" });
  const previousKey = state.storageKey;
  try {
    const result = await buildProjectArchive(orgId, projectId);
    const key = `${projectId}/${randomUUID()}.zip`;
    await storage().put(key, result.zip, "application/zip");
    const now = new Date();
    await writeState(orgId, projectId, {
      ...state,
      status: "ready",
      finishedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + EXPORT_TTL_DAYS * 86_400_000).toISOString(),
      storageKey: key,
      bytes: result.zip.length,
      items: result.items,
      assets: result.assets,
      skippedAssets: result.skipped,
      error: null,
    });
    if (previousKey && previousKey !== key) {
      await storage()
        .remove(previousKey)
        .catch((err: unknown) => console.warn(`[pinwren] could not remove old export ${previousKey}`, err));
    }
  } catch (err) {
    console.error(`[pinwren] project export ${projectId} failed`, err);
    await writeState(orgId, projectId, {
      ...state,
      status: "failed",
      finishedAt: new Date().toISOString(),
      error: err instanceof Error ? err.message.slice(0, 300) : "Export failed",
    });
  }
}

/** Everything the project holds that a person would want back: no secrets, no rate-limit state. */
export async function buildProjectArchive(
  orgId: string,
  projectId: string,
): Promise<{ zip: Uint8Array; items: number; assets: number; skipped: number }> {
  const db = getDb();
  const p = await assertProject(orgId, projectId);
  const { actionSecret: _a, identitySecret: _i, rejectedOrigins: _r, ...projectData } = p;

  const items: Record<string, unknown>[] = [];
  const entries: ZipEntry[] = [];
  let assetBytes = 0;
  let assets = 0;
  let skipped = 0;
  const labels = await db.select().from(label).where(eq(label.projectId, projectId));
  const labelName = new Map(labels.map((l) => [l.id, l.name]));

  let after = 0;
  for (;;) {
    const rows = await db
      .select({ f: feedback, pageUrl: page.url })
      .from(feedback)
      .leftJoin(page, eq(page.id, feedback.pageId))
      .where(and(eq(feedback.projectId, projectId), isNull(feedback.deletedAt), gt(feedback.number, after)))
      .orderBy(asc(feedback.number))
      .limit(PAGE);
    if (!rows.length) break;
    const ids = rows.map((r) => r.f.id);
    const [comments, events, files, tags] = await Promise.all([
      db
        .select({ c: comment, authorName: user.name, authorEmail: user.email })
        .from(comment)
        .leftJoin(user, eq(user.id, comment.authorId))
        .where(inArray(comment.feedbackId, ids))
        .orderBy(asc(comment.createdAt)),
      db.select().from(activity).where(inArray(activity.feedbackId, ids)).orderBy(asc(activity.createdAt)),
      db.select().from(feedbackAsset).where(inArray(feedbackAsset.feedbackId, ids)),
      db.select().from(feedbackLabel).where(inArray(feedbackLabel.feedbackId, ids)),
    ]);
    for (const { f, pageUrl } of rows) {
      const { search: _s, reporterTokenHash: _t, ...data } = f;
      const own = files.filter((a) => a.feedbackId === f.id);
      const assetOut: Record<string, unknown>[] = [];
      for (const a of own) {
        const path = `assets/${f.number}/${a.id}.${EXTENSIONS[a.contentType] ?? "bin"}`;
        const fits = assetBytes + a.bytes <= EXPORT_MAX_ASSET_BYTES && entries.length + 3 < ZIP_MAX_ENTRIES;
        const file = fits
          ? await storage()
              .get(a.storageKey)
              .catch(() => null)
          : null;
        if (file) {
          const bytes = await readAll(file.body);
          entries.push({ name: path, data: bytes, modified: a.createdAt });
          assetBytes += bytes.length;
          assets++;
        } else {
          skipped++;
        }
        assetOut.push({
          id: a.id,
          kind: a.kind,
          contentType: a.contentType,
          bytes: a.bytes,
          name: a.name,
          meta: a.meta,
          annotations: a.annotations,
          capture: a.capture,
          createdAt: a.createdAt,
          file: file ? path : null,
        });
      }
      items.push({
        ...data,
        pageUrl,
        labels: tags.filter((t) => t.feedbackId === f.id).map((t) => labelName.get(t.labelId) ?? t.labelId),
        comments: comments
          .filter((c) => c.c.feedbackId === f.id)
          .map(({ c, authorName, authorEmail }) => ({
            id: c.id,
            body: c.body,
            visibility: c.visibility,
            author: c.authorId ? { id: c.authorId, name: authorName, email: authorEmail } : null,
            authorGuest: c.authorGuest,
            createdAt: c.createdAt,
            editedAt: c.editedAt,
          })),
        activity: events
          .filter((e) => e.feedbackId === f.id)
          .map((e) => ({
            type: e.type,
            actorKind: e.actorKind,
            actorId: e.actorId,
            data: e.data,
            at: e.createdAt,
          })),
        assets: assetOut,
      });
    }
    after = rows[rows.length - 1]?.f.number ?? after;
    if (rows.length < PAGE) break;
  }

  const zip = buildZip([
    {
      name: "README.txt",
      data: new TextEncoder().encode(
        [
          `Pinwren export of "${p.name}", ${new Date().toISOString()}`,
          "",
          "project.json   the project's settings (secrets left out)",
          "labels.json    the project's labels",
          "feedback.json  every item with its comments, activity and file list",
          "assets/        screenshots, attachments and replays, by item number",
          skipped ? `\n${skipped} file(s) were left out (missing, or past the export size cap).` : "",
        ].join("\n"),
      ),
    },
    { name: "project.json", data: json(projectData), deflate: true },
    { name: "labels.json", data: json(labels), deflate: true },
    { name: "feedback.json", data: json(items), deflate: true },
    ...entries,
  ]);
  return { zip, items: items.length, assets, skipped };
}
