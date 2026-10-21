import { parseWidgetConfig } from "@annota/core";
import { activity, feedback, getDb, project } from "@annota/db";
import { and, eq, isNull } from "drizzle-orm";
import { decryptSecret, encryptSecret, randomToken } from "../crypto";
import { ApiError, notFound } from "../errors";
import { buildRequest, WEBHOOK_API_VERSION, type WebhookPayload } from "../webhooks/format";
import { loadFeedbackContext } from "./feedback-payload";

// Panel actions (F-016, wave-3 contract §1). Link actions open in the browser; webhook actions are
// POSTed from here, signed with the project's action secret exactly like generic webhooks.

const TIMEOUT_MS = 10_000;
const MAX_MESSAGE = 200;

export type ActionResult = { ok: boolean; status: number; message: string | null; error: string | null };

type ProjectRow = typeof project.$inferSelect;

/** The project's action signing secret, created on first use. */
export async function ensureActionSecret(p: Pick<ProjectRow, "id" | "actionSecret">): Promise<string> {
  if (p.actionSecret) {
    try {
      return decryptSecret(p.actionSecret);
    } catch {
      // Unreadable after an ANNOTA_SECRET change: issue a new one below.
    }
  }
  return rotateActionSecret(p.id);
}

export async function rotateActionSecret(projectId: string): Promise<string> {
  const secret = `whsec_${randomToken(24)}`;
  await getDb()
    .update(project)
    .set({ actionSecret: encryptSecret(secret) })
    .where(eq(project.id, projectId));
  return secret;
}

/** The receiver's `{ "message": "…" }`, if it sent one — shown as a toast. */
function messageOf(text: string): string | null {
  try {
    const j = JSON.parse(text) as { message?: unknown };
    if (typeof j?.message !== "string" || !j.message.trim()) return null;
    const m = j.message.replace(/\s+/g, " ").trim();
    return m.length > MAX_MESSAGE ? `${m.slice(0, MAX_MESSAGE - 1)}…` : m;
  } catch {
    return null;
  }
}

export async function runPanelAction(
  orgId: string,
  userId: string,
  feedbackId: string,
  actionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ActionResult> {
  const db = getDb();
  const [row] = await db
    .select({ p: project })
    .from(feedback)
    .innerJoin(project, eq(project.id, feedback.projectId))
    .where(and(eq(feedback.id, feedbackId), eq(feedback.orgId, orgId), isNull(feedback.deletedAt)));
  if (!row) throw notFound("Feedback");
  const action = parseWidgetConfig(row.p.widgetConfig).panelActions.find((a) => a.id === actionId);
  if (!action) throw new ApiError(404, "ACTION_NOT_FOUND", "This project has no such action");
  if (action.kind !== "webhook") {
    throw new ApiError(400, "NOT_A_WEBHOOK_ACTION", "Link actions open in the browser");
  }
  const ctx = await loadFeedbackContext(feedbackId);
  if (!ctx) throw notFound("Feedback");
  const secret = await ensureActionSecret(row.p);
  const payload: WebhookPayload = {
    id: crypto.randomUUID(),
    event: "action.run",
    apiVersion: WEBHOOK_API_VERSION,
    createdAt: new Date().toISOString(),
    data: {
      feedback: ctx.payload,
      action: { id: action.id, label: action.label },
      actor: { kind: "user", id: userId },
    },
  };
  const req = buildRequest("generic", payload, secret);
  let result: ActionResult;
  try {
    const res = await fetchImpl(action.url, {
      method: "POST",
      headers: req.headers,
      body: req.body,
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text().catch(() => "");
    const ok = res.status >= 200 && res.status < 300;
    result = {
      ok,
      status: res.status,
      message: messageOf(text.slice(0, 64_000)),
      error: ok ? null : `HTTP ${res.status}`,
    };
  } catch (err) {
    const error =
      err instanceof Error
        ? err.name === "TimeoutError"
          ? "timed out after 10 s"
          : err.message
        : "request failed";
    result = { ok: false, status: 0, message: null, error };
  }
  await db.insert(activity).values({
    orgId,
    feedbackId,
    actorId: userId,
    type: "action_run",
    data: {
      actionId: action.id,
      label: action.label,
      ok: result.ok,
      status: result.status,
      message: result.message,
      error: result.error,
    },
  });
  return result;
}
