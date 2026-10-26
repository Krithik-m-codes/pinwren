import { suggestSeverity, summarizeReport, synthesizeReproSteps, verifyDuplicate } from "@pinwren/ai";
import { diagnostics, feedback, feedbackAi, getDb, page, project } from "@pinwren/db";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { publishDomainEvent } from "../realtime/publish";
import { getAiClientForOrg } from "../services/ai";

export type AiEnrichJob = {
  feedbackId: string;
  orgId: string;
  projectId: string;
};

const MAX_LOG_LINES = 20;

/** Error-level console entries the widget captured ({ level, message }), as short lines for the prompt. */
export function consoleErrorLines(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const lines: string[] = [];
  for (const entry of raw as unknown[]) {
    if (typeof entry === "string") {
      lines.push(entry.slice(0, 300));
    } else if (entry && typeof entry === "object") {
      const { level, message } = entry as { level?: unknown; message?: unknown };
      if (typeof message === "string" && (level === "error" || level === "warn" || level === undefined)) {
        lines.push(`${typeof level === "string" ? level : "error"}: ${message.slice(0, 300)}`);
      }
    }
    if (lines.length >= MAX_LOG_LINES) break;
  }
  return lines;
}

/** Failed requests only, without query strings (they can carry tokens). */
export function failedRequests(
  raw: unknown,
): { method: string; url: string; status: number; durationMs?: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { method: string; url: string; status: number; durationMs?: number }[] = [];
  for (const entry of raw as unknown[]) {
    if (!entry || typeof entry !== "object") continue;
    const n = entry as { method?: unknown; url?: unknown; status?: unknown; durationMs?: unknown };
    if (typeof n.method !== "string" || typeof n.url !== "string" || typeof n.status !== "number") continue;
    if (n.status > 0 && n.status < 400) continue;
    out.push({
      method: n.method,
      url: n.url.split(/[?#]/)[0]?.slice(0, 300) ?? "",
      status: n.status,
      ...(typeof n.durationMs === "number" ? { durationMs: n.durationMs } : {}),
    });
    if (out.length >= MAX_LOG_LINES) break;
  }
  return out;
}

export async function runAiEnrichmentJob(job: AiEnrichJob): Promise<{
  status: "completed" | "skipped" | "failed";
  reason?: string;
  error?: string;
}> {
  // 1. Check if AI is enabled for this project
  const [p] = await getDb()
    .select({ aiConfig: project.aiConfig, widgetConfig: project.widgetConfig })
    .from(project)
    .where(and(eq(project.id, job.projectId), eq(project.orgId, job.orgId)));

  if (!p?.aiConfig.enabled) {
    await getDb()
      .insert(feedbackAi)
      .values({
        feedbackId: job.feedbackId,
        orgId: job.orgId,
        status: "skipped",
      })
      .onConflictDoUpdate({
        target: feedbackAi.feedbackId,
        set: { status: "skipped" },
      });
    return { status: "skipped", reason: "AI disabled for project" };
  }

  // 2. EU Privacy Mode check (F-021)
  const widgetConfig = p.widgetConfig as { privacyMode?: boolean };
  const isPrivacyMode = process.env.PINWREN_EU_PRIVACY === "true" || widgetConfig.privacyMode === true;

  if (isPrivacyMode) {
    await getDb()
      .insert(feedbackAi)
      .values({
        feedbackId: job.feedbackId,
        orgId: job.orgId,
        status: "skipped",
      })
      .onConflictDoUpdate({
        target: feedbackAi.feedbackId,
        set: { status: "skipped" },
      });
    return { status: "skipped", reason: "EU privacy mode enabled" };
  }

  // 3. Resolve AI provider
  let client;
  try {
    client = await getAiClientForOrg(job.orgId);
  } catch (err) {
    const error = (err as Error).message;
    await getDb()
      .insert(feedbackAi)
      .values({
        feedbackId: job.feedbackId,
        orgId: job.orgId,
        status: "failed",
        error,
      })
      .onConflictDoUpdate({
        target: feedbackAi.feedbackId,
        set: { status: "failed", error },
      });
    return { status: "failed", error };
  }

  // 4. Load feedback item and technical diagnostics
  const [item] = await getDb()
    .select({
      id: feedback.id,
      title: feedback.title,
      body: feedback.body,
      anchor: feedback.anchor,
      pageUrl: page.url,
    })
    .from(feedback)
    .leftJoin(page, eq(page.id, feedback.pageId))
    .where(and(eq(feedback.id, job.feedbackId), eq(feedback.orgId, job.orgId)));

  if (!item) {
    return { status: "skipped", reason: "Feedback item not found" };
  }

  const [diag] = await getDb().select().from(diagnostics).where(eq(diagnostics.feedbackId, job.feedbackId));

  const consoleLogs = consoleErrorLines(diag?.console);
  const networkLogs = failedRequests(diag?.network);

  try {
    // 5. Execute enabled AI tasks
    let summary;
    if (p.aiConfig.autoSummary) {
      summary = await summarizeReport(client.provider, {
        title: item.title,
        body: item.body,
        url: item.pageUrl,
        anchor: item.anchor as Record<string, unknown> | null,
      });
    }

    let triage;
    if (p.aiConfig.autoSeverity) {
      triage = await suggestSeverity(client.provider, {
        title: item.title,
        body: item.body,
        url: item.pageUrl,
        consoleErrors: consoleLogs,
        networkErrors: networkLogs,
      });
    }

    let duplicate;
    let duplicateId: string | null = null;
    if (p.aiConfig.detectDuplicates) {
      // Find candidate open items in the same project
      const candidates = await getDb()
        .select({
          id: feedback.id,
          title: feedback.title,
          body: feedback.body,
        })
        .from(feedback)
        .where(
          and(
            eq(feedback.projectId, job.projectId),
            ne(feedback.id, job.feedbackId),
            isNull(feedback.deletedAt),
            ne(feedback.status, "duplicate"),
          ),
        )
        .orderBy(desc(feedback.createdAt))
        .limit(10);

      duplicate = await verifyDuplicate(client.provider, {
        target: { title: item.title, body: item.body, url: item.pageUrl },
        candidates,
      });
      // Only an id from the list the model was shown: a made-up one could name another project's item.
      const candidateId = duplicate.candidateId;
      if (duplicate.isDuplicate && candidates.some((c) => c.id === candidateId)) duplicateId = candidateId;
    }

    let repro;
    if (p.aiConfig.generateRepro) {
      repro = await synthesizeReproSteps(client.provider, {
        title: item.title,
        body: item.body,
        url: item.pageUrl,
        consoleErrors: consoleLogs,
        networkErrors: networkLogs,
      });
    }

    // 6. Record enrichment results
    await getDb()
      .insert(feedbackAi)
      .values({
        feedbackId: job.feedbackId,
        orgId: job.orgId,
        suggestedTitle: summary?.suggestedTitle,
        summary: summary?.summary,
        suggestedPriority: triage?.priority,
        suggestedKind: triage?.kind,
        duplicateCandidateId: duplicateId,
        duplicateConfidence: duplicate?.confidence,
        duplicateReason: duplicate?.reason,
        reproductionSteps: repro?.reproductionSteps ?? [],
        status: "completed",
        model: client.model,
      })
      .onConflictDoUpdate({
        target: feedbackAi.feedbackId,
        set: {
          suggestedTitle: summary?.suggestedTitle,
          summary: summary?.summary,
          suggestedPriority: triage?.priority,
          suggestedKind: triage?.kind,
          duplicateCandidateId: duplicateId,
          duplicateConfidence: duplicate?.confidence,
          duplicateReason: duplicate?.reason,
          reproductionSteps: repro?.reproductionSteps ?? [],
          status: "completed",
          model: client.model,
          error: null,
          updatedAt: new Date(),
        },
      });

    // 7. Emit domain update via SSE
    publishDomainEvent({
      type: "feedback.updated",
      orgId: job.orgId,
      feedbackId: job.feedbackId,
      actor: { kind: "integration", id: "ai" },
      changes: { ai: { from: null, to: "completed" } },
    }).catch(() => undefined);

    return { status: "completed" };
  } catch (err) {
    const error = (err as Error).message;
    await getDb()
      .insert(feedbackAi)
      .values({
        feedbackId: job.feedbackId,
        orgId: job.orgId,
        status: "failed",
        error,
      })
      .onConflictDoUpdate({
        target: feedbackAi.feedbackId,
        set: { status: "failed", error },
      });
    return { status: "failed", error };
  }
}
