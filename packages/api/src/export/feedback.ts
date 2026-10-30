import { type FeedbackStatus, feedbackListQuery, kindLabel } from "@pinwren/core";
import { getDb, member, project, user, withOrg } from "@pinwren/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { feedbackLink } from "../services/feedback-payload";
import { listFeedback } from "../services/feedback";
import { csvCell } from "./csv";
import { renderPdf } from "./pdf";

// Inbox export (wave-5 contract §3.4): `GET /api/feedback/export?format=csv|json|pdf&<list filters>`.
// CSV and JSON stream page by page, so an export of every item never sits in memory; a PDF is laid out
// in one go and is capped at MAX_PDF_ITEMS.

export const FEEDBACK_EXPORT_FORMATS = ["csv", "json", "pdf"] as const;
const MAX_EXPORT_IDS = 500;
export const MAX_PDF_ITEMS = 1000;
const PAGE = 100;
/** So Excel opens UTF-8 correctly (as in export/csv.ts). */
const BOM = String.fromCharCode(0xfeff);

/** The list filters (no paging) plus the format and, for "Export selected", the item ids. */
export const feedbackExportQuery = feedbackListQuery.omit({ cursor: true, limit: true }).extend({
  format: z.enum(FEEDBACK_EXPORT_FORMATS).default("csv"),
  ids: z
    .string()
    .max(MAX_EXPORT_IDS * 37)
    .transform((s) => s.split(",").filter(Boolean))
    .pipe(z.array(z.uuid()).min(1).max(MAX_EXPORT_IDS))
    .optional(),
});
export type FeedbackExportQuery = z.infer<typeof feedbackExportQuery>;

type Row = Awaited<ReturnType<typeof listFeedback>>["items"][number];

/** One exported item, the same in every format. */
export type ExportItem = {
  id: string;
  number: number;
  project: string;
  kind: string;
  status: FeedbackStatus;
  priority: string;
  title: string | null;
  body: string;
  reporterName: string | null;
  reporterEmail: string | null;
  page: string | null;
  labels: string[];
  assignees: string[];
  createdAt: string;
  updatedAt: string;
  dueAt: string | null;
  link: string;
};

export const EXPORT_COLUMNS = [
  "number",
  "project",
  "kind",
  "status",
  "priority",
  "title",
  "body",
  "reporter",
  "reporter_email",
  "page",
  "labels",
  "assignees",
  "created",
  "updated",
  "due",
  "link",
] as const;

export function exportItem(orgId: string, f: Row, names: Map<string, string>): ExportItem {
  return {
    id: f.id,
    number: f.number,
    project: f.projectName,
    kind: f.kind,
    status: f.status,
    priority: f.priority,
    title: f.title,
    body: f.body,
    reporterName: f.reporterGuest?.name ?? null,
    reporterEmail: f.reporterGuest?.email ?? null,
    page: f.pageUrl,
    labels: f.labels.map((l) => l.name),
    assignees: f.assigneeIds.map((id) => names.get(id) ?? "former member"),
    createdAt: f.createdAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
    dueAt: f.dueAt?.toISOString() ?? null,
    link: feedbackLink(orgId, f.id),
  };
}

/** One CSV record (CRLF-terminated), in EXPORT_COLUMNS order, formula-safe (export/csv.ts). */
export function csvLine(i: ExportItem): string {
  return `${[
    i.number,
    i.project,
    i.kind,
    i.status,
    i.priority,
    i.title,
    i.body,
    i.reporterName,
    i.reporterEmail,
    i.page,
    i.labels.join("; "),
    i.assignees.join("; "),
    i.createdAt,
    i.updatedAt,
    i.dueAt,
    i.link,
  ]
    .map(csvCell)
    .join(",")}\r\n`;
}

/** Every matching item, a page at a time. */
async function* exportPages(orgId: string, q: FeedbackExportQuery) {
  const { format: _format, ids, ...filters } = q;
  let cursor: string | undefined;
  for (;;) {
    const page = await withOrg(orgId, () =>
      listFeedback(
        orgId,
        { ...filters, limit: PAGE, ...(cursor ? { cursor } : {}) },
        { count: false, ...(ids ? { ids } : {}) },
      ),
    );
    yield page.items;
    if (!page.nextCursor) return;
    cursor = page.nextCursor;
  }
}

async function memberNames(orgId: string) {
  const rows = await getDb()
    .select({ id: user.id, name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(eq(member.organizationId, orgId));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Safe for a Content-Disposition filename: letters, digits, dot, dash, underscore. */
const fileSlug = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "feedback";

const STATUS_TEXT: Record<FeedbackStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  in_review: "In review",
  resolved: "Resolved",
  wont_fix: "Won't fix",
  duplicate: "Duplicate",
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const HEADERS = {
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  pdf: "application/pdf",
} as const;

export async function exportFeedback(orgId: string, q: FeedbackExportQuery): Promise<Response> {
  const [names, projectName] = await withOrg(orgId, () =>
    Promise.all([
      memberNames(orgId),
      q.projectId
        ? getDb()
            .select({ name: project.name })
            .from(project)
            .where(and(eq(project.id, q.projectId), eq(project.orgId, orgId)))
            .then((r) => r[0]?.name ?? null)
        : Promise.resolve(null),
    ]),
  );
  const day = new Date().toISOString().slice(0, 10);
  const filename = `${fileSlug(projectName ?? "pinwren")}-feedback-${day}.${q.format}`;
  const headers = {
    "content-type": HEADERS[q.format],
    "content-disposition": `attachment; filename="${filename}"`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
  };

  if (q.format === "pdf") {
    const items: ExportItem[] = [];
    for await (const page of exportPages(orgId, q)) {
      for (const f of page) if (items.length < MAX_PDF_ITEMS) items.push(exportItem(orgId, f, names));
      if (items.length >= MAX_PDF_ITEMS) break;
    }
    const capped = items.length >= MAX_PDF_ITEMS ? ` (first ${MAX_PDF_ITEMS}; use CSV for all)` : "";
    const body = renderPdf({
      title: `${projectName ?? "All projects"} — feedback`,
      subtitle: `${items.length} items${capped} · exported ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`,
      items: items.map((i) => ({
        heading: `#${i.number} ${i.title?.trim() || i.body.slice(0, 80)}`,
        meta: [
          projectName ? null : i.project,
          kindLabel(i.kind),
          STATUS_TEXT[i.status],
          i.priority === "none" ? null : `${cap(i.priority)} priority`,
          i.labels.length ? i.labels.join(", ") : null,
          i.reporterName ? `from ${i.reporterName}` : null,
          i.createdAt.slice(0, 10),
          i.page,
        ]
          .filter(Boolean)
          .join(" · "),
        body: `${i.body}\n${i.link}`,
      })),
    });
    return new Response(body, { headers });
  }

  const encoder = new TextEncoder();
  const pages = exportPages(orgId, q);
  let first = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const head =
        q.format === "csv"
          ? `${BOM}${EXPORT_COLUMNS.join(",")}\r\n`
          : `{"exportedAt":${JSON.stringify(new Date().toISOString())},"items":[`;
      controller.enqueue(encoder.encode(head));
    },
    async pull(controller) {
      try {
        const next = await pages.next();
        if (next.done) {
          if (q.format === "json") controller.enqueue(encoder.encode("]}\n"));
          controller.close();
          return;
        }
        const items = next.value.map((f) => exportItem(orgId, f, names));
        let chunk = "";
        for (const i of items) {
          if (q.format === "csv") {
            chunk += csvLine(i);
          } else {
            chunk += `${first ? "" : ","}${JSON.stringify(i)}`;
            first = false;
          }
        }
        if (chunk) controller.enqueue(encoder.encode(chunk));
      } catch (err) {
        console.error("[pinwren] export failed", err);
        controller.error(err);
      }
    },
    async cancel() {
      await pages.return(undefined);
    },
  });
  return new Response(stream, { headers });
}
