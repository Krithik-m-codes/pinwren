// Tiny static server for the widget E2E suite: the fixture page plus the built widget bundles.
// The /w/* API is never served here — every test mocks it with page.route.
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const dist = join(root, "..", "dist");
const port = Number(process.env.PORT ?? 5180);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8" };

createServer(async (req, res) => {
  const path = normalize(new URL(req.url ?? "/", "http://x").pathname).replace(/^([/\\])+/, "");
  const file = path.startsWith("widget") ? join(dist, path) : join(root, "fixtures", path || "index.html");
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`e2e fixture server on http://localhost:${port}`));
