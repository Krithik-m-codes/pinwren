# 03 — Data model

PostgreSQL 16+, Drizzle ORM. Conventions:

- Primary keys: **UUIDv7** (`uuid` type, generated in app) — sortable, index-friendly, safe to expose.
- Every tenant-scoped table has `org_id uuid not null` and an RLS policy `org_id = current_setting('app.current_org')::uuid` (enabled in Cloud; harmless in self-host).
- Timestamps `created_at`, `updated_at` (`timestamptz`, default `now()`); soft delete via `deleted_at` only where noted.
- Enums as Postgres enums (migrations add values, never remove).
- JSONB for flexible payloads; GIN indexes only where queried.
- Text search: `search tsvector` generated column on `feedback` (title + body + url), GIN-indexed.

Better Auth owns its tables (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, `passkey`, plus `ee` SSO tables). Map its `organization` to our `org`. Do not duplicate identity data.

## Core tables

### `org` (Better Auth organisation + our fields)
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| name, slug | text | slug unique |
| plan | enum `community, enterprise, cloud_free, cloud_pro, cloud_business, cloud_enterprise` | |
| settings | jsonb | branding, defaults (validated by Zod) |
| stripe_customer_id | text null | Cloud |
| created_at, updated_at | timestamptz | |

### `project`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| org_id | uuid fk | |
| name, slug | text | unique (org_id, slug) |
| public_key | text unique | `pk_live_…`/`pk_test_…`, shown in the snippet |
| allowed_origins | text[] | hostname patterns (`example.com`, `*.example.com`, `localhost:3000`) |
| widget_config | jsonb | launcher, theme, modes enabled, visibility rules, locale |
| capture_config | jsonb | console level, network mode, replay on/off + duration, masking selectors |
| public_read | boolean | visitors may list pins (default true for review, false for bug-only) |
| retention_days | int null | null = keep forever |
| archived_at | timestamptz null | |

### `page`
Normalised URLs to group feedback and power the page view.
| id | uuid pk | | org_id, project_id | | url | text (normalised: no hash, sorted query, configurable ignored params) | | url_pattern | text null | | title | text | | last_seen_at | timestamptz |
Unique `(project_id, url)`.

### `feedback`
| column | type | notes |
|---|---|---|
| id | uuid pk | |
| org_id, project_id, page_id | uuid | |
| number | int | per-project sequence (`#142`), via `project_counter` row lock |
| kind | enum `comment, bug, idea, question` | |
| status | enum `open, in_progress, in_review, resolved, wont_fix, duplicate` | |
| priority | enum `none, low, medium, high, urgent` | |
| title | text null | |
| body | text | Markdown subset, sanitised on render |
| reporter_id | uuid null | team user if logged in |
| reporter_guest | jsonb null | `{ name, email, externalId, verified }` |
| assignee_ids | uuid[] | |
| due_at | timestamptz null | |
| duplicate_of | uuid null fk feedback | |
| round_id | uuid null fk review_round | |
| client_id | uuid unique per project | idempotency |
| anchor | jsonb | anchor bundle (see 05) |
| anchor_confidence_last | real null | last reported re-attach confidence |
| viewport, environment | jsonb | browser, os, device, dpr, locale, tz, referrer |
| metadata | jsonb | customer metadata from `setMetadata` |
| ai | jsonb null | summary, suggested severity, embedding ref |
| source | enum `widget, extension, api, email, mcp` | |
| resolved_at, closed_by | | |
| search | tsvector generated | |
| created_at, updated_at, deleted_at | | |
Indexes: `(project_id, status, created_at desc)`, `(project_id, page_id)`, `(org_id, assignee_ids) gin`, `search gin`.

### `feedback_asset`
| id | uuid | | org_id, feedback_id | | kind | enum `screenshot, screenshot_annotated, annotation_layer, replay, attachment, thumbnail` | | storage_key | text | | content_type, bytes, width, height, sha256 | | created_at |

### `upload`
Pre-feedback uploads (expire after 1 h if unclaimed; cleanup job).
| id | org_id, project_id | storage_key | content_type | bytes | claimed_at | expires_at |

### `diagnostics`
Kept separate from `feedback` to keep list queries light.
| feedback_id pk | console jsonb | network jsonb | errors jsonb | performance jsonb |

### `comment`
| id | org_id, feedback_id | author_id null | author_guest jsonb null | body | visibility enum `public, internal` | edited_at | created_at | deleted_at |

### `label`, `feedback_label`
Per-project labels (name, colour) and the join table.

### `review_round`
| id | org_id, project_id | name | due_at | status enum `active, closed` | created_by |

### `saved_view`
| id | org_id | owner_id null (null = shared) | name | filters jsonb | layout enum `list, board` |

### `activity`
Immutable event stream per feedback (status changed, assigned, labelled, synced, commented). Drives the timeline and notifications.
| id | org_id, feedback_id | actor_id null | actor_kind enum `user, guest, system, integration, ai` | type | data jsonb | created_at |

### `notification` and `notification_preference`
In-app inbox items and per-user, per-project channel preferences.

### `integration` and `integration_link`
| integration: id, org_id, project_id null, provider enum, config jsonb, secrets bytea (encrypted), status, last_error |
| integration_link: feedback_id, integration_id, external_id, external_url, last_synced_at, state jsonb |

### `webhook_endpoint`, `webhook_delivery`
Endpoint (url, secret encrypted, events[], active) and per-attempt deliveries (status, response code, duration, next_retry_at), retained 30 days.

### `api_token`
| id | org_id | user_id null | name | prefix | hash (argon2id) | scopes text[] | last_used_at | expires_at |

### `review_link`
Guest review tokens: `id, org_id, project_id, token_hash, label, expires_at, permissions jsonb, created_by`.

### `setting`
Instance-level key/value (self-host), e.g. SMTP set via UI. `key text pk, value jsonb, secret bytea null, updated_by`.

### `license` (self-host, ee)
`id, payload jsonb, signature text, installed_at, installed_by`.

### `audit_log` (ee)
`id, org_id, actor_id, actor_ip, action, target_type, target_id, data jsonb, created_at` — append-only (no update/delete grants).

### `usage_counter` (Cloud)
`org_id, period (date), reports int, replay_bytes bigint, ai_calls int` — enforcement of plan limits.

## Retention & cleanup jobs

| Job | Schedule | Action |
|---|---|---|
| `uploads.expire` | every 15 min | delete unclaimed uploads past `expires_at` (DB + storage) |
| `retention.apply` | daily | hard-delete feedback older than project `retention_days` (+ assets), skip legal hold |
| `webhook_delivery.prune` | daily | delete deliveries > 30 days |
| `replay.prune` | daily | replay assets older than plan limit (Cloud) |
| `gdpr.erase` | on request | delete/anonymise all data for a reporter email |
