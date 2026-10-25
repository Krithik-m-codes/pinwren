import type { AiProviderType } from "@pinwren/core";
import type { z } from "zod";

export type AiClientOptions = {
  provider: AiProviderType;
  model: string;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  timeoutMs?: number | undefined;
};

export type CompleteOptions = {
  system?: string | undefined;
  timeoutMs?: number | undefined;
};

export type AiProvider = {
  readonly id: AiProviderType;
  readonly model: string;
  complete<T>(prompt: string, schema: z.ZodType<T>, options?: CompleteOptions): Promise<T>;
  embed?(text: string): Promise<number[]>;
};

export type AiClient = {
  readonly providerId: AiProviderType;
  readonly model: string;
  readonly provider: AiProvider;
  complete<T>(prompt: string, schema: z.ZodType<T>, options?: CompleteOptions): Promise<T>;
  embed?(text: string): Promise<number[]>;
};
