import { describe, expect, it } from "vitest";
import { createAiClient } from "./client";

describe("createAiClient", () => {
  it("initializes Anthropic provider", () => {
    const client = createAiClient({
      provider: "anthropic",
      apiKey: "sk-ant-test",
      model: "claude-3-5-haiku-latest",
    });
    expect(client.providerId).toBe("anthropic");
  });

  it("initializes Ollama provider with custom baseUrl", () => {
    const client = createAiClient({
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      model: "llama3.2",
    });
    expect(client.providerId).toBe("ollama");
  });

  it("initializes OpenAI provider", () => {
    const client = createAiClient({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
    });
    expect(client.providerId).toBe("openai");
  });
});

describe("extractJsonString and parseJsonWithSchema", () => {
  it("extracts json from markdown fence", async () => {
    const { extractJsonString } = await import("./providers/base");
    const raw = 'Here is the response:\n```json\n{"summary": "All good"}\n```\nHope that helps!';
    expect(extractJsonString(raw)).toBe('{"summary": "All good"}');
  });

  it("parses valid json with zod schema", async () => {
    const { parseJsonWithSchema } = await import("./providers/base");
    const { z } = await import("zod");
    const schema = z.object({ title: z.string() });
    const result = parseJsonWithSchema('```json\n{"title": "Bug report"}\n```', schema);
    expect(result.title).toBe("Bug report");
  });
});
