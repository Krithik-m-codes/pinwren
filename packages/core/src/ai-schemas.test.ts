import { describe, expect, it } from "vitest";
import { projectAiConfigSchema, aiProviderConfigSchema } from "./schemas";

describe("AI schemas", () => {
  it("validates default project AI config", () => {
    const parsed = projectAiConfigSchema.parse({});
    expect(parsed.enabled).toBe(false);
    expect(parsed.autoSummary).toBe(true);
    expect(parsed.autoSeverity).toBe(true);
    expect(parsed.detectDuplicates).toBe(true);
    expect(parsed.generateRepro).toBe(true);
    expect(parsed.allowReplayInAi).toBe(false);
  });

  it("validates provider config", () => {
    const parsed = aiProviderConfigSchema.parse({
      provider: "anthropic",
      model: "claude-3-5-haiku-latest",
      enabled: true,
    });
    expect(parsed.provider).toBe("anthropic");
  });
});
