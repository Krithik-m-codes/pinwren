import type { z } from "zod";
import type { AiFetch, AiProvider, CompleteOptions } from "../types";
import { DEFAULT_AI_TIMEOUT_MS, parseJsonWithSchema, trimTrailingSlashes } from "./base";

export class AnthropicProvider implements AiProvider {
  readonly id = "anthropic" as const;
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
    this.baseUrl = trimTrailingSlashes(options.baseUrl ?? "") || "https://api.anthropic.com";
  }

  async complete<T>(prompt: string, schema: z.ZodType<T>, options?: CompleteOptions): Promise<T> {
    if (!this.apiKey) {
      throw new Error("Anthropic API key is not configured");
    }

    const timeoutMs = options?.timeoutMs ?? DEFAULT_AI_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 2048,
          system:
            (options?.system ? `${options.system}\n\n` : "") +
            "You MUST respond ONLY with a valid raw JSON object matching the requested schema. Do not enclose in markdown ticks if possible, and include no introductory or concluding text.",
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Anthropic API error (HTTP ${response.status})`);
      }

      const data = (await response.json()) as {
        content?: { type: string; text?: string }[];
      };

      const textBlock = data.content?.find((c) => c.type === "text");
      if (!textBlock?.text) {
        throw new Error("Anthropic API returned an empty response");
      }

      return parseJsonWithSchema(textBlock.text, schema);
    } finally {
      clearTimeout(timer);
    }
  }
}
