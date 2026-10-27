// Serves the demo site on http://localhost:5173 (add "localhost:5173" to the project's allowed sites).
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const html = await readFile(new URL("./demo-site/index.html", import.meta.url));
const port = Number(process.env.PORT ?? 5173);
createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  // Serve only built widget assets, on the demo's own origin. API requests still go to the configured
  // local Pinwren instance; query parameters can never choose where JavaScript is downloaded from.
  if (/^\/widget(?:-[\w.-]+)?\.js$/.test(path)) {
    try {
      const js = await readFile(new URL(`../packages/widget/dist${path}`, import.meta.url));
      res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "x-content-type-options": "nosniff",
      });
      res.end(js);
    } catch {
      res.writeHead(404);
      res.end("Build the widget first: pnpm --filter @pinwren/widget build");
    }
    return;
  }
  if (path !== "/") {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}).listen(port, "127.0.0.1", () => console.log(`demo site → http://localhost:${port}/?key=<project key>`));
