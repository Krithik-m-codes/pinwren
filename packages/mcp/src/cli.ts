#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Pinwren } from "@pinwren/sdk";
import { createPinwrenMcpServer, VERSION } from "./server";

// `npx @pinwren/mcp` — stdio MCP server. Configure with PINWREN_URL and PINWREN_TOKEN. stdout carries
// the protocol, so everything human-readable goes to stderr.

const url = process.env.PINWREN_URL?.trim();
const token = process.env.PINWREN_TOKEN?.trim();

if (process.argv.includes("--version")) {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

if (!url || !token) {
  process.stderr.write(
    "pinwren-mcp: set PINWREN_URL (your Pinwren instance) and PINWREN_TOKEN (an API token, pwt_…).\n" +
      "Example (Claude Code): claude mcp add pinwren -e PINWREN_URL=https://feedback.example.com -e PINWREN_TOKEN=pwt_… -- npx -y @pinwren/mcp\n",
  );
  process.exit(1);
}

const client = new Pinwren({ url, token, userAgent: `pinwren-mcp/${VERSION}` });
const server = createPinwrenMcpServer(client);
await server.connect(new StdioServerTransport());
process.stderr.write(`pinwren-mcp ${VERSION} connected to ${url}\n`);
