import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { Pinwren } from "@pinwren/sdk";
import { createPinwrenMcpServer, type ServerOptions } from "./server";

export { createPinwrenMcpServer, summarizeDetail, TOOL_NAMES, VERSION, type ServerOptions } from "./server";

/**
 * Answer one MCP Streamable HTTP request (stateless, JSON responses) with a fresh server for `client`.
 * Stateless mode needs no sticky sessions, so it works behind a load balancer and across cluster
 * workers. Any Fetch-API runtime: `app.all("/mcp", (c) => handleMcpRequest(c.req.raw, client))`.
 */
export async function handleMcpRequest(
  request: Request,
  client: Pinwren,
  options: ServerOptions = {},
): Promise<Response> {
  const server = createPinwrenMcpServer(client, options);
  // No sessionIdGenerator: stateless mode.
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // JSON mode: the response is complete; nothing stays open.
    void server.close();
  }
}
