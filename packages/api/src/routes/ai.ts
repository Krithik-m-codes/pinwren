import { zValidator } from "@hono/zod-validator";
import { aiProviderConfigSchema, aiTranslationRequestSchema, projectAiConfigSchema } from "@pinwren/core";
import { Hono } from "hono";
import { z } from "zod";
import type { SessionVars } from "../context";
import { unauthorized } from "../errors";
import { requirePermission } from "../permissions";
import {
  applyAiTriageSuggestions,
  getOrgAiSettings,
  getProjectAiConfig,
  testAiConnection,
  translateFeedbackReport,
  updateOrgAiSettings,
  updateProjectAiConfig,
} from "../services/ai";

const applyAiSchema = z.object({
  applyTitle: z.boolean().optional(),
  applyPriority: z.boolean().optional(),
  applyKind: z.boolean().optional(),
  linkDuplicate: z.boolean().optional(),
});

const testAiSchema = z
  .object({
    provider: z.enum(["anthropic", "openai", "ollama"]).optional(),
    model: z.string().optional(),
    apiKey: z.string().optional(),
    baseUrl: z
      .url({ protocol: /^https?$/ })
      .optional()
      .or(z.literal("")),
  })
  .optional();

export const aiRoutes = new Hono<{ Variables: SessionVars }>()
  .use(async (c, next) => {
    if (!c.var.userId || !c.var.orgId) throw unauthorized();
    await next();
  })

  // Settings › AI (F-110, F-111, F-112, F-113, F-114)
  .get("/settings/ai", requirePermission("settings.manage"), async (c) => {
    const settings = await getOrgAiSettings(c.var.orgId);
    return c.json(settings);
  })

  .put(
    "/settings/ai",
    requirePermission("settings.manage"),
    zValidator("json", aiProviderConfigSchema),
    async (c) => {
      const input = c.req.valid("json");
      const updated = await updateOrgAiSettings(c.var.orgId, c.var.userId, input);
      return c.json(updated);
    },
  )

  .post(
    "/settings/ai/test",
    requirePermission("settings.manage"),
    zValidator("json", testAiSchema),
    async (c) => {
      const body = c.req.valid("json");
      let provider = body?.provider;
      let model = body?.model;
      const apiKey = body?.apiKey;
      let baseUrl = body?.baseUrl;

      if (!provider || !model) {
        const stored = await getOrgAiSettings(c.var.orgId);
        provider = provider ?? stored.provider;
        model = model ?? stored.model;
        baseUrl = baseUrl ?? stored.baseUrl;
      }

      const res = await testAiConnection({
        provider,
        model,
        apiKey,
        baseUrl: baseUrl || undefined,
      });

      return c.json(res);
    },
  )

  // Project AI Settings
  .get("/projects/:id/ai", async (c) => {
    const projectId = c.req.param("id");
    const config = await getProjectAiConfig(projectId, c.var.orgId);
    return c.json(config);
  })

  .patch(
    "/projects/:id/ai",
    requirePermission("projects.manage"),
    zValidator("json", projectAiConfigSchema.partial()),
    async (c) => {
      const projectId = c.req.param("id");
      const patch = c.req.valid("json");
      const updated = await updateProjectAiConfig(projectId, c.var.orgId, patch);
      return c.json(updated);
    },
  )

  // Feedback Item AI Actions
  .post("/feedback/:id/ai/translate", zValidator("json", aiTranslationRequestSchema), async (c) => {
    const feedbackId = c.req.param("id");
    const { targetLocale } = c.req.valid("json");
    const translation = await translateFeedbackReport(feedbackId, c.var.orgId, targetLocale);
    return c.json(translation);
  })

  .post(
    "/feedback/:id/ai/apply",
    requirePermission("feedback.update"),
    zValidator("json", applyAiSchema),
    async (c) => {
      const feedbackId = c.req.param("id");
      const options = c.req.valid("json");
      const result = await applyAiTriageSuggestions(feedbackId, c.var.orgId, options);
      return c.json(result);
    },
  );
