import { feedbackKind, priority } from "@pinwren/core";
import { z } from "zod";
import { TRIAGE_SYSTEM_PROMPT } from "../prompts/templates";
import type { AiProvider } from "../types";

export const severityOutputSchema = z.object({
  priority,
  kind: feedbackKind,
  reason: z.string().trim().min(1),
});

export type SeverityInput = {
  title?: string | null | undefined;
  body: string;
  url?: string | null | undefined;
  consoleErrors?: string[] | undefined;
  networkErrors?:
    { method: string; url: string; status: number; durationMs?: number | undefined }[] | undefined;
};

export type SeverityOutput = z.infer<typeof severityOutputSchema>;

export async function suggestSeverity(provider: AiProvider, input: SeverityInput): Promise<SeverityOutput> {
  const reportParts: string[] = [];
  if (input.title) {
    reportParts.push(`Title: ${input.title}`);
  }
  reportParts.push(`Description: ${input.body}`);
  if (input.url) {
    reportParts.push(`URL: ${input.url}`);
  }

  const diagParts: string[] = [];
  if (input.consoleErrors && input.consoleErrors.length > 0) {
    diagParts.push(`Console Errors (${input.consoleErrors.length}):\n${input.consoleErrors.join("\n")}`);
  }
  if (input.networkErrors && input.networkErrors.length > 0) {
    const lines = input.networkErrors.map(
      (n) => `${n.method} ${n.url} -> Status ${n.status}${n.durationMs ? ` (${n.durationMs}ms)` : ""}`,
    );
    diagParts.push(`Network Errors (${input.networkErrors.length}):\n${lines.join("\n")}`);
  }

  const prompt = [
    `<user_report>`,
    reportParts.join("\n\n"),
    `</user_report>`,
    ...(diagParts.length > 0 ? [`<diagnostics>`, diagParts.join("\n\n"), `</diagnostics>`] : []),
  ].join("\n\n");

  return provider.complete(prompt, severityOutputSchema, {
    system: TRIAGE_SYSTEM_PROMPT,
  });
}
