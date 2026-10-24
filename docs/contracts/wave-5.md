# Wave 5 contract — release completion

The release goal: create a project, add the widget, set up SMTP, report bugs from a site, and have them reach the
team by email, the bell and integrations, with nothing half built. A foundation pass landed the shared schema and
types first; six builders then work in parallel on the areas below.

**Product model: BugPin** (the owner's direction; it overrides the audit and ADR 0021 where they conflict). The first
account created on a fresh instance **is** the instance admin: no setup token, no `/setup` claim, no log digging
(`PINWREN_ADMIN_EMAILS` stays as an optional extra). Everything is configured in the dashboard: Settings › Email
(SMTP) is open to that admin straight away; env vars stay optional overrides. Admins add users directly (Users › Add
User: name, email, password, role) or invite them by email. Roles are **Admin / Editor / Viewer** (§2, §3.7).
Notifications › General (per-project team recipients), › Reporter (which emails reporters get) and › Email templates
live in the dashboard, and every email really goes out through the configured SMTP.

| Area                    | Owns (files it may change freely)                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **accounts**            | the ADR 0021 amendment, `routes/members.ts` + `routes/me.ts` (new), `packages/api/src/auth.ts`, `routes/setup.ts`, `services/setup.ts`, the `/me` handler block in `routes/dashboard.ts`, `apps/web/src/app/(auth)/**`, `apps/web/src/proxy.ts`, settings › Profile / Workspace / Security, the workspace switcher, `apps/web/src/components/shell/**` (banner, user menu, command palette)                                                                        |
| **email-notifications** | `packages/api/src/email/**`, `jobs/dispatch.ts`, `jobs/index.ts` + `jobs/boss.ts` (email + digest queues), `realtime/bus.ts`, `routes/realtime.ts`, `routes/admin.ts` (email settings), `services/feedback-payload.ts`, the notification + preference handlers in `routes/dashboard.ts`, settings › Email / Notifications (General, Reporter, Email templates), `routes/project-notifications.ts` (new), `components/notifications-bell.tsx`, a notifications page |
| **widget**              | `packages/widget/**`, `packages/react/**`, `routes/widget.ts` (`/w`), the page-link route (new file), `packages/core/src/origins.ts`                                                                                                                                                                                                                                                                                                                               |
| **triage**              | `services/feedback.ts`, the feedback / comment handlers in `routes/dashboard.ts`, `realtime/publish.ts`, `export/**`, labels routes (new file), `apps/web/src/app/(app)/inbox/**`, board / pages views, `lib/store/api/feedback.ts`, `lib/inbox-filters.ts`, `lib/store/listeners.ts` (feedback/comment events)                                                                                                                                                    |
| **install-onboarding**  | the project handler blocks in `routes/dashboard.ts` (`/projects…`), `apps/web/src/app/(app)/projects/**` (install, origins, privacy, widget tabs), `apps/web/src/app/(app)/onboarding/**`, the inbox empty state + setup checklist, `docker/**`, `docs/self-hosting/**`, review-link routes (new file)                                                                                                                                                             |
| **integrations**        | `packages/api/src/webhooks/**`, `routes/webhooks.ts`, `integrations/**`, `routes/integrations.ts`, settings › Integrations                                                                                                                                                                                                                                                                                                                                         |

Rules for shared files:

- `routes/dashboard.ts` is touched by three areas. Put new endpoints in a **new route file** mounted from
  `packages/api/src/index.ts` (one `.route("/api", …)` line each) instead of growing `dashboard.ts`; edit only your
  own handler blocks there. If an edit fails because the file moved under you, re-read and re-apply.
- `packages/core` and `packages/db` are frozen after the foundation pass. If you truly need a column, add it to the
  end of `packages/db/drizzle/0005_complete.sql` **and** the Drizzle schema, and say so in your report.
- `scripts/smoke.mjs`: add your checks in your own `// ===… Wave 5 — <area>` section, before the final summary.
- Change this file in the same edit if you must change the contract, and say so in your report.

## 1. Database (migration `0005_complete`)

Already applied by the foundation pass; Drizzle names in parentheses.

| Table / column                                                | Type                                                                                                                                                                       | Notes                                                                                                                                                                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `label` (`label`)                                             | `id uuid pk, org_id, project_id fk cascade, name, color, created_at`                                                                                                       | unique `(project_id, lower(name))` = `label_project_name_uq`; colour is a hex string                                                                                                                            |
| `feedback_label` (`feedbackLabel`)                            | `feedback_id fk cascade, label_id fk cascade`, pk both                                                                                                                     | index on `label_id` for the list filter                                                                                                                                                                         |
| `feedback.due_at` (`dueAt`)                                   | `timestamptz null`                                                                                                                                                         |                                                                                                                                                                                                                 |
| `feedback.duplicate_of_id` (`duplicateOfId`)                  | `uuid null`, self fk `on delete set null`                                                                                                                                  | indexed                                                                                                                                                                                                         |
| `comment.mentions` (`mentions`)                               | `text[] not null default '{}'`                                                                                                                                             | user ids are Better Auth text ids (uuid-shaped), so `text[]` like `feedback.assignee_ids`                                                                                                                       |
| `feedback_watcher` (`feedbackWatcher`)                        | `feedback_id fk cascade, user_id fk cascade, created_at`, pk both                                                                                                          | index on `user_id`                                                                                                                                                                                              |
| `notification.event_id` (`eventId`)                           | `text null`                                                                                                                                                                | unique `(user_id, event_id, type)` = `notification_user_event_type_uq`; null never conflicts                                                                                                                    |
| `notification_preference.mentioned`, `.priority_changes`      | `boolean not null default true`                                                                                                                                            | per user and project, like the other switches                                                                                                                                                                   |
| `user_preference` (`userPreference`)                          | `user_id text pk fk cascade, email_digest email_digest default 'off', email_paused bool default false, last_digest_at null, avatar_key text null, created_at, updated_at`  | enum `email_digest` = `off, hourly, daily`. Account-wide (not per workspace). No row = defaults                                                                                                                 |
| `email_delivery` (`emailDelivery`)                            | `id, org_id null fk cascade, to_address, template_key, subject, status email_delivery_status, error null, attempts int default 1, payload jsonb, created_at, sent_at null` | enum `sent, skipped, failed`; index on `created_at`. `payload` = `{ to, subject, html, text, headers?, suppressionOrgId? }` (type `EmailDeliveryPayload`) for resend. Retention sweep: email-notifications      |
| `webhook_delivery.domain_event_id` (`domainEventId`)          | `text null`                                                                                                                                                                | unique `(endpoint_id, domain_event_id) where domain_event_id is not null`. The existing `event_id` (uuid, shared by an event's attempts) stays: it is the payload id. Set only on a first attempt from dispatch |
| `project.rejected_origins` (`rejectedOrigins`)                | `jsonb not null default '[]'`                                                                                                                                              | `RejectedOrigin[]` = `{ origin, at (ISO), count }`, newest first, ≤ `MAX_REJECTED_ORIGINS` (10)                                                                                                                 |
| `feedback_asset.annotations`, `.capture`                      | `jsonb null`                                                                                                                                                               | on the `screenshot` asset: `AnnotationLayer` and `CaptureGeometry` (§2)                                                                                                                                         |
| `review_link` (`reviewLink`)                                  | `id, org_id, project_id fk cascade, label, token_hash unique, expires_at null, created_by null, created_at, last_used_at null, revoked_at null`                            | only SHA-256 hex of the token is stored                                                                                                                                                                         |
| `two_factor` (`twoFactor`), `user.two_factor_enabled`         | Better Auth `twoFactor` plugin tables                                                                                                                                      | for accounts, if 2FA ships                                                                                                                                                                                      |
| `project.notify_member_ids` (`notifyMemberIds`)               | `text[] null`                                                                                                                                                              | Notifications › General: members who get new-report notifications. null = every member (each filtered by their own preferences)                                                                                 |
| `project.notify_emails` (`notifyEmails`)                      | `text[] not null default '{}'`                                                                                                                                             | Notifications › General: extra addresses (no account) that get every new-report email, ≤ `MAX_NOTIFY_EMAILS` (20)                                                                                               |
| `project.reporter_email_received`, `.reporter_email_status`   | `boolean not null default true`                                                                                                                                            | Notifications › Reporter, under the `notify_reporter` master switch. Public team replies always go out while the master is on                                                                                   |
| `project.reporter_email_priority`, `.reporter_email_assigned` | `boolean not null default false`                                                                                                                                           | Notifications › Reporter                                                                                                                                                                                        |
| Roles                                                         | no schema change                                                                                                                                                           | Admin / Editor / Viewer map onto `member.role` `owner` or `admin` / `member` / `viewer` (§2, §3.7)                                                                                                              |
| Defaults                                                      | `project.public_read` default **false**; `project.notify_reporter` default **true**                                                                                        | existing rows unchanged                                                                                                                                                                                         |
| Data                                                          | existing projects get `widget_config.visitorsCanResolve = true` where unset                                                                                                | `visitorsCanResolve` now defaults to false (§2); old projects behave as before                                                                                                                                  |

## 2. Shared schemas and types (`packages/core`)

All exported from `@pinwren/core`. Derive request and response types from these; never hand-write them.

- `EMAIL_TEMPLATE_KEYS` adds `password_reset, verify_email, change_email, mentioned, priority_changed,
feedback_deleted, digest, reporter_received, webhook_disabled`. Every key has a working default in
  `packages/api/src/email/templates.ts` (variables listed there; email-notifications may reword and enrich). The three
  account templates carry `account: true` and are left out of `ORG_TEMPLATE_KEYS` (the workspace template editor);
  render them with `renderEmail(null, key, vars)`.
- `WEBHOOK_EVENTS` adds `feedback.priority_changed, feedback.labels_changed, feedback.deleted, comment.updated,
comment.deleted`.
- `NOTIFICATION_TYPES` (bell `type`) adds `feedback.priority_changed, feedback.deleted, comment.mentioned,
webhook.disabled`. `webhook.disabled` rows have `feedbackId: null`.
- `feedbackUpdate` adds `labelIds: uuid[] (≤ 20, replaces)`, `dueAt: ISO | null`, `duplicateOfId: uuid | null`,
  `kind`. **Implemented** in `services/feedback.ts` `updateFeedback`: labels must belong to the item's project
  (`400 INVALID_LABEL`); a duplicate must be another live item of the same project (`400 INVALID_DUPLICATE`);
  activity rows `labelIds_changed`, `dueAt_changed`, `duplicateOfId_changed`, `kind_changed`; the response adds
  `labelIds` when they were sent. Setting status `duplicate` is the caller's job (send both).
- `feedbackListQuery` adds `labelId`, `reporter` (name/email contains), `hasReplay` (bool), `browser` (contains),
  `trash` (bool; org admins only), `sort: created|updated|priority` (default `created`), `order: asc|desc` (default
  `desc`). Query-string booleans accept `true/false/1/0`. The existing `page` filter is the "page URL contains" filter.
  **Not yet applied** by `listFeedback`: triage implements them, including a cursor that works for every sort.
- `labelCreate { name 1–40, color hex }`, `labelUpdate` (partial), `MAX_LABELS_PER_PROJECT` (100), `MAX_LABELS_PER_ITEM` (20).
- `commentCreate.mentions?: string[]` (≤ 20 user ids).
- `notificationPreferenceInput` adds `mentioned`, `priorityChanges`. `notificationsRead` adds `{ feedbackId }`.
- `userPreferenceUpdate { emailDigest?: off|hourly|daily, emailPaused?: boolean }`; `EMAIL_DIGEST_FREQUENCIES`.
- `emailSettingsUpdate` adds `requireTls`, `allowSelfSigned` (nullable booleans; env `SMTP_REQUIRE_TLS`,
  `SMTP_TLS_REJECT_UNAUTHORIZED` lock them). Stored, resolved and passed to nodemailer already (`requireTLS`,
  `tls.rejectUnauthorized`). `emailTest` adds `config?: EmailSettingsUpdate` (unsaved values to test).
- `widgetFeedbackCreate` adds `annotations?: AnnotationLayer` (`{ v: 1, width, height, shapes[] ≤ 200 }`, ≤ 64 KB,
  tools `rect, ellipse, arrow, pen, text, blur, crop, highlighter, step`) and `capture?: CaptureGeometry`
  (`{ vw, vh, scrollY, mode: visible|full|element|screen }`). With `annotations`, `screenshot` is the **unflattened**
  capture.
- `widgetConfig.visibility` adds `mode: always|identified|queryParam|urlPatterns|manual` (default `always`),
  `urlPatterns: string[]` (≤ 50, `urlPattern` syntax), `queryParam` (default `pinwren`). `visitorsCanResolve`
  defaults to **false**.
- `reviewLinkCreate { label, url, expiresInDays? 1–365 }`; `REVIEW_LINK_PARAM = "pinwren_review"`.
- Constants: `REPORTER_TOKENS_HEADER = "x-pinwren-reporter-tokens"`, `MAX_REPORTER_TOKENS = 50`, `DEEP_LINK_PARAM =
"pinwren"`, `PAGE_LINK_TOKEN_PARAM = "pwt"`, `PAGE_LINK_TOKEN_HEADER = "x-pinwren-link-token"`.
- `normalizePageUrl(url, extra?)` (widget pass: also `ref`, a folded trailing slash, and the project's own
  `widgetConfig.ignoredQueryParams` as `extra`; `isIgnoredQueryParam` exported) drops `pinwren`, `pwt`, `pinwren_review`, `utm_*`, `gclid`, `fbclid`, `msclkid`, `mc_cid`,
  `mc_eid` (`IGNORED_QUERY_PARAMS`). Trailing-slash folding and merging existing `page` rows are left to widget.
- Realtime (`STREAM_EVENTS`) adds `comment.updated`, `comment.deleted` (`{ id, feedbackId, projectId }`) and
  `notification.created` (`streamNotificationCreated`: `{ id, type, feedbackId, orgId, data, createdAt }`).
- `DomainEvent.id` (§5).
- **Roles** (`packages/core/src/roles.ts`): `APP_ROLES = admin, editor, viewer`; `appRoleOf(member.role)`
  (`owner`/`admin` → admin, `member` → editor, `viewer` → viewer; the strongest wins in a comma list);
  `ORG_ROLE_FOR` (the stored role for an app role); `PERMISSIONS` + `roleCan(role, permission)` (the matrix in §3.7);
  `memberCreate { name, email, password ≥ 8, role }`, `memberUpdate { role }`, `memberInvite { email, role }`;
  `MIN_PASSWORD_LENGTH` (8). Server side: the `requirePermission(permission)` middleware in
  `packages/api/src/permissions.ts` (`403 FORBIDDEN_ROLE`).
- **Project notifications**: `projectNotifications { memberIds: string[] | null, emails: email[] ≤ 20, reporter: {
enabled, received, statusChanged, priorityChanged, assigned } }` and `projectNotificationsUpdate` (any subset;
  `reporter` merges field by field). `reporter.enabled` is `project.notify_reporter`.
- `EMAIL_TEMPLATE_KEYS` also adds `reporter_priority` (vars `projectName, title, priority, pageUrl, threadUrl`) and
  `reporter_assigned` (`projectName, title, assigneeName, pageUrl, threadUrl`), both with working defaults.
- `VIEWER_ALLOWED_MUTATIONS` (`permissions.ts`) already lists the wave-5 personal routes: `POST/DELETE
/api/feedback/:id/watch`, `POST /api/feedback/:id/page-link`, `PATCH /api/me/preferences`, `PATCH /api/me/profile`,
  `POST/DELETE /api/me/avatar`. Whoever adds one of those routes adds it to the exemption list in
  `permissions.test.ts` (that test lists only routes that exist).

## 3. Cross-area API contract

Session routes are under `/api`, need the active workspace, and refuse viewers' writes (`403 READ_ONLY_ROLE`) as
today. "Owner" builds it (server and its own UI); "consumers" call it and must not reimplement it.

### 3.1 Instance and account state — owner: **accounts**

- **First account = instance admin** (BugPin). In the sign-up path (`auth.ts` user-create hook or
  `services/setup.ts`), the first user created while `setupNeeded()` is true is added to `instance.admins` inside
  the same advisory lock `claimSetup` uses, so two simultaneous first sign-ups can't both win. Sign-up is open while no
  user exists; afterwards it follows `decideSignup` as today (invitations, `PINWREN_DISABLE_SIGNUP`). The setup token
  goes away: no `issueSetupToken` / `announceSetupToken` log banner, `POST /api/setup/claim` removed (or `410 GONE`),
  and the `apps/web` `/setup` page becomes a redirect (to `/sign-up`, or `/inbox` when signed in) or is deleted with
  its tests and docs. `PINWREN_ADMIN_EMAILS` keeps working as an extra. Write the amendment to
  `docs/adr/0021-pre-release-security-hardening.md` (why: a self-hoster must reach SMTP without reading logs; the
  exposure is the time between start and the owner's sign-up, the trade BugPin makes; self-hosting docs say to keep
  the instance private until the first account exists).
- **Users › Add User** (`routes/members.ts`, Admins only = `requirePermission("users.manage")`):
  `POST /api/members` (`memberCreate`) → `201 { member: { id, userId, name, email, appRole, createdAt } }` creates the
  account (Better Auth server API or internal adapter, without switching the caller's session; email marked
  verified) and adds it to the active workspace with `ORG_ROLE_FOR[role]`; `409 EMAIL_TAKEN` when the address already
  has an account (the UI then offers "Invite instead"). `PATCH /api/members/:userId` (`memberUpdate`) → `{ member }`;
  `DELETE /api/members/:userId` → `204`. The owner can't be demoted or removed and the last Admin can't be demoted
  (`400 OWNER_LOCKED` / `400 LAST_ADMIN`). `GET /api/members` adds `appRole` to each row. Invitations stay the second
  option and take the same three roles (`memberInvite`, mapped with `ORG_ROLE_FOR`).
- **Own account** (`routes/me.ts`, every role): `PATCH /api/me/profile { name }`, `POST /api/me/avatar` (image upload,
  stored under `user_preference.avatar_key`; `user.image` = `/api/avatars/:userId`), `DELETE /api/me/avatar`,
  `GET /api/avatars/:userId` (session, same workspace). Password change uses Better Auth `changePassword`. Personal
  notification switches stay `PUT /api/notification-preferences` and `/api/me/preferences` (§3.2, email-notifications).
- `GET /api/me` adds `setupNeeded: boolean` (no instance admin yet, `setupNeeded()`; under BugPin true only before
  the first account exists), `appRole: AppRole` (for `roleCan` in the UI), `emailConfigured: boolean`
  (`resolveSmtp() !== null`; any signed-in member may read it) and `signupOpen: boolean` (an uninvited stranger could
  sign up now). Consumers: install-onboarding (setup checklist, empty states), email-notifications (the "email isn't
  set up" notices on Settings › Notifications), accounts (invite toast, setup banner).
- `GET /api/setup` (public, no session) → `{ needed: boolean, signupOpen: boolean, emailConfigured: boolean,
appUrl: string }`. `needed` = no account yet: the sign-in page sends the visitor to `/sign-up` ("Create the
  administrator account"). The sign-in page hides "Create an account" when `signupOpen` is false; forgot-password
  says "ask your administrator" when `emailConfigured` is false; `appUrl` (PINWREN_URL's origin) drives the
  wrong-address hint on the auth pages. _(Built: accounts added `emailConfigured` and `appUrl`.)_
- **Built by accounts beyond the list above** (all in `routes/me.ts`, `routes/members.ts`, `routes/workspace.ts`):
  `GET /api/me/invitations` → `{ invitations: { id, organizationId, organizationName, role, appRole, expiresAt,
inviterName }[] }` (session only, no workspace needed; `routes/me.ts` is mounted **before** the dashboard router
  and checks the session per route); `POST /api/me/email { newEmail, password }` (servers without SMTP; `409
VERIFY_BY_EMAIL` when SMTP is set up, `400 INVALID_PASSWORD`, `409 EMAIL_TAKEN`); `GET /api/avatars/:userId`
  (anyone sharing a workspace); `POST /api/members/:userId/reset-link` → `{ url, expiresAt }` (instance admins, 24 h,
  Better Auth's own reset token); `PATCH /api/workspace { name }` (`settings.manage`), `POST /api/workspace/transfer
{ userId }` and `DELETE /api/workspace { confirm }` (owner; `400 CONFIRM_MISMATCH`; deletes stored files too);
  `GET/POST /api/admin/instance-admins`, `DELETE /api/admin/instance-admins/:userId` (`409 ENV_LOCKED`, `400
LAST_ADMIN`). `GET /api/me` `user` also carries `emailVerified` and `twoFactorEnabled`. `POST /api/setup/claim` →
  `410 SETUP_TOKEN_REMOVED`. Migration: `two_factor.verified`, `.failed_verification_count`, `.locked_until`
  appended to `0005_complete.sql` (Better Auth 1.7's two-factor plugin writes them).
- **Sign-in methods** (built by the sign-in-methods builder; `settings/sign-in.ts`, `routes/sign-in-methods.ts`,
  the plugins in `auth.ts`): passkeys (`@better-auth/passkey`, table `passkey` appended to `0005_complete.sql`),
  email sign-in links (`magicLink`, template `magic_link`, account email; only with SMTP), Google / GitHub from
  `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET` (both halves or neither), account linking.
  `GET /api/sign-in-methods` (public) → `{ methods: { password, magicLink, passkey, google, github } }`;
  `GET/PATCH /api/admin/settings/sign-in` (instance admins, `{ magicLink?, passkeys? }` strict) →
  `{ signIn: { magicLink, passkeys, emailConfigured, providers[] } }`. A switched-off method answers
  `400 MAGIC_LINK_DISABLED` / `400 PASSKEYS_DISABLED`. Every account created through an `/api/auth` endpoint
  (password, OAuth, email link) passes `signupAllowed` in the user-create hook (`403 SIGNUP_CLOSED`, or
  `?error=SIGNUP_CLOSED` on the OAuth / link redirect); Add User (no auth endpoint) is exempt.
- Password reset, email verification and email change use Better Auth's own endpoints. accounts enqueues
  `renderEmail(null, "password_reset" | "verify_email" | "change_email", vars)` on `QUEUES.email` with the template
  variables in §2. When `emailConfigured` is false, the UI says so instead of pretending to send.
- Sign-in keeps the destination: the proxy redirects to `/sign-in?next=<path+query>`; after sign-in (and sign-up /
  accept-invitation) the app goes to `next` when it is a same-origin relative path, else `/inbox`.
- **Workspace switch from links**: `/inbox?org=<orgId>&item=<feedbackId>`. When `org` differs from the active
  workspace and the user is a member, the inbox calls `organization.setActive({ organizationId })` and reloads the
  same URL without `org`; if they are not a member, it shows "You don't have access to this item's workspace".
  accounts implements the switch; email-notifications produces the links (§3.2).

### 3.2 Notifications, email, mentions, watchers — owner: **email-notifications**

- `feedbackLink(orgId, feedbackId)` (in `services/feedback-payload.ts`, already changed by the foundation) →
  `${PINWREN_URL}/inbox?status=all&org=<orgId>&item=<id>`. Every email, chat message, tracker issue and export uses it.
- **Watchers**: `POST /api/feedback/:id/watch` → `{ watching: true }`, `DELETE /api/feedback/:id/watch` →
  `{ watching: false }` (any member who can read the item; viewers may watch). Auto-watch: the reporter if a member,
  assignees on assign, commenters on comment, the mentioned on mention. `GET /api/feedback/:id` adds
  `watching: boolean` for the caller — email-notifications provides `isWatching(feedbackId, userId)` (in
  `services/watchers.ts`, with `addWatchers` / `removeWatcher` / `watcherIds`) and triage adds it to the detail payload. Status, priority, reply and delete notifications go to assignees **plus watchers**; a
  guest status change on an item nobody is involved in goes to every member with `statusChanges` on. Consumer: triage
  "Follow" button in the detail header.
- **Mentions**: `POST /api/feedback/:id/comments` accepts `mentions: string[]`. triage implements the storing side
  in its handler and `addTeamComment`: each id must be a member of the workspace (`400 INVALID_MENTION` otherwise;
  duplicates and the author are dropped) and lands in `comment.mentions`. email-notifications' dispatch reads them on
  `comment.created` and writes `comment.mentioned` notifications (pref `mentioned`, template `mentioned`), skipping
  those users in the plain reply notification. Composer autocomplete uses the existing `GET /api/members`
  (consumer: triage).
- `POST /api/notifications/read` accepts `{ ids } | { feedbackId } | { all: true }`, scoped to the active workspace
  (done by the foundation). Consumer: triage calls `{ feedbackId }` when the detail pane opens an item.
- `GET /api/notifications` adds `?before=<cursor>` paging and `nextCursor`, and leaves out items in the trash.
- **Realtime**: after inserting notification rows, dispatch publishes one `notification.created` per recipient;
  `realtime/bus.ts` delivers it only to that user's streams (subscribers carry `userId`). The bell invalidates on it
  instead of on raw feedback events. Desktop notifications (opt-in, per device) hang off the same event.
- **Domain events handled** in `jobs/dispatch.ts`: `feedback.priority_changed` (pref `priorityChanges`, template
  `priority_changed`), `feedback.deleted` (template `feedback_deleted`; `loadFeedbackContext` must load the
  soft-deleted row for this event), `comment.mentioned` (above), `reporter_received` on `feedback.created` when
  `notifyReporter` and the reporter left an email (CTA = signed page link, §3.3).
- `GET /api/me/preferences` → `{ emailDigest, emailPaused }`; `PATCH /api/me/preferences` (`userPreferenceUpdate`).
  Paused or digest users get no instant team email; the `notify.digest` cron sends `digest` per user and workspace.
- `GET /api/notification-preferences` returns `mentioned`, `priorityChanges` and `emailConfigured`.
- **Delivery log** (instance admins, `routes/admin.ts`, under `/api/admin` like the other instance settings): every
  `notify.email` job writes `email_delivery` (sent, skipped with the reason, or failed after the last retry).
  `GET /api/admin/settings/email/deliveries?limit=50&status=` → `{ items: { id, to, templateKey, subject, status,
error, attempts, createdAt, sentAt }[], skippedNotConfigured }` (no bodies);
  `POST /api/admin/settings/email/deliveries/:id/resend` → `{ delivery }` (sends now; `409 EMAIL_NOT_CONFIGURED` /
  `409 UNSUBSCRIBED`); `POST /api/admin/settings/email/deliveries/resend-skipped` → `{ queued }` (every email skipped
  for missing SMTP in the last 30 days). `POST /api/admin/settings/email/test` honours `config` (unsaved values) and
  runs `transport.verify()` first; a `from` that isn't `address` / `Name <address>` is `400 INVALID_FROM` there and on
  `PATCH`. Messages queued on `QUEUES.email` should carry `templateKey` and `orgId`: `renderEmail()` returns both, so
  `{ to, ...rendered }` is enough.
- **Notifications › General / › Reporter** (`routes/project-notifications.ts`): `GET /api/projects/:id/notifications`
  → `{ notifications: ProjectNotifications, members: { userId, name, email }[] }` (every role may read);
  `PATCH /api/projects/:id/notifications` (`projectNotificationsUpdate`, Admins = `requirePermission("settings.manage")`)
  → `{ notifications }`. `memberIds` must be members of the workspace (`400 INVALID_MEMBER`). The dashboard page is
  Settings › Notifications with tabs **General** (per project: "All members" or a member multi-select, plus extra
  addresses), **Reporter** (the five switches), **Email templates** (the existing editor from `routes/branding.ts`,
  moved or linked here) and **My notifications** (the personal matrix, digest and pause, for every role).
- **Dispatch rules (BugPin)**: `feedback.created` → bell + email to `notifyMemberIds ?? all members`, each filtered by
  their own `newFeedback` / `email` preference and `email_paused` / digest, **plus** one `feedback_created` email per
  `notifyEmails` address (with a signed one-click unsubscribe that removes that address from the project). The
  `feedback_created` and `feedback_assigned` emails carry the screenshot (signed thumbnail URL), page, browser/OS,
  priority and `feedbackLink`. Reporter emails go only to `reporterGuest.email` and only while `notifyReporter` is on:
  `reporter_received` on create (`reporterEmailReceived`), `reporter_status` on a team status change
  (`reporterEmailStatus`), `reporter_priority` (`reporterEmailPriority`), `reporter_assigned` when the assignee list
  changes to a non-empty one (`reporterEmailAssigned`), `reporter_reply` on every public reply. None for a change the
  reporter made themselves.
- Team emails get a "Manage notifications" footer (`/settings/notifications?tab=mine`) and a signed one-click
  `List-Unsubscribe` that turns off email for that project's preference row: `GET|POST /api/unsubscribe/team?token=`
  (`email/links.ts`, HKDF purpose `team-unsubscribe v1`; the same route removes an extra address from the project).
  Screenshots in emails: `GET /api/email-assets/:token` (purpose `email-image v1`, 180 days, images only, not for
  items in the trash).
- **Bell rows** are written with `notify()` in `jobs/notify.ts`, which also publishes the per-user
  `notification.created` stream event. Anything else that writes notification rows (e.g. `webhooks/disabled.ts`) should
  publish the same `{ t: "n", orgId, userId, data }` bus message (`realtime/bus.ts`), or the bell only catches up on
  its 60 s poll.
- Settings › Notifications tabs are addressable: `/settings/notifications?tab=general|reporter|templates|mine`.

### 3.3 Widget, deep links, reporters, origins — owner: **widget**

- `POST /api/feedback/:id/page-link` (session; any member who can read the item) → `{ url: string, expiresAt:
string }`. `url` = the item's page URL plus `pinwren=<feedbackId>&pwt=<token>`, where the token is
  `base64url(feedbackId.expiresAtSeconds).hmac` signed with an HKDF key from `PINWREN_SECRET` (like
  `email/unsubscribe.ts`), valid 7 days. Helper `pageLinkUrl(feedbackId, pageUrl, ttlDays?)` exported from a new
  `services/page-link.ts` so email templates can embed it (`threadUrl` in `reporter_received`, `reporter_reply`,
  `reporter_status`, `reporter_priority`, `reporter_assigned`). Consumers: triage "Open on page" (calls the route, opens `url`), email-notifications.
- `GET /w/feedback/:id` with header `x-pinwren-link-token: <pwt>` returns that one pin (same shape as an item of
  `GET /w/feedback`) and its public replies **even when `publicRead` is off**, so the widget can open the thread from
  a deep link. Invalid or expired token → `404`. **Built** as `{ item, replies, scope: "read" | "repin" }`; the
  same token (or the item's reporter token) also opens `GET/POST /w/feedback/:id/comments` on a private project.
- `GET /w/mine` with header `x-pinwren-reporter-tokens: <token>,<token>…` (≤ 50 reporter tokens this browser holds
  for the project) → `{ items: PinItem[] }`: the reporter's own items and their public replies regardless of
  `publicRead`. The widget's "Mine" filter and "View comments" use it. **Built** with optional `?url=` /
  `?urlPattern=` (this page only, matched like `GET /w/feedback`); closed items included.
- **Re-pin (widget pass)**: `POST /api/feedback/:id/page-link` accepts an optional body `{ repin: true }` (Admins and
  Editors, else `403 FORBIDDEN_ROLE`) → a 24-hour link whose token is `base64url(id.exp.repin).hmac`; the widget opens
  it in re-pin mode and saves with `PATCH /w/feedback/:id/anchor { anchor }` + `x-pinwren-link-token`
  (`403 REPIN_NOT_ALLOWED` for a read link). Team/API: `PATCH /api/feedback/:id/anchor { anchor }`
  (`feedback.update`). Both write an `anchor_changed` activity row with `data: { from: <old anchor>, via }`
  (triage: render it in the timeline). Route file `routes/page-links.ts`, mounted in `index.ts` after `dashboard`.
- **Page grouping (widget pass)**: `widgetConfig.ignoredQueryParams` (≤ 30 names, trailing `*` = prefix; core
  `config.ts`) joins the built-in list on ingest and on `GET /w/feedback?url=`. Startup merges stale page rows
  (`services/page-merge.ts`, from `runStartupFixes`); `POST /api/projects/:id/pages/regroup` (`projects.manage`) →
  `{ merged }` re-groups one project at once (Page Review › URL grouping calls it after saving).
- **Rejected origins**: in the `/w` middleware, when the key is valid but the origin is refused, update
  `project.rejected_origins` (throttled: at most one write per origin per minute; keep 10, newest first, bump
  `count`). Read by install-onboarding via `GET /api/projects/:id` (field `rejectedOrigins`, already in the project
  payload); "Allow" is a normal `PATCH /api/projects/:id { allowedOrigins }` that also drops now-allowed origins
  from the list (install-onboarding adds that to the PATCH handler).
- `POST /w/feedback` stores `annotations` and `capture` on the screenshot asset; the dashboard detail exposes them on
  that asset (`assets[].annotations`, `assets[].capture`).
- Visibility modes, `Pinwren.show()/hide()/setMetadata()`, screenshot-on-comment, page-level items and error states
  are widget-internal. A valid review link (§3.5) shows the widget in every mode.
- `DELETE /w/feedback/:id` (widget look-and-feel pass) with `x-pinwren-reporter-token` → `204`: the reporter
  deletes their own item from the sidebar; it goes to the trash (`deletedAt`, activity `deleted` with
  `actor_kind: guest`, `feedback.deleted` event, stream delete). No/wrong token → `403 DELETE_NOT_ALLOWED`;
  `readOnly` → `403 READ_ONLY`; gone → `404`. CORS allows `DELETE`. `GET /w/feedback` items carry `pageUrl`
  (already sent by the server); without `url` it lists every page (the sidebar's "All pages").
- Widget kinds are shown SitePing-style: `question` = Question, `idea` = Change, `bug` = Bug, `comment` = Other
  (no new core kinds). Init option / `data-theme`: `light | dark | auto`.

### 3.4 Triage — owner: **triage**

- **Labels**: `GET /api/projects/:id/labels` → `{ labels: { id, name, color, count }[] }`; `POST` (`labelCreate`,
  org admins and members) → `{ label }` (`409 LABEL_EXISTS` on a case-insensitive duplicate); `PATCH
/api/labels/:id` (`labelUpdate`); `DELETE /api/labels/:id`. Item labels through `PATCH /api/feedback/:id {
labelIds }` (implemented). `labels: { id, name, color }[]` on list rows and the detail; `labelId` filter.
- **Trash**: `DELETE /api/feedback/:id` writes a `deleted` activity row and emits `feedback.deleted` (domain event,
  so webhooks and notifications fire) besides the realtime `feedback.deleted`. `POST /api/feedback/:id/restore` →
  `{ feedback }` (org admins), clears `deleted_at`, writes `restored` activity and publishes `feedback.created`
  on the stream. `GET /api/feedback?trash=1` lists deleted items (org admins; others `403`). Hard delete after 30
  days stays in the maintenance job.
- **Export**: `GET /api/feedback/export?format=csv|json|pdf&<feedbackListQuery filters>` (no `limit`/`cursor`),
  streams every matching item with `feedbackLink` as the link column. Optional `ids=<id,id>` for "export selected".
- **Comments**: `PATCH/DELETE /api/comments/:id` emit `comment.updated` / `comment.deleted` domain events
  (`changes: { body: { from, to } }` on update; on delete `changes: { comment: { from: { id, body, visibility },
to: null } }` because the row is gone) and the matching stream events through `realtime/publish.ts`.
- **Detail payload** (`GET /api/feedback/:id`) adds: `feedback.labels`, `feedback.dueAt`, `feedback.duplicateOf:
{ id, number, title } | null`, `watching` (from §3.2), `replyReach: { publicRead, notifyReporter,
reporterHasEmail }`, `feedback.metadata` (already there; render it), `assets[].capture`, `assets[].annotations`.
  List rows add `labels`, `dueAt`, `screenshotAssetId`, and the list response adds `total`.
- Sort, order and the new filters (§2) in `listFeedback`; `#<n>` in `q` matches the number. **Built** (triage):
  `nextCursor` is now an opaque base64url key that works for every sort (old ISO cursors still page the default
  order); `q` also matches prefixes, the reporter's name/email and the page URL; `assigneeId=me` is the caller
  (dashboard list and export).
- Added by triage: `DELETE /api/feedback/:id/forever` (Admins; only items in the trash, `400 NOT_IN_TRASH`, purges
  files), `GET /api/feedback/:id/reproduction` (session version of the v1 route, for "Copy as Markdown"), detail
  `duplicates: { id, number, title }[]` (items marked duplicates of this one), activity rows resolved for the
  timeline (`labelIds_changed` → `added`/`removed` labels, `duplicateOfId_changed` → `toNumber`), and `deleted` /
  `restored` activity types. `DELETE /api/rounds/:id` now needs `feedback.delete` (Admins). Labels routes live in
  `routes/labels.ts`, mounted inside the dashboard router.
- Core change (additive): `viewFilters` (saved views) accepts `labelId`, `reporter`, `sort`, `order`.

### 3.5 Install, onboarding, review links — owner: **install-onboarding**

- Project creation picks a preset: `POST /api/projects` accepts optional `preset: "public-site" | "review"`
  (`public-site`: `publicRead` false, `visitorsCanResolve` false; `review`: `publicRead` true,
  `visitorsCanResolve` true). install-onboarding adds `preset` to `projectCreate` **in its own handler file or block**
  and documents it here.
- **Review links**: `GET /api/projects/:id/review-links` → `{ links: { id, label, url: null, expiresAt, createdAt,
lastUsedAt, revokedAt }[] }`; `POST` (`reviewLinkCreate`, org admins) → `{ link, url }` (the only time the
  token-bearing URL is returned: `url + ?pinwren_review=<token>`); `DELETE /api/review-links/:id` revokes. The widget
  checks a token with `GET /w/review-link` and header `x-pinwren-review-token` → `{ ok: true }` or `404`
  (install-onboarding builds the route in its own file mounted on `/w`; widget consumes it).
- Shows `rejectedOrigins` with "Allow" in the Origins card, PINWREN_URL-based snippets, npm/React tabs, and the setup
  checklist driven by `GET /api/me` (§3.1), `lastSeenAt` and feedback counts.
- **As built** (install-onboarding): `preset` lives in `services/project-setup.ts` (`projectCreateWithPreset`,
  `presetValues`); `POST /api/projects` now also needs `requirePermission("projects.manage")`. Project payloads
  (`projectOut`) add `publicUrl` (`PINWREN_URL`, no trailing slash). `PATCH /api/projects/:id { allowedOrigins }`
  drops now-allowed entries from `rejectedOrigins`. Review links are in `routes/review-links.ts` (`reviewLinks`
  under /api, Admins = `projects.manage`; `reviewLinkWidget` under /w, mounted after `widget` so its key/Origin
  middleware runs first). **Widget area:** add `x-pinwren-review-token` to `corsHeaders` allow-headers in
  `routes/widget.ts`, or the browser's preflight refuses the header.
- **Review links, guest review (as built)**: logic in `services/review-links.ts` (`findReviewLink`,
  `feedbackCounts`, `linkOut`, `reviewUrl`). New column `feedback.review_link_id uuid null` (fk `review_link`,
  set null; index `feedback_review_link_idx`), appended to `0005_complete.sql` + schema + snapshot.
  `REVIEW_TOKEN_HEADER` and `REVIEW_TOKEN_RE` (`pwr_` + base64url) live in core. The widget keeps a valid token
  (`WidgetApi.reviewToken`) and sends it on **every** `/w` request; `POST /w/feedback` with a valid token sets
  `review_link_id` and writes the `created` activity as `{ source: "widget", reviewLink: "<label>" }`; an invalid,
  revoked or expired token never refuses a report, it just isn't attributed. A guest who came through a link must
  give a name (widget-side, `nameNeeded` string in all 11 locales; signed `identify()` users are exempt). The
  widget checks the token in every visibility mode (also `always`), so attribution works everywhere.
  `GET /api/projects/:id/review-links` rows add `feedbackCount` (live items). `feedbackListQuery` and
  `viewFilters` add `reviewLinkId` (inbox URL param `review`); the detail adds `feedback.reviewLink` (`{ id, label }`
  or null). Rate limits: `GET /w/review-link` 30/min per visitor address and project (`429 RATE_LIMITED`), new
  links 50/h per workspace. The dashboard section moved from the Install tab to its own **Review links** tab
  (`?tab=review`, Admins only). Review links do not open private pins: with `publicRead` off a guest sees only
  their own items.
- `GET /api/setup-checklist` (every role) → `{ checklist: { steps: { admin, email, emailSent, widget, feedback,
team }, done, total, projectId } }` from real state (`setupNeeded()`, `resolveSmtp()`, a `sent` `email_delivery`
  row — the test email counts, so email-notifications must log test sends with `templateKey: "test"` —, project
  `lastSeenAt`, live feedback, members > 1 or a pending invitation). The inbox shows it to Admins.
- **Project export** (`routes/project-data.ts`, Admins = `projects.manage`): `POST /api/projects/:id/export` →
  `202 { export }` and queues `project.export` (pg-boss, `jobs/boss.ts` + `jobs/index.ts`); `GET
/api/projects/:id/export` → `{ export: { status: pending|running|ready|failed, requestedAt, finishedAt, expiresAt,
bytes, items, assets, skippedAssets, error, downloadUrl } | null }`; `GET /api/projects/:id/export/download` streams
  the zip. State in `org_setting` (`project-export:<projectId>`), file in storage as `<projectId>/<uuid>.zip`
  (`storage.ts` accepts `.zip`), kept 7 days, replaced by the next export.
- **Erase a reporter** (Admins = `settings.manage`): `POST /api/privacy/erase { email, dryRun? }` → `{ result: {
feedback, comments, emails, dryRun } }` hard-deletes the workspace's feedback whose `reporter_guest.email`
  matches (files too, via `purgeFeedback`), the guest replies elsewhere (a `reporter_erased` activity row on those
  items) and the `email_delivery` rows to that address; `GET /api/privacy/erasures` → `{ erasures: { at, by,
emailSha256, feedback, comments, emails }[] }` (`org_setting` `privacy.erasures`, newest first, ≤ 200).

### 3.6 Integrations — owner: **integrations**

- New webhook events (§2) render in generic, Slack and Discord formats (titles already added); payload `id` is now
  the domain event id, shared by every endpoint and every retry of that event: document "dedupe on `id`".
- When `runDelivery` auto-disables an endpoint, write a `webhook.disabled` notification (`feedbackId: null`, `data:
{ webhookId, name, lastError }`) for each org admin and enqueue the `webhook_disabled` email (respecting
  `user_preference.email_paused`). email-notifications renders it in the bell.
- **Built:** `WEBHOOK_KINDS` adds `teams, telegram, ntfy` and `ISSUE_PROVIDERS` adds `linear, jira` (enum values
  appended to `0005_complete.sql`; no new columns). `webhookCreate` makes `url` optional for `telegram` (which takes
  `botToken` + `chatId`) and adds ntfy's `accessToken`; `issueIntegrationCreate` adds `email` (Jira) and
  `webhookSecret` (Linear), and `repo` is checked per provider by `trackerRepoError`. Endpoint responses add
  `chatId` (webhooks) and `email` (Jira integrations). Inbound: `POST /api/integrations/{linear,jira}/webhook`.
  Jira needs the Enterprise `jira` licence feature. See ADR 0015's wave-5 amendment.

### 3.7 Roles — enforcement matrix (BugPin) — owner: each route's area

`PERMISSIONS` in `packages/core/src/roles.ts` is the source of truth; viewers stay blocked globally by
`forbidViewerWrites`. Each owner adds `requirePermission(...)` (or keeps `requireOrgAdmin`, which equals Admin) on its
own routes:

| Permission                               | Roles         | Routes (owner)                                                                                                                            |
| ---------------------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `feedback.read`                          | all           | every `GET`                                                                                                                               |
| `feedback.create`, `.update`, `.comment` | Admin, Editor | `PATCH /api/feedback/:id`, bulk updates, comments, manual reports (triage)                                                                |
| `feedback.delete`, `.restore`            | Admin         | `DELETE /api/feedback/:id`, bulk delete, `POST /api/feedback/:id/restore`, `GET /api/feedback?trash=1`, `DELETE /api/rounds/:id` (triage) |
| `labels.manage`                          | Admin, Editor | labels CRUD (triage)                                                                                                                      |
| `projects.manage`                        | Admin         | `POST /api/projects` (open to members today: add the guard), project settings, review links (install-onboarding)                          |
| `users.manage`                           | Admin         | `/api/members*`, invitations (accounts)                                                                                                   |
| `integrations.manage`                    | Admin         | webhooks, issue integrations (integrations; already `requireOrgAdmin`)                                                                    |
| `settings.manage`                        | Admin         | branding, email templates, project notifications (email-notifications), workspace settings (accounts)                                     |

Instance settings (SMTP, security, licence) stay behind `requireInstanceAdmin`, which the first account holds. The
dashboard hides what a role can't do with `me.appRole` + `roleCan`, and never relies on hiding alone.

## 4. Safer defaults

New projects: `publicRead` off, `notifyReporter` on, `visitorsCanResolve` off. Existing projects keep what they had.
Tests and smoke checks that relied on the old defaults now opt in explicitly (`scripts/smoke.mjs` sets
`publicRead: true` on its main project). Playwright suites that read pins from a freshly created project must do the
same (`apps/web/e2e/seed.ts` creates projects through the API; `packages/widget/e2e/mock.ts` builds its own config
and is unaffected).

## 5. Idempotent fan-out

`emit()` gives every `DomainEvent` an `id` (uuid). The dispatch job inserts notifications with `event_id = id` and
`ON CONFLICT DO NOTHING`, emailing only recipients whose row was new; it queues webhooks with `queueDelivery(endpoint,
payload, e.id)`, which skips an endpoint that already has a first attempt for the event. Jobs queued before the
upgrade have no `id` and behave as before.
