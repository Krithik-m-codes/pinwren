import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createAiClient } from "./client";

describe("createAiClient", () => {
  it("initializes Anthropic provider", () => {
    const client = createAiClient({
      provider: "anthropic",
      apiKey: "sk-ant-test",
      model: "claude-haiku-5-5",
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

describe("provider requests", () => {
  const schema = z.object({ ok: z.boolean() });

  it("sends every request through the injected fetch", async () => {
    const urls: string[] = [];
    const client = createAiClient({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
      baseUrl: "https://llm.example.com",
      fetch: (url) => {
        urls.push(url);
        const body = { choices: [{ message: { content: '{"ok":true}' } }] };
        return Promise.resolve(new Response(JSON.stringify(body)));
      },
    });
    await expect(client.complete("ping", schema)).resolves.toEqual({ ok: true });
    expect(urls).toEqual(["https://llm.example.com/v1/chat/completions"]);
  });

  it("reports the status but never the provider's response body", async () => {
    const client = createAiClient({
      provider: "anthropic",
      apiKey: "sk-ant-test",
      model: "claude-haiku-5-5",
      fetch: () => Promise.resolve(new Response("secret internal detail", { status: 502 })),
    });
    const err = (await client.complete("ping", schema).catch((e: unknown) => e)) as Error;
    expect(err.message).toBe("Anthropic API error (HTTP 502)");
    expect(err.message).not.toContain("secret");
  });
});
