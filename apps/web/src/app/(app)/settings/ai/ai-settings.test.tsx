// @vitest-environment happy-dom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiSettingsForm } from "./ai-settings-form";

describe("AiSettingsForm", () => {
  it("renders provider radio options", () => {
    render(
      <AiSettingsForm
        initialConfig={{ provider: "anthropic", model: "claude-3-5-haiku-latest", enabled: true }}
      />,
    );
    expect(screen.getByText("Anthropic")).toBeDefined();
    expect(screen.getByText("OpenAI-compatible")).toBeDefined();
    expect(screen.getByText("Ollama (Local)")).toBeDefined();
  });
});
