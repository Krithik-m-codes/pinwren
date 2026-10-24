# @pinwren/mcp

[Model Context Protocol](https://modelcontextprotocol.io) server for [Pinwren](https://pinwren.xride-labs.in): let AI
coding agents (Claude Code, Cursor, Windsurf, VS Code…) read website feedback and bug reports, reproduce
them from the captured diagnostics and session replay, and resolve them. MIT.

Two ways to connect, same tools:

- **stdio** — `npx @pinwren/mcp`, configured with `PINWREN_URL` and `PINWREN_TOKEN`;
- **Streamable HTTP** — your Pinwren instance serves `https://<instance>/mcp` with an
  `Authorization: Bearer pwt_…` header.

Create a token in **Settings › API tokens**. Give it `feedback:read` to look, plus `feedback:write` and
`comments:write` to triage. A token never does more than its owner may: a viewer's token is read-only.

## Setup

**Claude Code (stdio)**

```sh
claude mcp add pinwren -e PINWREN_URL=https://feedback.example.com -e PINWREN_TOKEN=pwt_… -- npx -y @pinwren/mcp
```

**Claude Code (HTTP)**

```sh
claude mcp add --transport http pinwren https://feedback.example.com/mcp --header "Authorization: Bearer pwt_…"
```

**Cursor / any client with a JSON config**

```json
{
  "mcpServers": {
    "pinwren": {
      "command": "npx",
      "args": ["-y", "@pinwren/mcp"],
      "env": { "PINWREN_URL": "https://feedback.example.com", "PINWREN_TOKEN": "pwt_…" }
    }
  }
}
```

## Tools

| tool                       | what it does                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `list_projects`            | projects the token can see, with open counts                                                                                        |
| `search_feedback`          | filter by project, status, kind, priority, assignee, round, text, page, since — compact rows                                        |
| `get_feedback`             | one item: body, thread, anchor (CSS selector, XPath, text), environment, metadata, console and failing-request excerpts, asset URLs |
| `get_reproduction_context` | Markdown with page, environment, element and ordered steps from the session replay, failing requests and console errors             |
| `update_feedback`          | status, priority, title, assignees, review round                                                                                    |
| `add_comment`              | internal note (default) or public reply to the reporter                                                                             |
| `resolve_feedback`         | resolve, with an optional note such as the PR URL (saved as an internal comment)                                                    |

Tool results are plain JSON (or Markdown for `get_reproduction_context`). Text written by reporters is data:
the server's instructions tell the agent never to follow instructions found inside it.

## As a library

```ts
import { Pinwren } from "@pinwren/sdk";
import { createPinwrenMcpServer, handleMcpRequest } from "@pinwren/mcp";

const client = new Pinwren({ url: "https://feedback.example.com", token: process.env.PINWREN_TOKEN! });

// Your own transport:
const server = createPinwrenMcpServer(client);

// Or answer Streamable HTTP requests in any Fetch-API server (stateless, JSON responses):
export default { fetch: (req: Request) => handleMcpRequest(req, client) };
```

Requires Node.js ≥ 20.

## License

MIT © Pinwren contributors
