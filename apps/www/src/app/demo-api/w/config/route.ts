import {
  parseCaptureConfig,
  parseWidgetBranding,
  parseWidgetConfig,
  publicWidgetConfig,
} from "@pinwren/core";
import { json, widgetGuard } from "@/lib/demo/http";

// GET /w/config for the demo project (docs/contracts/wave-1.md §1, wave-3.md). The stored config is parsed
// with the same schema the real server uses, so every field the widget expects is present and defaulted.
export function GET(req: Request) {
  const g = widgetGuard(req);
  if (!g.ok) return g.res;
  const origin = new URL(req.url).origin;
  const { widget, capture } = publicWidgetConfig(
    parseWidgetConfig({
      rightClickComment: true,
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
  return json({
    project: { name: "Pinwren demo", slug: "demo", publicRead: true },
    widget,
    capture,
    branding: parseWidgetBranding({}),
    activeRound: null,
  });
}
