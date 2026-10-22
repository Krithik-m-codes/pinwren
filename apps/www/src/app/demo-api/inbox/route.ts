import { cookieKey, json, openSandbox, problem } from "@/lib/demo/http";
import { visitor } from "@/lib/demo/store";

// The visitor's sandbox for /demo/inbox, read-only. Identified by the cookie the demo page sets (the widget
// itself never sends cookies). Screenshots are fetched separately from /demo-api/assets/:id.
export function GET(req: Request) {
  const key = cookieKey(req);
  if (!key) return problem(401, "NO_DEMO_SESSION", "Open the demo first to start a sandbox");
  const opened = openSandbox(req, key);
  if (opened) return opened;
  const v = visitor(key);
  const items = v.items
    .slice()
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(({ reporterTokenHash: _hash, clientId: _client, assets, ...item }) => ({
      ...item,
      assets: assets.map(({ dataUrl: _data, ...a }) => a),
    }));
  return json({ items });
}
