# ADR 0045: Custom roles and granular permissions

Date: 2026-11-28. Status: accepted. Extends [ADR 0019](0019-enterprise-licence-files-and-white-label.md) and
[ADR 0044](0044-audit-log.md). Feature F-093, second slice of WP-24 (SSO and SCIM stay open).

## Context

Admin, Editor and Viewer (`packages/core/src/roles.ts`, stored in Better Auth's `member.role`) are enforced by
`requirePermission`, `isReadOnlyRole`, `audienceOf` and a handful of `requireOrgAdmin` checks. Enterprise
customers need roles in between ("triage but never delete", "read the audit log", "add Viewers only"). The
blueprint makes this the `custom_roles` licence feature: Enterprise only, in no Cloud plan.

## Decision

- **Built-in roles do not change.** `member.role` keeps holding only Better Auth role names. A custom role is an
  extra, nullable association: `member.custom_role_id` (migration 0020) with a composite foreign key
  `(custom_role_id, organization_id) -> custom_role (id, org_id)` (same organisation only; NO ACTION so a role in
  use cannot be deleted from under its members, yet deleting a whole organisation still cascades).
- **Table.** `custom_role`: `org_id`, `name` (unique per organisation, case-insensitively, via a unique index on
  `lower(name)`), `description`, `permissions text[]`, `created_by`, timestamps. Tenant policy and inventory like
  every direct-owned table; `member` lists it as a parent.
- **Catalogue.** `PERMISSIONS` gains `audit.read`, `branding.manage`, `billing.manage` and `roles.manage` next to
  the existing keys. Built-in roles hold the new keys exactly where Admin-only checks stood, so nothing changes
  for them. Only keys that are enforced are listed: `audit.read` (audit routes), `branding.manage` (branding and
  email templates), `billing.manage` (billing), `integrations.manage` (integrations, webhooks, Slack settings),
  `projects.manage` now also guards project update, key rotation and install check. Secrets
  (action and identity secrets) stay Admin-only through `requireOrgAdmin`. `roles.manage` exists so role routes
  use the same mechanism, but is excluded from `CUSTOM_ROLE_PERMISSIONS`: nobody but an Admin manages roles.
  Instance administration is not a permission key at all, so no role can grant it (`/api/admin/*` is untouched).
  Every custom role includes `feedback.read`.
- **One resolver.** `can(access, permission)` in `@pinwren/core`, where `access = { role, customPermissions? }`.
  Unknown permission: denied. No custom permissions, or an owner/admin base: the built-in matrix, so Admins
  can never be reduced. Otherwise exactly the role's list (never `roles.manage`). The API resolves the caller
  once per request (`resolveAccess` in `services/custom-roles.ts`: session, API tokens, Slack actors) into
  `c.var.customPermissions`, and `requirePermission`, `/api/me`, `can(accessOf(c), …)` and the Slack and v1
  checks all go through `can`. `GET /api/me` returns `permissions` and `customRole`; the dashboard hides
  what is missing from that list.
- **Base role stays consistent.** A custom-role member's stored base role is the least privileged one that works:
  `viewer` when the role only holds read permissions (`feedback.read`, `audit.read`), `member` (Editor) otherwise
  (`baseRoleForPermissions`). Editing a role rewrites its members' base roles in the same request, and the resolver
  derives the effective base from the list at request time, so `isReadOnlyRole`, `forbidViewerWrites`
  and the token checks stay right for requests even if the stored value is stale.
- **Fail closed beyond named permissions.** An Editor base would otherwise open every mutating route that is
  merely "not for Viewers" (review rounds, for instance). `forbidViewerWrites` therefore refuses a custom-role
  member any mutating route that does not carry a permission guard (tagged `requirePermission`) or is not on the
  personal-state exemption list; review round create/update now name `feedback.update`. API tokens of a custom-role
  member additionally need the named permission on the `/api/v1` write routes (and so on `/mcp`), where
  built-in roles keep their scope-only rules.
- **No escalation.** Creating or editing a role requires holding every permission it lists. Assigning a role
  (Users, Add user) requires holding every permission of the role (or of the built-in role, `permissionsOfAppRole`)
  and everything the target can do today. Changing or removing a member requires holding everything they hold. The
  owner can never be demoted or removed, you cannot change your own role, and the last-Admin guard is unchanged
  (`memberChangeVerdict`). Members who are Admins can be given a custom role only through that same verdict (a
  demotion); the custom role never applies to someone whose base is owner/admin.
- **API.** `GET /api/roles` (`roles.manage` or `users.manage`, the Users picker needs it), `POST`, `PATCH /:id` and
  `DELETE /:id` (`roles.manage`). Deleting a role in use is refused (`409 ROLE_IN_USE`); it is not reassigned
  silently. Assignment extends the member update schema (`{ role }` or `{ customRoleId }`, exactly one) and
  `POST /api/members` takes an optional `customRoleId`. Email invitations stay built-in roles (Better Auth stores
  the invitation role; carrying a custom role through acceptance is future work), so a custom role is assigned
  after the person joins.
- **Licence and downgrade.** `custom_roles` moves to `IMPLEMENTED_LICENSE_FEATURES`; no Cloud plan lists it.
  Creating, editing and assigning need `hasFeature("custom_roles")` and `assertFeatureWritable` (read-only after
  the grace period); listing and deleting do not. Without the feature the resolver ignores custom roles: members
  fall back to the permissions of their stored base role (Editor or Viewer), built-in roles are unaffected, Admins
  are never touched, and nobody is locked out. The members list stops showing the custom role while the feature
  is off. Re-installing a licence brings the roles back, because nothing was deleted.
- **Audit.** `role.created`, `role.updated` (added and removed permissions, rename), `role.deleted`,
  `member.custom_role_assigned`; `member.role_changed` and `member.created` record the custom role name where
  relevant.

## Consequences

- A new enforced permission needs a `PERMISSIONS` entry (built-in holders), a catalogue group and label in the
  dashboard (ten catalogues), and a `requirePermission` on its routes plus a test.
- A mutating route with no permission guard is closed to custom roles by design; new editor-level routes should
  name the permission they need.
- Custom roles are evaluated only for sessions, tokens and Slack actors; widget traffic and guest links are not
  members and are unaffected.
- Not done here: SSO/SCIM group mapping to roles, per-project role scoping, carrying a custom role on an
  email invitation.
