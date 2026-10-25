import type { z } from "zod";

export const DEFAULT_AI_TIMEOUT_MS = 15000;

export function extractJsonString(raw: string): string {
  const trimmed = raw.trim();
  // Strip markdown code fences if present: ```json ... ``` or ``` ... ```
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(trimmed);
  if (fenceMatch?.[1]) {
    return fenceMatch[1].trim();
  }
  // Find outermost JSON object
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  // Find outermost JSON array
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
    return trimmed.slice(firstBracket, lastBracket + 1);
  }
  return trimmed;
}

export function parseJsonWithSchema<T>(raw: string, schema: z.ZodType<T>): T {
  const jsonStr = extractJsonString(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    throw new Error(
      `Failed to parse AI response as JSON: ${(err as Error).message}. Raw response: ${raw.slice(0, 200)}`,
    );
  }
  return schema.parse(parsed);
}
