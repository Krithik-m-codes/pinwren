import { z } from "zod";
import { LABELS_SYSTEM_PROMPT } from "../prompts/templates";
import type { AiProvider } from "../types";

export const MAX_LABEL_SUGGESTIONS = 3;

export const labelSuggestionOutputSchema = z.object({
  labels: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        /** True when the name is not in the list the model was shown. */
        isNew: z.boolean().default(false),
        reason: z.string().trim().max(300).default(""),
      }),
    )
    .max(8),
});
export type LabelSuggestionOutput = z.infer<typeof labelSuggestionOutputSchema>;

/**
 * Only the report's text and page URL are sent: never the screenshot, the replay or the captured
 * console/network logs (the privacy settings of the project keep applying to the other tasks).
 */
export type LabelSuggestionInput = {
  title?: string | null | undefined;
  body: string;
  url?: string | null | undefined;
  existingLabels: string[];
  allowNew: boolean;
};

export async function suggestLabels(
  provider: AiProvider,
  input: LabelSuggestionInput,
): Promise<LabelSuggestionOutput> {
  const report = [
    ...(input.title ? [`Title: ${input.title}`] : []),
    `Description: ${input.body}`,
    ...(input.url ? [`URL: ${input.url}`] : []),
  ].join("\n\n");
  const prompt = [
    `<user_report>`,
    report,
    `</user_report>`,
    `<existing_labels>`,
    input.existingLabels.map((n) => JSON.stringify(n)).join("\n") || "(none)",
    `</existing_labels>`,
    input.allowNew
      ? "You may propose at most one label that is not in <existing_labels> (isNew: true)."
      : "Choose only from <existing_labels>.",
  ].join("\n\n");
  return provider.complete(prompt, labelSuggestionOutputSchema, { system: LABELS_SYSTEM_PROMPT });
}

/**
 * Reconcile the model's answer with reality: a name matching an existing label (any case) becomes that
 * label, anything else is a new-label proposal (only when allowed, at most one); duplicates are dropped.
 * `exclude` holds names already on the item or already suggested.
 */
export function resolveLabelSuggestions(
  output: LabelSuggestionOutput,
  existing: { id: string; name: string }[],
  options: { allowNew: boolean; exclude?: string[] },
): { labelId: string | null; name: string; reason: string }[] {
  const byName = new Map(existing.map((l) => [l.name.toLowerCase(), l]));
  const seen = new Set((options.exclude ?? []).map((n) => n.toLowerCase()));
  const out: { labelId: string | null; name: string; reason: string }[] = [];
  let proposedNew = false;
  for (const s of output.labels) {
    const name = s.name.replace(/\s+/g, " ").trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    const match = byName.get(key);
    if (match) {
      out.push({ labelId: match.id, name: match.name, reason: s.reason });
    } else if (options.allowNew && !proposedNew) {
      proposedNew = true;
      out.push({ labelId: null, name, reason: s.reason });
    } else {
      continue;
    }
    seen.add(key);
    if (out.length >= MAX_LABEL_SUGGESTIONS) break;
  }
  return out;
}
