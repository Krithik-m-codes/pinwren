import { createAiClient, translateText, type AiClient } from "@pinwren/ai";
import { type AiProviderConfig, type AiProviderType, type ProjectAiConfig } from "@pinwren/core";
import { feedback, feedbackAi, feedbackTranslation, getDb, orgSetting, project } from "@pinwren/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "../crypto";
import { ApiError, notFound } from "../errors";

export type StoredOrgAiSettings = {
  provider: AiProviderType;
  model: string;
  baseUrl?: string | undefined;
  enabled: boolean;
  encryptedApiKey?: string | undefined;
};

export type PublicOrgAiSettings = {
  provider: AiProviderType;
  model: string;
  baseUrl?: string | undefined;
  enabled: boolean;
  hasKey: boolean;
};

export function defaultModelForProvider(provider: AiProviderType): string {
  switch (provider) {
    case "anthropic":
      return "claude-3-5-haiku-latest";
    case "openai":
      return "gpt-4o-mini";
    case "ollama":
      return "llama3.2";
  }
}

export async function getOrgAiSettings(orgId: string): Promise<PublicOrgAiSettings> {
  const [row] = await getDb()
    .select({ value: orgSetting.value })
    .from(orgSetting)
    .where(and(eq(orgSetting.orgId, orgId), eq(orgSetting.key, "ai")));

  const stored = (row?.value as StoredOrgAiSettings | undefined) ?? undefined;
  const envProvider = (process.env.AI_PROVIDER as AiProviderType | undefined) || "anthropic";
  const provider = stored?.provider ?? envProvider;
  const defaultModel = defaultModelForProvider(provider);
  const model = stored?.model || process.env.AI_MODEL || defaultModel;
  const baseUrl = stored?.baseUrl || process.env.AI_BASE_URL || undefined;
  const hasKey = Boolean(stored?.encryptedApiKey || process.env.AI_API_KEY || provider === "ollama");
  const enabled = stored?.enabled ?? false;

  return {
    provider,
    model,
    ...(baseUrl ? { baseUrl } : {}),
    enabled,
    hasKey,
  };
}

export async function updateOrgAiSettings(
  orgId: string,
  userId: string,
  input: AiProviderConfig,
): Promise<PublicOrgAiSettings> {
  const [existing] = await getDb()
    .select({ value: orgSetting.value })
    .from(orgSetting)
    .where(and(eq(orgSetting.orgId, orgId), eq(orgSetting.key, "ai")));

  const currentStored = existing?.value as StoredOrgAiSettings | undefined;

  let encryptedApiKey = currentStored?.encryptedApiKey;
  if (input.apiKey && input.apiKey.trim().length > 0) {
    encryptedApiKey = encryptSecret(input.apiKey.trim());
  }

  const updatedValue: StoredOrgAiSettings = {
    provider: input.provider,
    model: input.model.trim(),
    baseUrl: input.baseUrl?.trim() || undefined,
    enabled: input.enabled,
    ...(encryptedApiKey ? { encryptedApiKey } : {}),
  };

  await getDb()
    .insert(orgSetting)
    .values({
      orgId,
      key: "ai",
      value: updatedValue,
      updatedBy: userId,
    })
    .onConflictDoUpdate({
      target: [orgSetting.orgId, orgSetting.key],
      set: {
        value: updatedValue,
        updatedBy: userId,
        updatedAt: new Date(),
      },
    });

  return {
    provider: updatedValue.provider,
    model: updatedValue.model,
    ...(updatedValue.baseUrl ? { baseUrl: updatedValue.baseUrl } : {}),
    enabled: updatedValue.enabled,
    hasKey: Boolean(encryptedApiKey || process.env.AI_API_KEY || input.provider === "ollama"),
  };
}

export async function getAiClientForOrg(orgId: string): Promise<AiClient> {
  const [row] = await getDb()
    .select({ value: orgSetting.value })
    .from(orgSetting)
    .where(and(eq(orgSetting.orgId, orgId), eq(orgSetting.key, "ai")));

  const stored = row?.value as StoredOrgAiSettings | undefined;
  const provider = stored?.provider || (process.env.AI_PROVIDER as AiProviderType | undefined) || "anthropic";
  const model = stored?.model || process.env.AI_MODEL || defaultModelForProvider(provider);
  const baseUrl = stored?.baseUrl || process.env.AI_BASE_URL || undefined;

  let apiKey: string | undefined;
  if (stored?.encryptedApiKey) {
    try {
      apiKey = decryptSecret(stored.encryptedApiKey);
    } catch {
      // If decryption fails, fall back to env key
      apiKey = process.env.AI_API_KEY;
    }
  } else {
    apiKey = process.env.AI_API_KEY;
  }

  if (provider !== "ollama" && !apiKey) {
    throw new ApiError(400, "AI_NOT_CONFIGURED", `No API key configured for AI provider '${provider}'`);
  }

  return createAiClient({
    provider,
    model,
    apiKey,
    baseUrl,
  });
}

export async function testAiConnection(options: {
  provider: AiProviderType;
  model: string;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
}): Promise<{ ok: boolean; latencyMs: number }> {
  const client = createAiClient({
    provider: options.provider,
    model: options.model,
    apiKey: options.apiKey,
    baseUrl: options.baseUrl,
    timeoutMs: 10000,
  });

  const testSchema = z.object({ ok: z.boolean() });
  const start = Date.now();

  await client.complete('Respond ONLY with the json {"ok": true}', testSchema, {
    system: 'You are a healthcheck endpoint. Output ONLY valid json {"ok": true}.',
  });

  const latencyMs = Date.now() - start;
  return { ok: true, latencyMs };
}

export async function getProjectAiConfig(projectId: string, orgId: string): Promise<ProjectAiConfig> {
  const [p] = await getDb()
    .select({ aiConfig: project.aiConfig })
    .from(project)
    .where(and(eq(project.id, projectId), eq(project.orgId, orgId)));

  if (!p) throw notFound("Project");
  return p.aiConfig;
}

export type PartialProjectAiConfig = {
  enabled?: boolean | undefined;
  autoSummary?: boolean | undefined;
  autoSeverity?: boolean | undefined;
  detectDuplicates?: boolean | undefined;
  generateRepro?: boolean | undefined;
  allowReplayInAi?: boolean | undefined;
};

export async function updateProjectAiConfig(
  projectId: string,
  orgId: string,
  patch: PartialProjectAiConfig,
): Promise<ProjectAiConfig> {
  const current = await getProjectAiConfig(projectId, orgId);
  const updated: ProjectAiConfig = {
    enabled: patch.enabled ?? current.enabled,
    autoSummary: patch.autoSummary ?? current.autoSummary,
    autoSeverity: patch.autoSeverity ?? current.autoSeverity,
    detectDuplicates: patch.detectDuplicates ?? current.detectDuplicates,
    generateRepro: patch.generateRepro ?? current.generateRepro,
    allowReplayInAi: patch.allowReplayInAi ?? current.allowReplayInAi,
  };

  await getDb()
    .update(project)
    .set({ aiConfig: updated })
    .where(and(eq(project.id, projectId), eq(project.orgId, orgId)));

  return updated;
}

export async function translateFeedbackReport(
  feedbackId: string,
  orgId: string,
  targetLocale: string,
): Promise<{ targetLocale: string; title: string | null; body: string }> {
  const [cached] = await getDb()
    .select()
    .from(feedbackTranslation)
    .where(
      and(eq(feedbackTranslation.feedbackId, feedbackId), eq(feedbackTranslation.targetLocale, targetLocale)),
    );

  if (cached) {
    return {
      targetLocale: cached.targetLocale,
      title: cached.title,
      body: cached.body,
    };
  }

  const [item] = await getDb()
    .select({ id: feedback.id, title: feedback.title, body: feedback.body })
    .from(feedback)
    .where(and(eq(feedback.id, feedbackId), eq(feedback.orgId, orgId)));

  if (!item) throw notFound("Feedback");

  const client = await getAiClientForOrg(orgId);

  const translatedBody = await translateText(client.provider, {
    text: item.body,
    targetLocale,
    context: "Bug report description",
  });

  let translatedTitle: string | null = null;
  if (item.title) {
    translatedTitle = await translateText(client.provider, {
      text: item.title,
      targetLocale,
      context: "Bug report title",
    });
  }

  await getDb()
    .insert(feedbackTranslation)
    .values({
      feedbackId,
      targetLocale,
      title: translatedTitle,
      body: translatedBody,
    })
    .onConflictDoUpdate({
      target: [feedbackTranslation.feedbackId, feedbackTranslation.targetLocale],
      set: {
        title: translatedTitle,
        body: translatedBody,
      },
    });

  return {
    targetLocale,
    title: translatedTitle,
    body: translatedBody,
  };
}

export async function applyAiTriageSuggestions(
  feedbackId: string,
  orgId: string,
  options: {
    applyTitle?: boolean | undefined;
    applyPriority?: boolean | undefined;
    applyKind?: boolean | undefined;
    linkDuplicate?: boolean | undefined;
  },
): Promise<{ ok: boolean }> {
  const [aiData] = await getDb()
    .select()
    .from(feedbackAi)
    .where(and(eq(feedbackAi.feedbackId, feedbackId), eq(feedbackAi.orgId, orgId)));

  if (!aiData) throw notFound("AI enrichment data");

  const updates: Partial<typeof feedback.$inferInsert> = {};

  if (options.applyTitle && aiData.suggestedTitle) {
    updates.title = aiData.suggestedTitle;
  }
  if (options.applyPriority && aiData.suggestedPriority) {
    updates.priority = aiData.suggestedPriority;
  }
  if (options.applyKind && aiData.suggestedKind) {
    updates.kind = aiData.suggestedKind;
  }
  if (options.linkDuplicate && aiData.duplicateCandidateId) {
    updates.duplicateOfId = aiData.duplicateCandidateId;
    updates.status = "duplicate";
  }

  if (Object.keys(updates).length > 0) {
    await getDb()
      .update(feedback)
      .set(updates)
      .where(and(eq(feedback.id, feedbackId), eq(feedback.orgId, orgId)));
  }

  return { ok: true };
}
