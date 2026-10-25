# AI Triage & Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Phase 4 (`WP-27`) AI Triage & Enrichment for Pinwren: auto-summary, priority/category suggestions, hybrid duplicate detection, reproduction step synthesis, and multi-language translation using Anthropic, OpenAI-compatible, or local Ollama models.

**Architecture:** A standalone provider-agnostic package `packages/ai` handles model integration and structured prompt execution. `packages/db` adds `feedback_ai` and `feedback_translation` tables. `packages/api` registers an asynchronous `ai.enrich` pg-boss job and exposes AI management and translation endpoints. `apps/web` provides settings and displays executive summaries, severity pills, duplicate warnings, and repro checklists in the triage dashboard.

**Tech Stack:** TypeScript (strict), Zod, Drizzle ORM, PostgreSQL, pg-boss, Hono, Next.js 16 (App Router), Redux Toolkit (RTK Query), shadcn/ui.

**Spec:** [`docs/superpowers/specs/2026-10-25-ai-triage-design.md`](file:///e:/projects/pinwren/docs/superpowers/specs/2026-10-25-ai-triage-design.md)

## Global Constraints

- Never break self-hosting: Postgres 17 remains the only required dependency (no mandatory external services or mandatory Redis).
- Postgres `vector` extension is optional: hybrid duplicate detection uses `pgvector` if installed, with a graceful fallback to Postgres `tsvector` FTS + LLM candidate verification.
- Ingest time under 300 ms: AI enrichment runs strictly in the background via pg-boss (`ai.enrich`); never block `POST /w/feedback`.
- EU Privacy Mode (`F-021`): AI processing is skipped unconditionally if EU Privacy Mode is enabled.
- Data protection: Screenshots and session replays are never sent to external AI providers unless `project.aiConfig.allowReplayInAi` is explicitly toggled on.
- Secrets: AI provider API keys are encrypted at rest with AES-256-GCM using `PINWREN_ENCRYPTION_KEY`.
- No `any` without explanatory comment, no `@ts-ignore`, full test coverage with Vitest and Playwright.

## Review Focus

1. **Missing or invalid AI credentials**: The job worker must gracefully mark `feedback_ai.status = 'failed'` with a clear error without crashing the worker or retrying forever.
2. **Postgres without pgvector**: When running on standard Postgres without `vector` installed, the migration and duplicate detection must succeed using the `tsvector` fallback.
3. **EU Privacy Mode enabled**: A report submitted to a project with EU Privacy Mode active must record `status = 'skipped'` and make zero outbound network requests.
4. **Malformed LLM JSON response**: When an LLM returns unexpected markdown or invalid JSON, Zod parsing must fail safely and record an error instead of throwing unhandled exceptions.
5. **Slow LLM responses / timeouts**: LLM requests must enforce a strict 15-second timeout via `AbortSignal` so workers are never held hostage by hung upstream APIs.

---

### Task 1: Database Schema & Migration (`packages/db`)

**Files:**

- Modify: `packages/core/src/schemas.ts`
- Modify: `packages/db/src/schema/app.ts`
- Test: `packages/core/src/schemas.test.ts`

**Interfaces:**

- Consumes: `feedback.id`, `orgId`, `timestamps` from `packages/db/src/schema/app.ts`
- Produces: `feedbackAi`, `feedbackTranslation` tables and `ProjectAiConfig` type

- [ ] **Step 1: Write the failing schema test**

Create a test in `packages/core/src/ai-schemas.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { projectAiConfigSchema, aiProviderConfigSchema } from "./schemas";

describe("AI schemas", () => {
  it("validates default project AI config", () => {
    const parsed = projectAiConfigSchema.parse({});
    expect(parsed.enabled).toBe(false);
    expect(parsed.autoSummary).toBe(true);
    expect(parsed.autoSeverity).toBe(true);
    expect(parsed.detectDuplicates).toBe(true);
    expect(parsed.generateRepro).toBe(true);
    expect(parsed.allowReplayInAi).toBe(false);
  });

  it("validates provider config", () => {
    const parsed = aiProviderConfigSchema.parse({
      provider: "anthropic",
      model: "claude-3-5-haiku-latest",
      enabled: true,
    });
    expect(parsed.provider).toBe("anthropic");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pinwren/core test`
Expected: FAIL (modules/schemas not defined)

- [ ] **Step 3: Define schemas and Drizzle tables**

Add Zod schemas in `packages/core/src/schemas.ts`:

- `projectAiConfigSchema`
- `aiProviderConfigSchema`
- `aiEnrichmentResponseSchema`

Add tables in `packages/db/src/schema/app.ts`:

- `feedbackAi`: columns `feedbackId`, `orgId`, `suggestedTitle`, `summary`, `suggestedPriority`, `suggestedKind`, `duplicateCandidateId`, `duplicateConfidence`, `duplicateReason`, `reproductionSteps`, `status`, `model`, `tokensUsed`, `error`, `timestamps`.
- `feedbackTranslation`: columns `id`, `feedbackId`, `targetLocale`, `title`, `body`, `createdAt`.
- Add `aiConfig` to `project` table definition.

- [ ] **Step 4: Generate migration & verify tests pass**

Run:
`pnpm --filter @pinwren/core test`
`pnpm db:generate`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/ packages/db/
git commit -m "feat(db): add feedback_ai and feedback_translation schemas"
```

---

### Task 2: Provider Layer Foundation (`packages/ai`)

**Files:**

- Create: `packages/ai/package.json`
- Create: `packages/ai/tsconfig.json`
- Create: `packages/ai/src/types.ts`
- Create: `packages/ai/src/providers/base.ts`
- Create: `packages/ai/src/providers/anthropic.ts`
- Create: `packages/ai/src/providers/openai.ts`
- Create: `packages/ai/src/providers/ollama.ts`
- Create: `packages/ai/src/client.ts`
- Create: `packages/ai/src/index.ts`
- Test: `packages/ai/src/client.test.ts`

**Interfaces:**

- Consumes: `aiProviderConfigSchema` from `@pinwren/core`
- Produces: `createAiClient(config: AiClientOptions): AiClient`

- [ ] **Step 1: Write the failing provider test**

Create `packages/ai/src/client.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createAiClient } from "./client";

describe("createAiClient", () => {
  it("initializes Anthropic provider", () => {
    const client = createAiClient({
      provider: "anthropic",
      apiKey: "sk-ant-test",
      model: "claude-3-5-haiku-latest",
    });
    expect(client.providerId).toBe("anthropic");
  });

  it("initializes Ollama provider with custom baseUrl", () => {
    const client = createAiClient({
      provider: "ollama",
      baseUrl: "http://localhost:11434",
      model: "llama3.2",
    });
    expect(client.providerId).toBe("ollama");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pinwren/ai test`
Expected: FAIL (package does not exist)

- [ ] **Step 3: Implement `packages/ai` provider layer**

1. Create `packages/ai/package.json` with workspace name `@pinwren/ai`.
2. Implement `base.ts` with timeout handling (15s abort signal) and JSON extraction helper.
3. Implement `anthropic.ts`, `openai.ts`, and `ollama.ts` implementing `AiProvider`:
   - `complete<T>(prompt: string, schema: z.ZodType<T>): Promise<T>`
4. Implement `client.ts` factory and export from `index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pinwren/ai test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ai/ pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "feat(ai): scaffold @pinwren/ai provider layer"
```

---

### Task 3: AI Tasks Implementation (`packages/ai`)

**Files:**

- Create: `packages/ai/src/prompts/templates.ts`
- Create: `packages/ai/src/tasks/summary.ts`
- Create: `packages/ai/src/tasks/triage.ts`
- Create: `packages/ai/src/tasks/duplicates.ts`
- Create: `packages/ai/src/tasks/repro.ts`
- Create: `packages/ai/src/tasks/translate.ts`
- Test: `packages/ai/src/tasks.test.ts`

**Interfaces:**

- Consumes: `AiProvider`
- Produces:
  - `summarizeReport(provider, input)`
  - `suggestSeverity(provider, input)`
  - `verifyDuplicate(provider, input)`
  - `synthesizeReproSteps(provider, input)`
  - `translateText(provider, input)`

- [ ] **Step 1: Write the failing tasks test**

Create `packages/ai/src/tasks.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { summarizeReport, suggestSeverity, translateText } from "./tasks";
import type { AiProvider } from "./providers/base";

describe("AI tasks", () => {
  const mockProvider: AiProvider = {
    id: "openai",
    complete: vi.fn(),
  };

  it("extracts summary and title", async () => {
    vi.mocked(mockProvider.complete).mockResolvedValueOnce({
      suggestedTitle: "Checkout 500 on Pay button click",
      summary: "User encountered a server error during payment processing.",
    });

    const res = await summarizeReport(mockProvider, {
      title: "bad bug",
      body: "clicked checkout and got red error",
      url: "https://example.com/checkout",
    });

    expect(res.suggestedTitle).toBe("Checkout 500 on Pay button click");
    expect(res.summary).toContain("payment processing");
  });

  it("suggests severity based on diagnostics", async () => {
    vi.mocked(mockProvider.complete).mockResolvedValueOnce({
      priority: "high",
      kind: "bug",
      reason: "500 Internal Server Error observed on POST /api/pay",
    });

    const res = await suggestSeverity(mockProvider, {
      body: "checkout broken",
      consoleErrors: ["Uncaught (in promise) Error: Payment failed"],
      networkErrors: [{ method: "POST", url: "/api/pay", status: 500, durationMs: 120 }],
    });

    expect(res.priority).toBe("high");
    expect(res.kind).toBe("bug");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pinwren/ai test`
Expected: FAIL

- [ ] **Step 3: Implement prompt templates and task functions**

1. Create prompt templates with prompt injection guards (untrusted text wrapped in explicit delimiters `<user_input>...</user_input>`).
2. Implement `summary.ts` parsing to `{ suggestedTitle: string, summary: string }`.
3. Implement `triage.ts` parsing to `{ priority: Priority, kind: FeedbackKind, reason: string }`.
4. Implement `duplicates.ts` taking target feedback and candidate feedback list, returning `{ isDuplicate: boolean, candidateId: string | null, confidence: number, reason: string }`.
5. Implement `repro.ts` parsing session replay action events + network errors into string array `reproductionSteps: string[]`.
6. Implement `translate.ts` taking `{ text: string, targetLocale: string }` returning translated string.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pinwren/ai test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/ai/
git commit -m "feat(ai): implement summary, triage, duplicate, repro, and translate tasks"
```

---

### Task 4: API Endpoints & Routes (`packages/api`)

**Files:**

- Modify: `packages/api/package.json`
- Create: `packages/api/src/routes/ai.ts`
- Modify: `packages/api/src/index.ts`
- Test: `packages/api/src/routes/ai.test.ts`

**Interfaces:**

- Consumes: `packages/ai`, `packages/db`, `packages/core`
- Produces:
  - `GET /api/settings/ai`
  - `PUT /api/settings/ai`
  - `POST /api/settings/ai/test`
  - `GET /api/projects/:id/ai`
  - `PATCH /api/projects/:id/ai`
  - `POST /api/feedback/:id/ai/enrich`
  - `POST /api/feedback/:id/ai/translate`
  - `POST /api/feedback/:id/ai/apply`

- [ ] **Step 1: Write the failing API route tests**

Create `packages/api/src/routes/ai.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { app } from "../index";

describe("AI API Routes", () => {
  it("rejects unauthorized access to AI settings", async () => {
    const res = await app.request("/api/settings/ai", { method: "GET" });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pinwren/api test src/routes/ai.test.ts`
Expected: FAIL (404 Not Found)

- [ ] **Step 3: Implement Hono AI routes in `packages/api/src/routes/ai.ts`**

1. Mount routes under `/api`.
2. In `GET /api/settings/ai`, query `org_setting` for key `ai`. Mask secret as `hasKey: boolean`, return settings.
3. In `PUT /api/settings/ai`, validate input with Zod, encrypt API key using `encryptSecret()`, store in `org_setting`.
4. In `POST /api/settings/ai/test`, execute quick completion with provider and return `{ ok: true, latencyMs: number }`.
5. In `GET/PATCH /api/projects/:id/ai`, read/update `project.aiConfig`.
6. In `POST /api/feedback/:id/ai/translate`, check `feedback_translation` table; if absent, call `@pinwren/ai`, store result, and return.
7. In `POST /api/feedback/:id/ai/apply`, update `feedback.title`, `feedback.priority`, or `feedback.duplicateOfId` based on request.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pinwren/api test src/routes/ai.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/
git commit -m "feat(api): add AI settings, test, translation, and triage routes"
```

---

### Task 5: Background Enrichment Worker (`packages/api`)

**Files:**

- Create: `packages/api/src/jobs/ai.ts`
- Modify: `packages/api/src/jobs/boss.ts`
- Modify: `packages/api/src/jobs/dispatch.ts`
- Test: `packages/api/src/jobs/ai.test.ts`

**Interfaces:**

- Consumes: `@pinwren/ai`, `pg-boss`, `packages/db`
- Produces: `ai.enrich` job handler

- [ ] **Step 1: Write the failing job worker test**

Create `packages/api/src/jobs/ai.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { runAiEnrichmentJob } from "./ai";

describe("runAiEnrichmentJob", () => {
  it("skips enrichment when project AI is disabled", async () => {
    const res = await runAiEnrichmentJob({
      feedbackId: "00000000-0000-0000-0000-000000000001",
      orgId: "org-1",
      projectId: "proj-1",
    });
    expect(res.status).toBe("skipped");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pinwren/api test src/jobs/ai.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `runAiEnrichmentJob` worker**

1. Register `ai.enrich` worker in `boss.ts`.
2. Check `project.aiConfig.enabled` and `EU Privacy Mode`. If disabled, insert `feedback_ai` with `status: 'skipped'`.
3. Resolve AI provider settings: check org DB setting first, then env vars.
4. Execute `summarizeReport`, `suggestSeverity`, `checkDuplicate`, and `synthesizeReproSteps` (if replay enabled).
5. Upsert `feedback_ai` row with `status: 'completed'`.
6. Emit `feedback.updated` domain event via SSE to notify dashboards.
7. In `dispatch.ts`, enqueue `ai.enrich` upon feedback creation.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pinwren/api test src/jobs/ai.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/api/
git commit -m "feat(jobs): add ai.enrich background worker and dispatch integration"
```

---

### Task 6: Settings UI in Dashboard (`apps/web`)

**Files:**

- Create: `apps/web/src/app/(app)/settings/ai/page.tsx`
- Create: `apps/web/src/app/(app)/settings/ai/ai-settings-form.tsx`
- Create: `apps/web/src/app/(app)/projects/[id]/ai-tab.tsx`
- Modify: `apps/web/src/app/(app)/projects/[id]/project-settings.tsx`
- Modify: `apps/web/src/app/(app)/settings/settings-shell.tsx`
- Modify: `apps/web/src/lib/store/api/admin.ts`
- Test: `apps/web/src/app/(app)/settings/ai/ai-settings.test.tsx`

**Interfaces:**

- Consumes: `/api/settings/ai`, `/api/projects/:id/ai`
- Produces: Settings UI for AI configuration and project toggles

- [ ] **Step 1: Write the failing component test**

Create `apps/web/src/app/(app)/settings/ai/ai-settings.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiSettingsForm } from "./ai-settings-form";

describe("AiSettingsForm", () => {
  it("renders provider radio options", () => {
    render(
      <AiSettingsForm
        initialConfig={{ provider: "anthropic", model: "claude-3-5-haiku-latest", enabled: true }}
      />,
    );
    expect(screen.getByText("Anthropic")).toBeDefined();
    expect(screen.getByText("OpenAI-compatible")).toBeDefined();
    expect(screen.getByText("Ollama (Local)")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pinwren/web test`
Expected: FAIL

- [ ] **Step 3: Implement settings pages and forms**

1. Add AI API endpoints to RTK Query in `admin.ts`.
2. Add "AI" navigation link in `settings-shell.tsx`.
3. Build `ai-settings-form.tsx` with react-hook-form + Zod:
   - Provider selector (Anthropic / OpenAI / Ollama).
   - API key input with masked state and update button.
   - Base URL input with provider defaults.
   - Model name input with presets.
   - "Test connection" button with feedback toast.
4. Build `ai-tab.tsx` for Project Settings:
   - Feature toggles: Auto-summary, Severity, Duplicate scan, Repro synthesis.
   - Privacy warning checkbox for diagnostics/replay transmission.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pinwren/web test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat(web): add organization and project AI settings screens"
```

---

### Task 7: Triage Detail View AI Integration (`apps/web`)

**Files:**

- Create: `apps/web/src/app/(app)/inbox/ai-summary-card.tsx`
- Create: `apps/web/src/app/(app)/inbox/ai-repro-steps.tsx`
- Create: `apps/web/src/app/(app)/inbox/ai-duplicate-banner.tsx`
- Modify: `apps/web/src/app/(app)/inbox/feedback-detail.tsx`
- Test: `apps/web/src/app/(app)/inbox/ai-detail.test.tsx`

**Interfaces:**

- Consumes: `feedback_ai`, `feedback_translation`
- Produces: AI presentation and 1-click triage actions in inbox

- [ ] **Step 1: Write the failing triage UI test**

Create `apps/web/src/app/(app)/inbox/ai-detail.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiSummaryCard } from "./ai-summary-card";

describe("AiSummaryCard", () => {
  it("renders executive summary and suggested title", () => {
    render(
      <AiSummaryCard
        summary="Server 500 error during checkout"
        suggestedTitle="Checkout failure on payment"
      />,
    );
    expect(screen.getByText("Server 500 error during checkout")).toBeDefined();
    expect(screen.getByText("Checkout failure on payment")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pinwren/web test`
Expected: FAIL

- [ ] **Step 3: Implement triage AI components**

1. Create `ai-summary-card.tsx` (clean card below item header with spark icon).
2. Create `ai-duplicate-banner.tsx` (alert box displaying duplicate candidate number, confidence %, and "Link as duplicate" action).
3. Create `ai-repro-steps.tsx` (numbered checklist with copy button).
4. In `feedback-detail.tsx`:
   - Display suggested severity badge if priority differs from current, with one-click "Accept" button.
   - Add "Translate" action in thread header menu calling `/api/feedback/:id/ai/translate`.
   - Embed summary, duplicate, and repro components.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pinwren/web test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat(web): integrate AI summary, severity suggestions, duplicates, and repro steps into triage detail view"
```

---

### Task 8: Verification & Smoke Test Coverage

**Files:**

- Modify: `scripts/smoke.mjs`
- Create: `apps/web/e2e/ai-triage.e2e.ts`

**Interfaces:**

- Exercises entire flow end-to-end

- [ ] **Step 1: Add AI smoke checks in `scripts/smoke.mjs`**

Add tests checking:

1. `GET /api/settings/ai` without session returns 401.
2. `PUT /api/settings/ai` saves encrypted credentials.
3. `POST /api/settings/ai/test` tests connection.
4. `GET /api/projects/:id/ai` returns project AI configuration.
5. Ingest feedback -> verify `feedback_ai` row creation and status.

- [ ] **Step 2: Run smoke tests against local server**

Run: `pnpm verify`
Expected: All tests (format, lint, typecheck, unit, smoke) PASS.

- [ ] **Step 3: Commit**

```bash
git add scripts/ apps/web/e2e/
git commit -m "test: add smoke and E2E checks for AI triage and enrichment"
```
