# Automation rules and AI label suggestions: API contract

All routes are on the dashboard API (`/api`), authenticated by the session cookie (the CSRF rule of ADR 0021 applies to
writes). They are inventoried in `packages/api/src/tenant-route-inventory.json` as `tenant` routes with a `finite`
database lifetime, and exercised by `cloud-routes-db.test.ts` (a foreign workspace's ids answer 404/403 and change no
row). Request and response schemas live in `packages/core/src/automation.ts`. Viewers get `403 READ_ONLY_ROLE` on every
write; rule writes need `projects.manage` (workspace admin), chip decisions need `feedback.update`.

## Automation rules

| Method and path                         | Permission        | Body / query                                          | Answer                                            |
| --------------------------------------- | ----------------- | ----------------------------------------------------- | ------------------------------------------------- |
| `GET /api/projects/:id/automations`     | read              |                                                       | `{ rules: Rule[] }`                               |
| `POST /api/projects/:id/automations`    | `projects.manage` | `AutomationRuleCreate`                                | `201 { rule }`                                    |
| `GET /api/automations/:id`              | read              |                                                       | `{ rule }`                                        |
| `PATCH /api/automations/:id`            | `projects.manage` | `AutomationRuleUpdate` (only the named fields change) | `{ rule }`                                        |
| `DELETE /api/automations/:id`           | `projects.manage` |                                                       | `204`                                             |
| `POST /api/automations/:id/test`        | `projects.manage` | `{ feedbackId }` or `{ sample: {...} }`               | `{ triggered, conditions[], matched, actions[] }` |
| `GET /api/projects/:id/automation-runs` | read              | `?ruleId=<uuid>&limit=1..100` (default 50)            | `{ runs: Run[] }`                                 |

```ts
type Rule = {
  id: string;
  projectId: string;
  name: string;
  enabled: boolean;
  trigger: {
    event: "feedback_created" | "status_changed" | "label_added" | "comment_added";
    toStatuses: FeedbackStatus[]; // status_changed: empty = any
    labelId: string | null;
  }; // label_added: null = any
  conditions: Condition[]; // all must hold
  actions: Action[]; // 1..10, run in order
  runCount: number;
  lastRunAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type Condition =
  | { field: "kind"; values: FeedbackKind[] }
  | { field: "priority"; values: Priority[] }
  | { field: "pageUrl"; pattern: string } // path pattern: /pricing, /product/:id, /docs/*
  | { field: "browser"; values: string[] } // family, case-insensitive
  | { field: "reporterEmailDomain"; values: string[] } // exact, lower-case
  | { field: "label"; labelIds: string[] } // any of
  | { field: "hasAttachment"; value: boolean }
  | { field: "hasReplay"; value: boolean };
type Action =
  | { type: "assign"; userIds: string[]; mode: "all" | "round_robin" }
  | { type: "add_label"; labelId: string }
  | { type: "set_priority"; priority: Priority }
  | { type: "set_status"; status: FeedbackStatus }
  | { type: "add_to_round"; roundId: string }
  | { type: "notify_webhook"; endpointId: string }
  | { type: "notify_email"; userIds: string[]; emails: string[] } // at least one recipient
  | { type: "create_issue"; integrationId: string };
type Run = {
  id: string;
  ruleId: string;
  ruleName: string;
  feedbackId: string | null;
  feedbackNumber: number | null;
  event: string;
  depth: number;
  status: "success" | "partial" | "failed" | "skipped";
  results: { type: string; ok: boolean; detail: string }[];
  error: string | null;
  createdAt: string;
};
```

Limits: 50 rules per project (`400 TOO_MANY_RULES`), 10 conditions, 10 actions. Every id a rule names (label, member,
round, webhook endpoint, tracker) must exist in the workspace, and in the rule's project where it has one; otherwise
`400 INVALID_RULE`. A rule for another workspace's project is `404`. A patch that does not name `conditions` keeps them.

## Execution

1. A domain event (`feedback.created`, `feedback.status_changed`, `feedback.labels_changed` with a label added,
   `comment.created`) is committed; the `events.dispatch` job queues `automation.run` with the event, keyed by the
   event id so a retry is dropped.
2. `runAutomations` (`services/automation-engine.ts`) opens one organisation scope (`withOrg`), loads the project's
   enabled rules for that trigger and the item's facts, evaluates triggers and conditions, and claims
   `(rule, event)` with an `automation_run` row (unique index) before running the actions.
3. Each action runs in its own savepoint. Field changes go through `services/system-update.ts`, which writes the
   timeline rows (`actor_kind = 'rule'`, no user, `data.ruleId/ruleName`) and emits events whose actor is
   `{ kind: "integration", id: "rule:<ruleId>" }` carrying `ruleChain`. Webhook, email and tracker actions are queued
   after commit (`afterOrgCommit`), never during the transaction.
4. **Loop protection:** a rule never runs for an event whose `ruleChain` contains it (logged as `skipped`); chains stop
   at `AUTOMATION_MAX_DEPTH` = 3; `(rule, event)` is unique so retries are idempotent.

Webhook payloads sent by `notify_webhook` use the triggering event name and add `data.rule = { id, name }`.

## AI label suggestions

Stored in `label_suggestion` (one row per item and name, any state). The AI job stores them when the project has
`aiConfig.enabled` and `aiConfig.autoLabels` (default on). The request sends only the report title, text, page URL and
the project's label names. `aiConfig.autoApplyLabels` (default **off**) applies suggestions of existing labels without
asking, attributed to the AI on the timeline; a new label is never created without a person accepting it.

| Method and path                                          | Permission        | Answer                                                                                                                                      |
| -------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/feedback/:id/ai/labels`                        | read              | `{ suggestions: { id, feedbackId, labelId, name, color, reason }[] }` (pending only; `labelId: null` = a new label)                         |
| `POST /api/feedback/:id/ai/labels/:suggestionId/accept`  | `feedback.update` | `{ accepted, dismissed }` (adds the label, creating a proposed one)                                                                         |
| `POST /api/feedback/:id/ai/labels/:suggestionId/dismiss` | `feedback.update` | `{ accepted, dismissed }`                                                                                                                   |
| `POST /api/ai/labels/bulk`                               | `feedback.update` | body `{ feedbackIds: uuid[1..100], action: "accept" \| "dismiss" }` → `{ accepted, dismissed }`; items that are gone or foreign are skipped |

Accepting goes through `updateFeedback`, so it is the person's change: timeline row, `feedback.labels_changed`
webhook, realtime update. The project switches are `PATCH /api/projects/:id/ai` fields `autoLabels` and
`autoApplyLabels`.
