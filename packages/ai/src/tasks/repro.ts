import { z } from "zod";
import { REPRO_SYSTEM_PROMPT } from "../prompts/templates";
import type { AiProvider } from "../types";

export const reproOutputSchema = z.object({
  reproductionSteps: z.array(z.string().trim().min(1)),
});

export type ReplayActionEvent = {
  type: string;
  target?: string | undefined;
  text?: string | undefined;
  timeOffset?: number | undefined;
};

export type ReproStepInput = {
  title?: string | null | undefined;
  body: string;
  url?: string | null | undefined;
  replayEvents?: ReplayActionEvent[] | undefined;
  consoleErrors?: string[] | undefined;
  networkErrors?: { method: string; url: string; status: number }[] | undefined;
};

export type ReproStepOutput = z.infer<typeof reproOutputSchema>;

export async function synthesizeReproSteps(
  provider: AiProvider,
  input: ReproStepInput,
): Promise<ReproStepOutput> {
  const parts: string[] = [];

  if (input.title) {
    parts.push(`Title: ${input.title}`);
  }
  parts.push(`User description: ${input.body}`);
  if (input.url) {
    parts.push(`URL: ${input.url}`);
  }

  if (input.replayEvents && input.replayEvents.length > 0) {
    const events = input.replayEvents
      .map(
        (e) =>
          `- [${e.timeOffset ? `${e.timeOffset}ms` : "event"}] ${e.type}${e.target ? ` on ${e.target}` : ""}${e.text ? ` ("${e.text}")` : ""}`,
      )
      .join("\n");
    parts.push(`Recorded User Interactions:\n${events}`);
  }

  if (input.consoleErrors && input.consoleErrors.length > 0) {
    parts.push(`Console Errors:\n${input.consoleErrors.join("\n")}`);
  }

  if (input.networkErrors && input.networkErrors.length > 0) {
    const netLines = input.networkErrors.map((n) => `- ${n.method} ${n.url} (${n.status})`).join("\n");
    parts.push(`Failed Network Calls:\n${netLines}`);
  }

  const prompt = `<user_report>\n${parts.join("\n\n")}\n</user_report>`;

  return provider.complete(prompt, reproOutputSchema, {
    system: REPRO_SYSTEM_PROMPT,
  });
}
