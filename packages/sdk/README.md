# @pinwren/sdk

Typed client for the [Pinwren](https://pinwren.dev) public REST API (`/api/v1`): read and triage feedback,
comment, and work with review rounds from scripts, CI jobs and your own tools. ESM and CommonJS, full
TypeScript types, no runtime dependencies. MIT.

```sh
npm install @pinwren/sdk
```

Create a token in **Settings › API tokens** (scopes `feedback:read`, `feedback:write`, `comments:write`).

```ts
import { Pinwren } from "@pinwren/sdk";

const pinwren = new Pinwren({ url: "https://feedback.example.com", token: process.env.PINWREN_TOKEN! });

// Projects with their open counts
for (const p of await pinwren.projects.list()) console.log(p.name, p.openCount);

// One page, or every matching item
const { items, nextCursor } = await pinwren.feedback.list({ status: "open", kind: "bug", limit: 50 });
for await (const item of pinwren.feedback.iterate({ priority: "urgent" }))
  console.log(item.number, item.title);

// Detail: thread, files, timeline, console + network diagnostics
const detail = await pinwren.feedback.get(items[0]!.id);

// Triage
await pinwren.feedback.update(detail.feedback.id, { status: "in_progress", priority: "high" });
await pinwren.comments.create(detail.feedback.id, { body: "Looking into it", visibility: "internal" });
await pinwren.feedback.resolve(detail.feedback.id, "Fixed in https://github.com/acme/site/pull/42");

// What a developer (or an AI agent) needs to reproduce it, as Markdown
const { markdown } = await pinwren.feedback.reproduction(detail.feedback.id);

// Review rounds
const rounds = await pinwren.rounds.list(detail.feedback.projectId);
await pinwren.rounds.update(rounds[0]!.id, { status: "closed" });

// Files (screenshots, attachments, session replays as gzip'd rrweb events)
const { contentType, bytes } = await pinwren.assets.get(detail.assets[0]!.id);
```

## Errors

Every failed call throws a `PinwrenError` with the HTTP `status` (0 when the server could not be reached),
a stable `code` and a readable `message`:

| code                 | meaning                                                 |
| -------------------- | ------------------------------------------------------- |
| `INVALID_TOKEN`      | missing, wrong, expired or revoked token (401)          |
| `INSUFFICIENT_SCOPE` | the token lacks the scope this call needs (403)         |
| `READ_ONLY_ROLE`     | the token's owner has the viewer role: reads only (403) |
| `NOT_FOUND`          | no such item in the token's organisation (404)          |
| `VALIDATION_ERROR`   | the request body or query is invalid (400)              |
| `NETWORK_ERROR`      | the request never got an answer (timeout, DNS, refused) |

```ts
import { PinwrenError } from "@pinwren/sdk";
try {
  await pinwren.feedback.update(id, { status: "resolved" });
} catch (err) {
  if (err instanceof PinwrenError && err.code === "INSUFFICIENT_SCOPE") console.error("needs feedback:write");
  else throw err;
}
```

## Options

| option      | default        | notes                                                      |
| ----------- | -------------- | ---------------------------------------------------------- |
| `url`       | —              | your instance, e.g. `https://feedback.example.com`         |
| `token`     | —              | `pwt_…` API token                                          |
| `fetch`     | global `fetch` | any Fetch-compatible implementation (Node ≥ 20, Deno, Bun) |
| `timeoutMs` | `30000`        | per request                                                |
| `userAgent` | —              | sent where the runtime allows                              |

## Types

The types (`Feedback`, `FeedbackDetail`, `FeedbackListQuery`, `Round`, …) are generated from the server's
Zod schemas (`pnpm --filter @pinwren/sdk generate` in the monorepo), so they match what the API validates
and returns. Response objects may gain fields in later versions; they never lose them within `/api/v1`.

## Development

In the monorepo the package entry is the TypeScript source; `pnpm publish` swaps in the built files from
`publishConfig` (`pnpm --filter @pinwren/sdk build` first). Publish with pnpm, not npm.

## License

MIT © Pinwren contributors
