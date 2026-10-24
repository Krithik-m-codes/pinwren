import { demoConfig } from "@/lib/demo/config";
import { json, widgetGuard } from "@/lib/demo/http";

// GET /w/config for the demo project (docs/contracts/wave-1.md §1, wave-3.md). The playground's options
// (theme, position, capture switches) are applied in the browser on top of this (components/demo/playground).
export function GET(req: Request) {
  const g = widgetGuard(req);
  if (!g.ok) return g.res;
  return json(demoConfig(new URL(req.url).origin));
}
