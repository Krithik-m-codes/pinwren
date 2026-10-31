# ADR 0023 — Cloud billing with Dodo Payments (supersedes Stripe in blueprint 07 §5)

**Status:** accepted (test mode only until the owner goes live)

Blueprint 07 §5 and WP-22 name Stripe. Cloud is sold through Dodo Payments instead; everything else in §5
stands (plans in code, checkout, portal, 14-day dunning then Free, soft/hard report limits).

- **One entitlement model.** `@pinwren/core` holds the plan table (`BILLING_PLANS`: limits, features, public
  prices; no secrets, no provider ids) and the pure rules (`effectivePlan`, `reportQuota`). In Cloud with
  billing configured, `resolveEntitlements` adds the plan's features and seat limit to whatever a licence grants
  (`edition: "cloud"`, `plan`). Without `DODO_PAYMENTS_API_KEY` nothing changes, and self-host never reads any
  billing code path.
- **State.** `billing_subscription` (one row per workspace) and `billing_event` (processed `webhook-id`s), both
  tenant-protected. The plan in force is derived at read time: a failed renewal keeps Pro for 14 days from the
  first failure, then the workspace is Free (data kept, nothing deleted). No downgrade job exists to fail.
- **Webhook.** `POST /api/billing/webhook` is a capability route: the Standard Webhooks signature (constant-time,
  5-minute window) is the only authentication. The event is applied in one `withOrg` transaction together with
  its `webhook-id` record, so retries are idempotent and a failure rolls both back. The workspace comes from
  `metadata.pinwren_org_id`, set when the checkout is created. A paid plan is granted only for the configured
  product ids; events older than the stored one, or from a replaced subscription, are ignored.
- **Limits.** Projects and seats are refused with `402 PLAN_LIMIT_*` at creation/invitation; widget reports are
  refused with `429 FEEDBACK_UNAVAILABLE` at 120 % of the monthly allowance (a banner shows from 100 %). All are
  no-ops while billing is not configured.
- **Not built:** Business plan, extra-seat add-ons, tax/invoice currencies, making over-limit projects
  read-only after a downgrade (they keep working; only new ones are refused), the usage ping to the dashboard
  when seats are exceeded after downgrade.
