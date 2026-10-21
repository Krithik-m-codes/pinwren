// Serves the demo site on http://localhost:5173 (add "localhost:5173" to the project's allowed sites).
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";

const html = await readFile(new URL("./demo-site/index.html", import.meta.url));
const port = Number(process.env.PORT ?? 5173);
createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}).listen(port, () => console.log(`demo site → http://localhost:${port}/?key=<project key>`));
