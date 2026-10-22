import { handleMcpRequest } from "@pinwren/mcp";
import { Pinwren, PinwrenError } from "@pinwren/sdk";
import { Hono } from "hono";
import { problem } from "../errors";
import { env } from "../env";

// MCP over Streamable HTTP at /mcp (blueprint 04 §6, wave-4 contract §5), authenticated with an API
// token (`Authorization: Bearer pwt_…`). The tools are the ones `npx @pinwren/mcp` serves over stdio;
// here their API client calls this same app in-process, so scopes and the viewer role apply exactly as
// they do on /api/v1.

/** In-process base URL: localhost, so the HTTPS-enforcement middleware lets the inner calls through. */
const INTERNAL_BASE = "http://localhost";

export function mcpRoutes(dispatch: (req: Request) => Promise<Response>) {
  return new Hono().all("/", async (c) => {
    const match = /^Bearer\s+(\S+)$/i.exec(c.req.header("authorization") ?? "");
    const token = match?.[1];
    const challenge = { "www-authenticate": 'Bearer realm="pinwren", error="invalid_token"' };
    if (!token) {
      c.header("www-authenticate", 'Bearer realm="pinwren"');
      return problem(c, 401, "INVALID_TOKEN", "Missing API token (Authorization: Bearer pwt_…)");
    }
    const client = new Pinwren({
      url: INTERNAL_BASE,
      token,
      fetch: (input, init) => dispatch(new Request(input, init)),
      userAgent: `pinwren-mcp-http/${env().PINWREN_VERSION}`,
    });
    // Check the token before the MCP handshake, so a client learns at connect time that it is wrong.
    try {
      await client.request("GET", "/token");
    } catch (err) {
      if (err instanceof PinwrenError && err.status === 401) {
        for (const [k, v] of Object.entries(challenge)) c.header(k, v);
        return problem(c, 401, "INVALID_TOKEN", "Missing, invalid or expired API token");
      }
      throw err;
    }
    return handleMcpRequest(c.req.raw, client, { name: "pinwren" });
  });
}
