import {
  type CaptureConfig,
  parseCaptureConfig,
  parseWidgetBranding,
  parseWidgetConfig,
  publicWidgetConfig,
  type WidgetBranding,
  type WidgetConfig,
} from "@pinwren/core";

// The demo project's `GET /w/config` body (docs/contracts/wave-1.md §1, wave-3.md), parsed with the same
// schemas the real server uses so every field the widget expects is present and defaulted. Shared by the
// demo API route and the playground's "Local" mode (which answers the widget in the browser).

export type DemoConfig = {
  project: { name: string; slug: string; publicRead: boolean };
  widget: WidgetConfig;
  capture: CaptureConfig;
  branding: WidgetBranding;
  activeRound: null;
};

export function demoConfig(origin: string): DemoConfig {
  const { widget, capture } = publicWidgetConfig(
    parseWidgetConfig({
      rightClickComment: true,
      // The demo lets any visitor resolve and reopen (the real default is off since wave 5).
      visitorsCanResolve: true,
      launcher: { tooltip: "Try Pinwren — leave a comment" },
      panelActions: [
        {
          id: "open-inbox",
          label: "Open in demo inbox",
          kind: "link",
          url: `${origin}/demo/inbox?item={id}`,
          icon: "external",
          visibleTo: "everyone",
        },
      ],
    }),
    parseCaptureConfig({ console: "warnings", network: "failures" }),
  );
  return {
    project: { name: "Pinwren demo", slug: "demo", publicRead: true },
    widget,
    capture,
    branding: parseWidgetBranding({}),
    activeRound: null,
  };
}
