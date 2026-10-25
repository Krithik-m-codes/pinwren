import { z } from "zod";
import { DUPLICATE_SYSTEM_PROMPT } from "../prompts/templates";
import type { AiProvider } from "../types";

export const duplicateOutputSchema = z.object({
  isDuplicate: z.boolean(),
  candidateId: z.string().nullable(),
  confidence: z.number().int().min(0).max(100),
  reason: z.string().trim().min(1),
});

export type DuplicateCandidate = {
  id: string;
  title?: string | null | undefined;
  body: string;
};

export type VerifyDuplicateInput = {
  target: {
    title?: string | null | undefined;
    body: string;
    url?: string | null | undefined;
  };
  candidates: DuplicateCandidate[];
};

export type VerifyDuplicateOutput = z.infer<typeof duplicateOutputSchema>;

export async function verifyDuplicate(
  provider: AiProvider,
  input: VerifyDuplicateInput,
): Promise<VerifyDuplicateOutput> {
  if (input.candidates.length === 0) {
    return {
      isDuplicate: false,
      candidateId: null,
      confidence: 100,
      reason: "No candidate feedback items found to compare against.",
    };
  }

  const candidateBlocks = input.candidates.map(
    (c) => `<candidate id="${c.id}">\nTitle: ${c.title ?? "None"}\nBody: ${c.body}\n</candidate>`,
  );

  const prompt = [
    `<target_report>`,
    `Title: ${input.target.title ?? "None"}`,
    `Body: ${input.target.body}`,
    input.target.url ? `URL: ${input.target.url}` : "",
    `</target_report>`,
    `<existing_candidates>`,
    candidateBlocks.join("\n\n"),
    `</existing_candidates>`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return provider.complete(prompt, duplicateOutputSchema, {
    system: DUPLICATE_SYSTEM_PROMPT,
  });
}
