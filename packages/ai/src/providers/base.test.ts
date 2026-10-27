import { describe, expect, it } from "vitest";
import { extractJsonString, trimTrailingSlashes } from "./base";

describe("AI response parsing", () => {
  it.each([
    ['```json\n{"ok":true}\n```', '{"ok":true}'],
    ["before ```JSON  [1, 2]  ``` after", "[1, 2]"],
    ['```\n{"ok":true}\n```', '{"ok":true}'],
    ['unfinished ```json\n{"ok":true}', '{"ok":true}'],
    ["prefix [1, 2] suffix", "[1, 2]"],
    ["  no JSON here  ", "no JSON here"],
  ])("extracts %s", (raw, expected) => {
    expect(extractJsonString(raw)).toBe(expected);
  });

  it("handles an unclosed whitespace-only fence", () => {
    const raw = "```" + " ".repeat(2_000);
    expect(extractJsonString(raw)).toBe("```");
  });
});

describe("provider URL normalization", () => {
  it.each([
    ["https://llm.example.com/v1///", "https://llm.example.com/v1"],
    ["https://llm.example.com/a/b", "https://llm.example.com/a/b"],
    ["", ""],
    ["////", ""],
  ])("trims only trailing slashes from %s", (url, expected) => {
    expect(trimTrailingSlashes(url)).toBe(expected);
  });
});
