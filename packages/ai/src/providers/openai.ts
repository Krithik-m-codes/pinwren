import type { z } from "zod";
import type { AiFetch, AiProvider, CompleteOptions } from "../types";
import { DEFAULT_AI_TIMEOUT_MS, parseJsonWithSchema } from "./base";

export class OpenAiProvider implements AiProvider {
  readonly id = "openai" as const;
  readonly model: string;
  private readonly apiKey?: string | undefined;
  private readonly baseUrl: string;
  private readonly fetch: AiFetch;

  constructor(options: {
    model: string;
    apiKey?: string | undefined;
    baseUrl?: string | undefined;
    fetch?: AiFetch | undefined;
  }) {
    this.model = options.model;
    this.fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.apiKey = options.apiKey;
    const cleanUrl = options.baseUrl?.replace(/\/+$/, "") || "https://api.openai.com/v1";
    this.baseUrl = cleanUrl.endsWith("/v1") ? cleanUrl : `${cleanUrl}/v1`;
  }

  async complete<T>(prompt: string, schema: z.ZodType<T>, options?: CompleteOptions): Promise<T> {
    if (!this.apiKey) {
      throw new Error("OpenAI API key is not configured");
    }

    const timeoutMs = options?.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const messages: { role: string; content: string }[] = [];
      const systemInstruction =
        (options?.system ? `${options.system}\n\n` : "") +
        "You MUST respond ONLY with a valid JSON object matching the requested schema.";

      messages.push({ role: "system", content: systemInstruction });
      messages.push({ role: "user", content: prompt });

      const response = await this.fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          response_format: { type: "json_object" },
          messages,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OpenAI API error (HTTP ${response.status})`);
      }

      const data = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error("OpenAI API returned an empty response");
      }

      return parseJsonWithSchema(content, schema);
    } finally {
      clearTimeout(timer);
    }
  }

  async embed(text: string): Promise<number[]> {
    if (!this.apiKey) {
      throw new Error("OpenAI API key is not configured for embeddings");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_AI_TIMEOUT_MS);

    try {
      const response = await this.fetch(`${this.baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: "text-embedding-3-small",
          input: text,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`OpenAI embeddings error (HTTP ${response.status})`);
      }

      const data = (await response.json()) as {
        data?: { embedding?: number[] }[];
      };

      const embedding = data.data?.[0]?.embedding;
      if (!embedding) {
        throw new Error("OpenAI embeddings returned empty result");
      }

      return embedding;
    } finally {
      clearTimeout(timer);
    }
  }
}
