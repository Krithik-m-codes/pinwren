import { polishReproTest } from "@pinwren/ai";
import type { ApiAgentBrief, ApiReproTest } from "@pinwren/core";
import { getDb, issueIntegration } from "@pinwren/db";
import { and, asc, eq } from "drizzle-orm";
import { buildAgentBrief } from "../handoff/brief";
import { generateReproTest } from "../handoff/repro-test";
import { env } from "../env";
import { feedbackLink } from "./feedback-payload";
import { getAiClientForOrg } from "./ai";
import { loadReproInput, type ReproInput } from "./reproduction";

// Agent hand-off (brief) and draft repro test. Both are views over the same stored, masked data that
// `reproductionContext` reads: nothing here touches the replay bytes beyond that summary.

async function repoOf(projectId: string) {
  const [row] = await getDb()
    .select({ provider: issueIntegration.provider, repo: issueIntegration.repo })
    .from(issueIntegration)
    .where(and(eq(issueIntegration.projectId, projectId), eq(issueIntegration.active, true)))
    .orderBy(asc(issueIntegration.provider));
  // Linear team keys and Jira project keys are not code locations.
  return row && (row.provider === "github" || row.provider === "gitlab")
    ? { provider: row.provider as string, path: row.repo }
    : null;
}

function briefOf(orgId: string, input: ReproInput, repo: { provider: string; path: string } | null) {
  const f = input.f;
  return buildAgentBrief({
    id: f.id,
    number: f.number,
    title: f.title?.trim() || f.body.slice(0, 80),
    body: f.body,
    kind: f.kind,
    status: f.status,
    priority: f.priority,
    projectName: input.projectName,
    pageUrl: input.pageUrl,
    anchor: input.anchor,
    env: input.env,
    steps: input.timeline,
    errors: input.errors,
    failing: input.failing,
    replay: input.replay,
    hasScreenshot: input.screenshotAssetId !== null,
    reportUrl: feedbackLink(orgId, f.id),
    instanceUrl: env().PINWREN_URL.replace(/\/+$/, ""),
    repo,
  });
}

export async function agentBrief(orgId: string, id: string): Promise<ApiAgentBrief> {
  const input = await loadReproInput(orgId, id);
  return briefOf(orgId, input, await repoOf(input.f.projectId));
}

/** The brief as a string, for the `action.run` webhook of an agent action. */
export async function agentBriefMarkdown(orgId: string, id: string): Promise<string> {
  return (await agentBrief(orgId, id)).markdown;
}

const looksLikeTest = (code: string) =>
  code.includes("@playwright/test") && /\btest\s*(\.\w+)?\s*\(/.test(code);

export async function reproTest(
  orgId: string,
  id: string,
  options: { polish?: boolean } = {},
): Promise<ApiReproTest> {
  const input = await loadReproInput(orgId, id);
  const f = input.f;
  const draft = generateReproTest({
    number: f.number,
    title: f.title?.trim() || f.body.slice(0, 80),
    pageUrl: input.pageUrl,
    viewport: input.env.viewport,
    anchor: input.anchor,
    trace: input.trace,
    errors: input.errors,
    failing: input.failing,
    reportUrl: feedbackLink(orgId, f.id),
  });
  let code = draft.code;
  let polished = false;
  if (options.polish) {
    // Throws AI_NOT_CONFIGURED (400) when no provider is set up; the caller sees that as is.
    const client = await getAiClientForOrg(orgId);
    const out = await polishReproTest(client.provider, { code: draft.code });
    if (looksLikeTest(out) && out.includes("DRAFT")) {
      code = out;
      polished = true;
    }
  }
  return {
    feedbackId: f.id,
    filename: draft.filename,
    language: draft.language,
    code,
    caveats: polished
      ? [
          ...draft.caveats,
          "An AI model rewrote this draft; compare it with the original steps before relying on it.",
        ]
      : draft.caveats,
    stats: draft.stats,
    polished,
  };
}
