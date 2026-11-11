import {
  resolveLabelSuggestions,
  suggestLabels,
  suggestSeverity,
  summarizeReport,
  synthesizeReproSteps,
  verifyDuplicate,
} from "@pinwren/ai";
import { projectAiConfigSchema } from "@pinwren/core";
import { diagnostics, feedback, feedbackAi, label, page, project, withOrg } from "@pinwren/db";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { publishDomainEvent } from "../realtime/publish";
import { getAiClientForOrg } from "../services/ai";
import { autoApplySuggestions, recordSuggestions } from "../services/label-suggestions";
import { flagFromDuplicateCandidate } from "../services/regression";

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

type EnrichItem = { title: string | null; body: string; pageUrl: string | null };

/** Ask the model for labels from the project's own set (or one new name) and store them as pending chips. */
async function suggestLabelsFor(
  provider: Parameters<typeof suggestLabels>[0],
  job: AiEnrichJob,
  item: EnrichItem,
  autoApply: boolean,
): Promise<void> {
  const existing = await withOrg(job.orgId, (db) =>
    db
      .select({ id: label.id, name: label.name })
      .from(label)
      .where(and(eq(label.projectId, job.projectId), eq(label.orgId, job.orgId)))
      .limit(100),
  );
  const output = await suggestLabels(provider, {
    title: item.title,
    body: item.body,
    url: item.pageUrl,
    existingLabels: existing.map((l) => l.name),
    allowNew: true,
  });
  const suggestions = resolveLabelSuggestions(output, existing, { allowNew: true });
  if (!suggestions.length) return;
  await withOrg(job.orgId, async () => {
    const stored = await recordSuggestions(job.orgId, job.feedbackId, suggestions);
    if (autoApply) await autoApplySuggestions(job.orgId, job.feedbackId, stored);
  });
}

export async function runAiEnrichmentJob(job: AiEnrichJob): Promise<{
  status: "completed" | "skipped" | "failed";
  reason?: string;
  error?: string;
}> {
  // 1. Check if AI is enabled for this project
  const [p] = await withOrg(job.orgId, (db) =>
    db
      .select({ aiConfig: project.aiConfig, widgetConfig: project.widgetConfig })
      .from(project)
      .where(and(eq(project.id, job.projectId), eq(project.orgId, job.orgId))),
  );

  if (!p) return { status: "skipped", reason: "Project not found" };

  if (!p.aiConfig.enabled) {
    await withOrg(job.orgId, (db) =>
      db
        .insert(feedbackAi)
        .values({
          feedbackId: job.feedbackId,
          orgId: job.orgId,
          status: "skipped",
        })
        .onConflictDoUpdate({
          target: feedbackAi.feedbackId,
          set: { status: "skipped" },
        }),
    );
    return { status: "skipped", reason: "AI disabled for project" };
  }

  // 2. EU Privacy Mode check (F-021)
  const widgetConfig = p.widgetConfig as { privacyMode?: boolean };
  const isPrivacyMode = process.env.PINWREN_EU_PRIVACY === "true" || widgetConfig.privacyMode === true;

  if (isPrivacyMode) {
    await withOrg(job.orgId, (db) =>
      db
        .insert(feedbackAi)
        .values({
          feedbackId: job.feedbackId,
          orgId: job.orgId,
          status: "skipped",
        })
        .onConflictDoUpdate({
          target: feedbackAi.feedbackId,
          set: { status: "skipped" },
        }),
    );
    return { status: "skipped", reason: "EU privacy mode enabled" };
  }

  // 3. Resolve AI provider
  let client;
  try {
    client = await getAiClientForOrg(job.orgId);
  } catch (err) {
    const error = (err as Error).message;
    await withOrg(job.orgId, (db) =>
      db
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
        }),
    );
    return { status: "failed", error };
  }

  // 4. Load feedback item and technical diagnostics
  const [item] = await withOrg(job.orgId, (db) =>
    db
      .select({
        id: feedback.id,
        title: feedback.title,
        body: feedback.body,
        anchor: feedback.anchor,
        pageUrl: page.url,
      })
      .from(feedback)
      .leftJoin(page, eq(page.id, feedback.pageId))
      .where(
        and(
          eq(feedback.id, job.feedbackId),
          eq(feedback.orgId, job.orgId),
          eq(feedback.projectId, job.projectId),
        ),
      ),
  );

  if (!item) {
    return { status: "skipped", reason: "Feedback item not found" };
  }

  const [diag] = await withOrg(job.orgId, (db) =>
    db.select().from(diagnostics).where(eq(diagnostics.feedbackId, job.feedbackId)),
  );

  const consoleLogs = consoleErrorLines(diag?.console);
  const networkLogs = failedRequests(diag?.network);

  try {
    // 5. Execute enabled AI tasks
    let summary: Awaited<ReturnType<typeof summarizeReport>> | undefined;
    if (p.aiConfig.autoSummary) {
      summary = await summarizeReport(client.provider, {
        title: item.title,
        body: item.body,
        url: item.pageUrl,
        anchor: item.anchor as Record<string, unknown> | null,
      });
    }

    let triage: Awaited<ReturnType<typeof suggestSeverity>> | undefined;
    if (p.aiConfig.autoSeverity) {
      triage = await suggestSeverity(client.provider, {
        title: item.title,
        body: item.body,
        url: item.pageUrl,
        consoleErrors: consoleLogs,
        networkErrors: networkLogs,
      });
    }

    let duplicate: Awaited<ReturnType<typeof verifyDuplicate>> | undefined;
    let duplicateId: string | null = null;
    if (p.aiConfig.detectDuplicates) {
      // Find candidate open items in the same project
      const candidates = await withOrg(job.orgId, (db) =>
        db
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
          .limit(10),
      );

      duplicate = await verifyDuplicate(client.provider, {
        target: { title: item.title, body: item.body, url: item.pageUrl },
        candidates,
      });
      // Only an id from the list the model was shown: a made-up one could name another project's item.
      const candidateId = duplicate.candidateId;
      if (duplicate.isDuplicate && candidates.some((c) => c.id === candidateId)) duplicateId = candidateId;
    }

    let repro: Awaited<ReturnType<typeof synthesizeReproSteps>> | undefined;
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
    await withOrg(job.orgId, (db) =>
      db
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
        }),
    );

    // 6a. The AI thinks this is a copy of a resolved bug: that is a regression signal (ADR 0033), so flag it
    // the same way the signature detector does. Never lets a failure here lose the enrichment just recorded.
    if (duplicateId) {
      try {
        await withOrg(job.orgId, () =>
          flagFromDuplicateCandidate(job.orgId, job.feedbackId, duplicateId, duplicate?.confidence),
        );
      } catch (err) {
        console.warn("[pinwren] regression flag from AI failed", err);
      }
    }

    // 6b. Label suggestions. Separate from the tasks above: only the text and page URL are sent (no
    // screenshot, replay or captured logs), and a failure here never loses the enrichment just recorded.
    // Projects saved before the label switches existed lack them: parse fills the defaults.
    const labels = projectAiConfigSchema.parse(p.aiConfig);
    if (labels.autoLabels) {
      try {
        await suggestLabelsFor(client.provider, job, item, labels.autoApplyLabels);
      } catch (err) {
        console.warn("[pinwren] AI label suggestions failed", err);
      }
    }

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
    await withOrg(job.orgId, (db) =>
      db
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
        }),
    );
    return { status: "failed", error };
  }
}
