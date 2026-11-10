# ADR 0028 — Automation rules and AI label suggestions

**Status:** accepted

## Context

Competitors (Userback, Usersnap) route reports with rules. Pinwren already had domain events, a job queue, webhooks,
tracker sync and AI triage, but every triage decision was manual or a fixed per-project switch. We want per-project
rules, and AI label suggestions a person accepts in one click, without weakening the Cloud tenant boundary
(`docs/security/cloud-tenant-isolation.md`) or the privacy settings of AI triage.

## Decision

1. **Storage.** Three tenant tables in migration `0012`: `automation_rule` (trigger, conditions, actions as validated
   JSON, a round-robin counter), `automation_run` (the run log) and `label_suggestion` (ghost chips). All have a direct
   `org_id`, the `pinwren_tenant` policy and composite `(id, org_id)` foreign keys to their parents (project, rule,
   feedback, label); they are in the tenant inventory, which the isolation tests compare with the schema.
2. **Engine runs as a job after commit.** The dispatcher queues `automation.run` per relevant event (keyed by the event
   id). The handler runs in one `withOrg` scope; network work is only queued (`afterOrgCommit`), never done in the
   transaction. Rules do not run in the request that caused the event, so ingest is never slowed or blocked by a rule.
3. **Loop protection in three layers.** Events produced by a rule carry `ruleChain`; a rule is skipped (and logged) when
   it is already in the chain; chains stop at 3 hops; `(rule_id, event_id)` is unique so a retried job is idempotent.
   Rule edits go through `systemUpdateFeedback`, so a rule's change is announced like a person's (webhooks,
   notifications, SSE) but attributed to the rule (`activity.actor_kind = 'rule'`, no user id).
4. **Fixed vocabulary, no scripting.** Four events, eight conditions and eight actions, validated by one Zod schema
   shared by API, dashboard and engine. Every id a rule names is checked against the workspace (and project) when it
   is saved and again when it runs. A condition list is AND only; OR is expressed with several rules or multi-value
   conditions.
5. **Round robin** hands out unassigned items only, over the sorted pool of non-viewer members, advancing an
   atomically incremented counter. It never takes an item from an assignee.
6. **AI labels reuse the AI job and its privacy gates.** The label request runs after the other tasks inside the same
   enrichment job (so privacy mode, the AI-enabled switches and the provider setup apply unchanged) and sends only the
   report text, the page URL and the project's label names: no screenshot, replay or captured logs. Suggestions are
   stored, not applied. `autoApplyLabels` is an explicit per-project opt-in (default off) that applies existing labels
   only; a new label is created only when a person accepts it.
7. **Run log retention** is 30 days, pruned by `retention.apply` like webhook deliveries.

## Consequences

- A rule's `set_status` is announced as an integration-actor event, so (like inbound tracker changes) it does not push a
  close/reopen to a linked tracker issue.
- Action results in the run log are English text written by the server; the action names, statuses and the timeline
  sentences are translated in the dashboard.
- Rules are not part of the public token API or MCP yet; they are a dashboard feature.
