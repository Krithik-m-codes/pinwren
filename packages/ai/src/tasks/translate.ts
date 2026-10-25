import { z } from "zod";
import { TRANSLATE_SYSTEM_PROMPT } from "../prompts/templates";
import type { AiProvider } from "../types";

export const translateOutputSchema = z.object({
  translatedText: z.string().trim().min(1),
});

export type TranslateInput = {
  text: string;
  targetLocale: string;
  context?: string | undefined;
};

export async function translateText(provider: AiProvider, input: TranslateInput): Promise<string> {
  const prompt = [
    `Target Locale: ${input.targetLocale}`,
    input.context ? `Context: ${input.context}` : "",
    `<text_to_translate>`,
    input.text,
    `</text_to_translate>`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await provider.complete(prompt, translateOutputSchema, {
    system: TRANSLATE_SYSTEM_PROMPT,
  });

  return res.translatedText;
}
