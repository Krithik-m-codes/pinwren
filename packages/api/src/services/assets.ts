import { withOrg } from "@pinwren/db";
import { feedbackAsset } from "@pinwren/db";
import { and, eq } from "drizzle-orm";
import { notFound } from "../errors";
import { storage } from "../storage";

/**
 * Stream one feedback file (screenshot, attachment, session replay) of the organisation. Shared by the
 * dashboard (session) and the public API (token). Files are always served through the API, sandboxed,
 * never as something other than their checked type.
 */
export async function assetResponse(orgId: string, id: string, range?: string | null): Promise<Response> {
  const [a] = await withOrg(orgId, (db) =>
    db
      .select()
      .from(feedbackAsset)
      .where(and(eq(feedbackAsset.id, id), eq(feedbackAsset.orgId, orgId))),
  );
  if (!a) throw notFound("Asset");
  return respondWithAsset(a, range);
}

/** Stream a looked-up asset row with the sandboxing headers; the caller has already authorised it. */
export async function respondWithAsset(
  a: typeof feedbackAsset.$inferSelect,
  range?: string | null,
): Promise<Response> {
  const file = await storage().get(a.storageKey);
  if (!file) throw notFound("Asset file");
  const headers: Record<string, string> = {
    "content-type": a.contentType,
    "cache-control": "private, max-age=3600",
    "content-security-policy": "default-src 'none'; sandbox",
    "x-content-type-options": "nosniff",
  };
  if (file.bytes) headers["content-length"] = String(file.bytes);
  if (a.kind === "attachment") {
    // Non-images download rather than render (blueprint 09: Content-Disposition for non-images).
    const safe = (a.name ?? "attachment").replace(/[^\w.-]+/g, "_").slice(0, 120) || "attachment";
    const disposition = /^(image|video)\//.test(a.contentType) ? "inline" : "attachment";
    headers["content-disposition"] =
      `${disposition}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(a.name ?? safe)}`;
  }
  // Recordings are played by the browser's own player, which seeks with byte ranges (Safari refuses to play
  // a video from a server that doesn't answer them).
  if (a.contentType.startsWith("video/")) {
    headers["accept-ranges"] = "bytes";
    const total = file.bytes || a.bytes;
    const r = parseRange(range, total);
    if (r === "unsatisfiable") {
      await file.body.cancel().catch(() => undefined);
      return new Response(null, { status: 416, headers: { "content-range": `bytes */${total}` } });
    }
    if (r) {
      headers["content-range"] = `bytes ${r.start}-${r.end}/${total}`;
      headers["content-length"] = String(r.end - r.start + 1);
      return new Response(sliceStream(file.body, r.start, r.end), { status: 206, headers });
    }
  }
  return new Response(file.body, { headers });
}

/** One `bytes=a-b` / `bytes=a-` / `bytes=-n` range of a file of `total` bytes; null to serve all of it. */
export function parseRange(
  header: string | null | undefined,
  total: number,
): { start: number; end: number } | "unsatisfiable" | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? "");
  if (!m || (m[1] === "" && m[2] === "") || total <= 0) return null;
  let start: number;
  let end: number;
  if (m[1] === "") {
    const n = Number(m[2]); // the last n bytes
    if (n === 0) return "unsatisfiable";
    start = Math.max(0, total - n);
    end = total - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? total - 1 : Math.min(Number(m[2]), total - 1);
  }
  return start > end || start >= total ? "unsatisfiable" : { start, end };
}

/** Bytes `start..end` (inclusive) of a stream, dropping the rest; stops reading once `end` has passed. */
export function sliceStream(body: ReadableStream, start: number, end: number): ReadableStream {
  const reader = body.getReader();
  let at = 0;
  return new ReadableStream({
    async pull(controller) {
      for (;;) {
        const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array };
        if (done || !value) {
          controller.close();
          return;
        }
        const from = Math.max(start - at, 0);
        const to = Math.min(end + 1 - at, value.length);
        at += value.length;
        if (to > from) controller.enqueue(value.subarray(from, to));
        if (at > end) {
          await reader.cancel().catch(() => undefined);
          controller.close();
          return;
        }
        if (to > from) return;
      }
    },
    cancel: (reason) => reader.cancel(reason),
  });
}
