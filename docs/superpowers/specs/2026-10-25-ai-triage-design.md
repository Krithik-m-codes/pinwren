# Specification: AI Triage & Enrichment (Phase 4 / WP-27)

- **Date:** 2026-10-25
- **Status:** Approved
- **Scope:** Architectural (`WP-27`, Features `F-110` through `F-114`)

---

## 1. Executive Summary

Pinwren Phase 4 introduces automated AI triage and enrichment to reduce developer workload when reviewing visual feedback and bug reports. When a report arrives, an asynchronous background job enriches the item with:

- An executive summary and clean title (`F-110`);
- Suggested priority and category based on error diagnostics (`F-111`);
- Duplicate detection comparing against existing project feedback (`F-112`);
- Synthesized step-by-step reproduction instructions from replay events and logs (`F-113`);
- On-demand multi-language translation (`F-114`).

All AI functionality is **opt-in per project**, supports **bring-your-own-key (BYOK)** with local/self-hosted LLM support via Ollama, and strictly honors Pinwren's privacy guarantees.

---

## 2. Architecture & Provider Layer (`packages/ai`)

A new workspace package `packages/ai` encapsulates LLM client abstractions, prompt templates, structured output parsing, and embedding generation.

```
packages/ai/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts               # Public exports: createAiClient(config)
│   ├── types.ts               # Provider configs, prompt inputs, Zod wire types
│   ├── providers/
│   │   ├── base.ts            # Common interface: complete(prompt, schema), embed(text)
│   │   ├── anthropic.ts       # Claude Messages API (Claude 3.5 Sonnet / Haiku)
│   │   ├── openai.ts          # OpenAI & OpenAI-compatible (GPT-4o, Groq, OpenRouter)
│   │   └── ollama.ts          # Local Ollama (/api/chat, /api/embeddings)
│   ├── tasks/
│   │   ├── summary.ts         # F-110: Title & executive summary
│   │   ├── triage.ts          # F-111: Severity & category suggestions
│   │   ├── duplicates.ts      # F-112: Duplicate detection & candidate ranking
│   │   ├── repro.ts           # F-113: Repro step synthesis from replay/logs
│   │   └── translate.ts       # F-114: Multi-language translation
│   └── prompts/               # Structured prompt templates with Zod schema extraction
```

### Provider Interface

```ts
export interface AiProvider {
  readonly id: "anthropic" | "openai" | "ollama";
  complete<T>(prompt: string, schema: z.ZodType<T>): Promise<T>;
  embed?(text: string): Promise<number[]>;
}
```

- **Anthropic**: Uses `@anthropic-ai/sdk` or Fetch API to `https://api.anthropic.com/v1/messages` with tool calling / JSON schema.
- **OpenAI-Compatible**: Works with standard OpenAI, Groq, OpenRouter, and Mistral via `https://.../v1/chat/completions` with `response_format: { type: "json_object" }`.
- **Ollama**: Connects to local Ollama endpoints (default: `http://localhost:11434`) using `/api/chat` and `/api/embeddings` for zero external data egress.

---

## 3. Database Schema (`packages/db`)

### 3.1 `feedback_ai` Table

Stores asynchronous enrichment outputs 1:1 with `feedback`:

```ts
export const feedbackAi = pgTable("feedback_ai", {
  feedbackId: uuid("feedback_id")
    .primaryKey()
    .references(() => feedback.id, { onDelete: "cascade" }),
  orgId: orgId(),

  // F-110: Auto-summary & refined title
  suggestedTitle: text("suggested_title"),
  summary: text("summary"),

  // F-111: Triage suggestions
  suggestedPriority: priorityEnum("suggested_priority"),
  suggestedKind: feedbackKindEnum("suggested_kind"),

  // F-112: Duplicate detection
  duplicateCandidateId: uuid("duplicate_candidate_id").references((): AnyPgColumn => feedback.id, {
    onDelete: "set null",
  }),
  duplicateConfidence: integer("duplicate_confidence"), // 0–100%
  duplicateReason: text("duplicate_reason"),

  // F-113: Synthesized reproduction steps
  reproductionSteps: text("reproduction_steps")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),

  // Telemetry & state
  status: text("status", { enum: ["pending", "completed", "failed", "skipped"] })
    .notNull()
    .default("pending"),
  model: text("model"),
  tokensUsed: integer("tokens_used"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
```

### 3.2 `feedback_translation` Table

Caches on-demand translations (`F-114`):

```ts
export const feedbackTranslation = pgTable(
  "feedback_translation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    feedbackId: uuid("feedback_id")
      .notNull()
      .references(() => feedback.id, { onDelete: "cascade" }),
    targetLocale: text("target_locale").notNull(),
    title: text("title"),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("feedback_translation_locale_uq").on(t.feedbackId, t.targetLocale)],
);
```

### 3.3 Configuration Storage

- **Organization Settings (`org_setting` with `key: "ai"`)**:
  - `value`: `{ provider: "anthropic" | "openai" | "ollama", model: string, baseUrl?: string, enabled: boolean }`
  - `secret`: AES-256-GCM ciphertext of the API key.
- **Project Settings (`project.aiConfig`)**:
  - `jsonb("ai_config")`: `{ enabled: boolean, autoSummary: boolean, autoSeverity: boolean, detectDuplicates: boolean, generateRepro: boolean, allowReplayInAi: boolean }`.
- **Environment Fallbacks**:
  - `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, `AI_MODEL`.

---

## 4. Background Job & Ingest Pipeline

### Ingest Integration (`packages/api`)

1. Feedback report submitted via `POST /w/feedback` or `POST /api/v1/feedback`.
2. Report and assets are committed in one transaction.
3. If `project.aiConfig.enabled` is `true` and `EU privacy mode` (`F-021`) is `false`:
   - Enqueue pg-boss job: `ai.enrich` with payload `{ feedbackId, orgId, projectId }`.
4. Ingest completes immediately without waiting for LLM execution (<300 ms response time preserved).

### Job Worker (`packages/api/src/jobs/ai.ts`)

1. Loads feedback text, anchor data, URL, and diagnostics (console errors and failing network requests).
2. If `project.aiConfig.allowReplayInAi` is enabled and a session replay asset exists: extracts significant replay action events (clicks, inputs, navigations).
3. Resolves AI credentials (per-org DB setting first, falling back to instance environment variables).
4. Calls `@pinwren/ai` with a strict 15-second timeout.
5. Performs duplicate candidate search:
   - Queries top 5 most similar existing items in the project using Postgres `tsvector` FTS (and cosine distance if `pgvector` extension exists).
   - Prompts the LLM to verify if the top candidate is a genuine duplicate.
6. Writes results to `feedback_ai`.
7. Emits SSE domain event `feedback.updated` to notify active triage dashboards in real time.

---

## 5. API Endpoints

| Method  | Path                             | Auth        | Description                                            |
| :------ | :------------------------------- | :---------- | :----------------------------------------------------- |
| `GET`   | `/api/settings/ai`               | Org Member  | Retrieve AI provider config (API key masked).          |
| `PUT`   | `/api/settings/ai`               | Org Admin   | Update AI provider config and encrypt API key.         |
| `POST`  | `/api/settings/ai/test`          | Org Admin   | Ping test checking provider connectivity and latency.  |
| `GET`   | `/api/projects/:id/ai`           | Org Member  | Get project AI feature toggles and privacy settings.   |
| `PATCH` | `/api/projects/:id/ai`           | Org Admin   | Update project AI feature toggles.                     |
| `POST`  | `/api/feedback/:id/ai/enrich`    | Org Editor+ | Manually trigger or re-run AI enrichment.              |
| `POST`  | `/api/feedback/:id/ai/translate` | Org Member  | Translate feedback to requested locale.                |
| `POST`  | `/api/feedback/:id/ai/apply`     | Org Editor+ | Apply AI suggestion (title, priority, duplicate link). |

---

## 6. Dashboard UX (`apps/web`)

### 6.1 Settings › AI (`apps/web/src/app/(app)/settings/ai/page.tsx`)

- Provider selector cards: Anthropic, OpenAI / OpenAI-compatible, Ollama.
- Base URL input with default placeholders (`https://api.anthropic.com`, `https://api.openai.com/v1`, `http://localhost:11434`).
- API key input (password masked) + **Test Connection** button showing model latency and success toast.
- Model name selector with presets and custom text input.

### 6.2 Project Settings › AI Tab

- Switches for:
  - Enable AI Triage for this project.
  - Auto-generate title & executive summary.
  - Suggest priority and category.
  - Scan for duplicate feedback.
  - Synthesize reproduction steps from logs/replays.
  - **Privacy safeguard switch:** _"Allow sending diagnostic logs and replay events to AI provider"_.

### 6.3 Triage Detail View (`feedback-detail.tsx`)

- **Executive Summary Card**: Clean callout below feedback header providing 1–2 sentence summary.
- **Suggested Severity Pill**: Shows when AI confidence is high and differs from current priority (e.g. _"AI suggests High priority due to HTTP 500 error"_) with a 1-click **Accept** button.
- **Duplicate Banner**: Shows candidate thumbnail, number, and confidence (e.g. _"Possible duplicate of #42 (85% match)"_) with **View comparison** and **Link as duplicate** buttons.
- **Reproduction Steps Section**: Structured numbered checklist in the Details pane.
- **Translate Button**: Dropdown in comment thread allowing immediate translation to the user's browser language.

---

## 7. Security, Privacy & Guardrails

1. **EU Privacy Mode (`F-021`) Compliance**: When EU Privacy Mode is enabled, all external AI calls are unconditionally blocked at the job worker level.
2. **Replay & Asset Data Protection**: Raw session replay files and screenshots are never passed to LLMs unless the project admin explicitly checks the privacy consent toggle.
3. **Secret Encryption**: All AI API keys are encrypted at rest with AES-256-GCM using `PINWREN_ENCRYPTION_KEY`.
4. **Prompt Injection Hardening**: All user inputs (feedback body, user names, URLs, console messages) are framed as untrusted data blocks within structured prompts; system instructions instruct models to ignore embedded instructions.
5. **Non-Blocking Resiliency**: Ingest response times remain under 300 ms. If an AI call fails, times out, or runs out of credits, `feedback_ai.status` is set to `failed` and normal triage workflows continue uninterrupted.

---

## 8. Testing Strategy

1. **`packages/ai` Unit Tests**:
   - Mock HTTP server fixtures simulating Anthropic, OpenAI, and Ollama responses.
   - Validation that Zod schemas parse model outputs correctly and handle malformed JSON gracefully.
2. **`packages/api` Integration Tests**:
   - Verify `ai.enrich` job execution, setting resolution (org settings over env fallback), and database persistence.
   - Verify that EU Privacy Mode and project toggles bypass AI execution.
   - Test `/api/settings/ai/test`, translation cache hits, and suggestion application endpoints.
3. **`apps/web` E2E Tests (Playwright)**:
   - Configure AI settings in Settings › AI.
   - Submit feedback and observe the AI summary, severity pill, and reproduction checklist appear on the triage screen via real-time SSE stream.
