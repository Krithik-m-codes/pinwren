import type { z } from "zod";
import { AnthropicProvider } from "./providers/anthropic";
import { OllamaProvider } from "./providers/ollama";
import { OpenAiProvider } from "./providers/openai";
import type { AiClient, AiClientOptions, AiProvider, CompleteOptions } from "./types";

export function createAiClient(options: AiClientOptions): AiClient {
  let provider: AiProvider;

  switch (options.provider) {
    case "anthropic":
      provider = new AnthropicProvider({
        model: options.model,
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        fetch: options.fetch,
      });
      break;
    case "openai":
      provider = new OpenAiProvider({
        model: options.model,
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        fetch: options.fetch,
      });
      break;
    case "ollama":
      provider = new OllamaProvider({
        model: options.model,
        baseUrl: options.baseUrl,
        fetch: options.fetch,
      });
      break;
    default: {
      const unsupported = String(options.provider);
      throw new Error(`Unsupported AI provider: ${unsupported}`);
    }
  }

  return {
    providerId: options.provider,
    model: options.model,
    provider,
    complete<T>(prompt: string, schema: z.ZodType<T>, opts?: CompleteOptions) {
      const timeoutMs = opts?.timeoutMs ?? options.timeoutMs;
      return provider.complete(prompt, schema, {
        system: opts?.system,
        timeoutMs,
      });
    },
    embed(text: string) {
      if (!provider.embed) {
        throw new Error(`Provider ${options.provider} does not support embeddings`);
      }
      return provider.embed(text);
    },
  };
}
