import { describe, expect, it } from "vitest";
import { demoConfig } from "@/lib/demo/config";
import { DEFAULT_SETTINGS, playgroundSettings, withPlayground } from "./settings";

describe("playground settings", () => {
  it("falls back field by field on bad saved values", () => {
    const s = playgroundSettings.parse({
      mode: "local",
      theme: "neon",
      accent: "red",
      locale: "pt-BR",
      replay: 1,
    });
    expect(s).toEqual({ ...DEFAULT_SETTINGS, mode: "local", locale: "pt-BR" });
  });

  it("applies position, capture and feature switches to the project config", () => {
    const base = demoConfig("https://pinwren.dev");
    const cfg = withPlayground(base, {
      ...DEFAULT_SETTINGS,
      position: "bottom-left",
      diagnostics: false,
      rightClick: false,
      bugs: false,
      replay: true,
      screenshots: false,
    });
    expect(cfg.widget.launcher.position).toBe("bottom-left");
    expect(cfg.widget.rightClickComment).toBe(false);
    expect(cfg.widget.modes).toEqual({ comment: true, bug: false });
    expect(cfg.capture).toMatchObject({ console: "off", network: "off", screenshotOnComment: false });
    expect(cfg.capture.replay.enabled).toBe(true);
    // The demo's own settings stay.
    expect(cfg.widget.visitorsCanResolve).toBe(true);
    expect(base.widget.launcher.position).toBe("bottom-right");
  });
});
