# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users and purpose

Pinwren helps website owners and their teams collect pinned feedback and annotated bug reports and
triage them in a self-hosted dashboard. Client reviewers and reporters need a small, private place to
follow their own reports and public conversations without access to team tools or internal notes.

## Operating context

An embeddable widget runs on customer websites. One Next.js application hosts the dashboard and Hono
API; Postgres is the only required service. The existing product specification is in `blueprint/`.
The user has delegated selection and implementation of the remaining roadmap phases.

## Constraints

Preserve the existing product, branding, accounts, accessibility requirements and licensed-feature
boundaries. Never expose internal comments, diagnostics, workspace settings or other reporters' private
items to guests. Guest access must be proved with an existing reporter capability or signed email link.
Do not invent customers, usage numbers, testimonials or supported integrations.

## Brand commitments

Use the existing Pinwren name, brand assets, dashboard components and tokens. This is an extension of
the existing interface. The blueprint describes it as calm, dense and fast.

## Accessibility

Keyboard operation, visible focus, readable contrast, light/dark themes, reduced motion and usable
layouts at 375 px are release requirements.
