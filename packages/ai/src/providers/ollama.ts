import type { z } from "zod";
import type { AiFetch, AiProvider, CompleteOptions } from "../types";
import { DEFAULT_AI_TIMEOUT_MS, parseJsonWithSchema, trimTrailingSlashes } from "./base";

export class OllamaProvider implements AiProvider {
  readonly id = "ollama" as const;
  readonly model: string;
  private readonly baseUrl: string;
  private readonly fetch: AiFetch;

  constructor(options: { model: string; baseUrl?: string | undefined; fetch?: AiFetch | undefined }) {
    this.model = options.model;
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.baseUrl = trimTrailingSlashes(options.baseUrl ?? "") || "http://localhost:11434";
  }

  async complete<T>(prompt: string, schema: z.ZodType<T>, options?: CompleteOptions): Promise<T> {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const messages: { role: string; content: string }[] = [];
      if (options?.system) {
        messages.push({ role: "system", content: options.system });
      }
      messages.push({ role: "user", content: prompt });

      const response = await this.fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          format: "json",
          stream: false,
          messages,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama API error (HTTP ${response.status})`);
      }

      const data = (await response.json()) as {
        message?: { content?: string };
      };

      const content = data.message?.content;
      if (!content) {
        throw new Error("Ollama API returned an empty response");
      }

      return parseJsonWithSchema(content, schema);
    } finally {
      clearTimeout(timer);
    }
  }

  async embed(text: string): Promise<number[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_AI_TIMEOUT_MS);

    try {
      const response = await this.fetch(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt: text,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama embeddings error (HTTP ${response.status})`);
      }

      const data = (await response.json()) as {
        embedding?: number[];
      };

      if (!data.embedding) {
        throw new Error("Ollama embeddings returned empty result");
      }

      return data.embedding;
    } finally {
      clearTimeout(timer);
    }
  }
}
