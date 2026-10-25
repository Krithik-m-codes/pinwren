import { z } from "zod";
import { SUMMARY_SYSTEM_PROMPT } from "../prompts/templates";
import type { AiProvider } from "../types";

export const summarizeOutputSchema = z.object({
  suggestedTitle: z.string().trim().min(1).max(200),
  summary: z.string().trim().min(1),
});

export type SummarizeInput = {
  title?: string | null | undefined;
  body: string;
  url?: string | null | undefined;
  anchor?: Record<string, unknown> | null | undefined;
};

export type SummarizeOutput = z.infer<typeof summarizeOutputSchema>;

export async function summarizeReport(provider: AiProvider, input: SummarizeInput): Promise<SummarizeOutput> {
  const parts: string[] = [];
  if (input.title) {
    parts.push(`Original Title: ${input.title}`);
  }
  parts.push(`Body: ${input.body}`);
  if (input.url) {
    parts.push(`Page URL: ${input.url}`);
  }
  if (input.anchor) {
    parts.push(`Anchor Context: ${JSON.stringify(input.anchor)}`);
  }

  const prompt = `<user_report>\n${parts.join("\n\n")}\n</user_report>`;

  return provider.complete(prompt, summarizeOutputSchema, {
    system: SUMMARY_SYSTEM_PROMPT,
  });
}
