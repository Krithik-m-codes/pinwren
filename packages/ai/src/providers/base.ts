import type { z } from "zod";

export const DEFAULT_AI_TIMEOUT_MS = 15000;

/** Linear scan: an unanchored trailing-slash regex retries at every slash. */
export function trimTrailingSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end--;
  return url.slice(0, end);
}

export function extractJsonString(raw: string): string {
  const trimmed = raw.trim();
  // Strip markdown code fences if present: ```json ... ``` or ``` ... ```
  const start = trimmed.indexOf("```");
  if (start !== -1) {
    let contentStart = start + 3;
    if (trimmed.slice(contentStart, contentStart + 4).toLowerCase() === "json") contentStart += 4;
    const end = trimmed.indexOf("```", contentStart);
    if (end !== -1) {
      const content = trimmed.slice(contentStart, end).trim();
      if (content) return content;
    }
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
