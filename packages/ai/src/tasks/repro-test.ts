import { z } from "zod";
import { REPRO_TEST_SYSTEM_PROMPT } from "../prompts/templates";
import type { AiProvider } from "../types";

export const reproTestOutputSchema = z.object({ code: z.string().trim().min(1).max(40_000) });

/**
 * Ask the model to tidy a generated Playwright draft. Only the draft goes in (it was built from masked
 * diagnostics); no replay, screenshot or raw report text is sent. The caller checks the result still
 * looks like a Playwright test before using it.
 */
export async function polishReproTest(provider: AiProvider, input: { code: string }): Promise<string> {
  const res = await provider.complete(`<draft_test>\n${input.code}\n</draft_test>`, reproTestOutputSchema, {
    system: REPRO_TEST_SYSTEM_PROMPT,
  });
  return res.code;
}
