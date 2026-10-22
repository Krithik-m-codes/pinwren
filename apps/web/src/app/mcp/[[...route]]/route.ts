import { app } from "@pinwren/api";

// MCP Streamable HTTP for AI agents (/mcp, Bearer API token), served by the same Hono app as /api.
const handle = (request: Request) => app.fetch(request);

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const OPTIONS = handle;
