import { Pinwren } from "@pinwren/sdk";

type Fetch = typeof fetch;

export type FeedbackListOptions = {
  project?: string | undefined;
  status?: string | undefined;
  kind?: string | undefined;
  text?: string | undefined;
  limit?: number | undefined;
};

const client = (url: string, token: string, fetchImpl?: Fetch) =>
  new Pinwren({ url, token, ...(fetchImpl ? { fetch: fetchImpl } : {}), userAgent: "pinwren-cli" });

/** One line per item for a terminal. Reporter text is cut to one line and stripped of control characters. */
const oneLine = (s: string | null | undefined, n: number) => {
  const t = (s ?? "").replace(/[\p{Cc}]+/gu, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export async function listFeedback(url: string, token: string, o: FeedbackListOptions, fetchImpl?: Fetch) {
  const page = await client(url, token, fetchImpl).feedback.list({
    ...(o.project ? { projectId: o.project } : {}),
    ...(o.status ? { status: o.status as never } : {}),
    ...(o.kind ? { kind: o.kind as never } : {}),
    ...(o.text ? { q: o.text } : {}),
    limit: o.limit ?? 20,
  });
  return page;
}

export function formatList(page: Awaited<ReturnType<typeof listFeedback>>): string {
  if (!page.items.length) return "No feedback matches.";
  const lines = page.items.map(
    (i) =>
      `#${String(i.number).padEnd(5)} ${i.id}  ${i.status.padEnd(11)} ${i.priority.padEnd(6)} ${i.kind.padEnd(8)} ${oneLine(i.title ?? i.body, 60)}`,
  );
  if (page.nextCursor) lines.push("… more results: narrow the filters or raise --limit");
  return lines.join("\n");
}

export async function getFeedback(url: string, token: string, id: string, fetchImpl?: Fetch) {
  return client(url, token, fetchImpl).feedback.get(id);
}

export function formatDetail(d: Awaited<ReturnType<typeof getFeedback>>): string {
  const f = d.feedback;
  const lines = [
    `#${f.number} ${oneLine(f.title ?? f.body, 100)}`,
    `${f.projectName} · ${f.kind} · ${f.status} · ${f.priority}`,
    f.pageUrl ? `Page: ${oneLine(f.pageUrl, 200)}` : "",
    "",
    f.body,
  ];
  return lines.filter((l, i) => l !== "" || i > 1).join("\n");
}

export async function briefFor(url: string, token: string, id: string, fetchImpl?: Fetch) {
  return client(url, token, fetchImpl).feedback.brief(id);
}

export async function reproFor(url: string, token: string, id: string, fetchImpl?: Fetch) {
  return client(url, token, fetchImpl).feedback.reproTest(id);
}
