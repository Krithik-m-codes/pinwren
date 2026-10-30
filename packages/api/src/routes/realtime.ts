import { presenceUpdate, STREAM_PING_MS, streamQuery } from "@pinwren/core";
import { afterOrgCommit, feedback, getDb, project, user, withOrg } from "@pinwren/db";
import { zValidator } from "@hono/zod-validator";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SessionVars } from "../context";
import { ApiError, notFound } from "../errors";
import { type Delivered, publish, subscribe } from "../realtime/bus";

/**
 * A stream ends after this long and the browser reconnects (EventSource does it on its own, with
 * `Last-Event-ID`), so the session is re-checked regularly and revoked access doesn't linger.
 */
const MAX_STREAM_MS = 15 * 60_000;

/** `GET /api/stream` (SSE) and `POST /api/presence` — wave-4 contract §1. */
export const realtime = new Hono<{ Variables: SessionVars }>()
  .get("/stream", zValidator("query", streamQuery), async (c) => {
    const { projectIds } = c.req.valid("query");
    const orgId = c.var.orgId;
    if (projectIds.length) {
      const found = await withOrg(orgId, (db) =>
        db
          .select({ id: project.id })
          .from(project)
          .where(and(eq(project.orgId, orgId), inArray(project.id, projectIds))),
      );
      if (found.length !== new Set(projectIds).size) throw notFound("Project");
    }
    const lastEventId = c.req.header("last-event-id") ?? c.req.query("lastEventId") ?? null;

    // no-transform keeps compression middleware (and proxies) from buffering the stream.
    c.header("cache-control", "no-cache, no-transform");
    c.header("x-accel-buffering", "no");
    return streamSSE(c, async (stream) => {
      let chain = Promise.resolve();
      let closed = false;
      const write = (m: Delivered) => {
        if (closed) return;
        chain = chain
          .then(() =>
            stream.writeSSE({ event: m.event, data: JSON.stringify(m.data), ...(m.id ? { id: m.id } : {}) }),
          )
          .catch(() => {
            closed = true;
          });
      };
      const sub = await subscribe(
        {
          orgId,
          userId: c.var.userId,
          projectIds: projectIds.length ? new Set(projectIds) : null,
          send: write,
        },
        lastEventId,
      );
      await stream.write("retry: 3000\n\n");
      // An immediate ping tells the client the subscription is live.
      write({ id: null, event: "ping", data: {} });
      for (const m of sub.backlog) write(m);
      for (const m of sub.presence) write(m);
      const ping = setInterval(() => write({ id: null, event: "ping", data: {} }), STREAM_PING_MS);
      await new Promise<void>((resolve) => {
        const end = setTimeout(resolve, MAX_STREAM_MS);
        stream.onAbort(() => {
          clearTimeout(end);
          resolve();
        });
        c.req.raw.signal.addEventListener("abort", () => {
          clearTimeout(end);
          resolve();
        });
      });
      closed = true;
      clearInterval(ping);
      sub.unsubscribe();
      await chain;
    });
  })

  .post("/presence", zValidator("json", presenceUpdate), async (c) => {
    const { feedbackId } = c.req.valid("json");
    const db = getDb();
    let projectId: string | null = null;
    if (feedbackId) {
      const [f] = await db
        .select({ projectId: feedback.projectId })
        .from(feedback)
        .where(and(eq(feedback.id, feedbackId), eq(feedback.orgId, c.var.orgId), isNull(feedback.deletedAt)));
      if (!f) throw notFound("Feedback");
      projectId = f.projectId;
    }
    const [u] = await db
      .select({ id: user.id, name: user.name, image: user.image })
      .from(user)
      .where(eq(user.id, c.var.userId));
    if (!u) throw new ApiError(401, "UNAUTHORIZED", "Sign in required");
    afterOrgCommit(() => publish({ t: "p", orgId: c.var.orgId, projectId, feedbackId, user: u }));
    return c.json({ ok: true });
  });
