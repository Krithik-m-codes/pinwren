# Engineering Resume Audit and Dual Resume Design

## Goal

Produce two evidence-based, one-page A4 LaTeX resumes for Krithik M: a
frontend-focused version and a full-stack version. The resumes must reflect
verified engineering work without presenting collaborative employer backend
systems as sole-authored work.

## Evidence boundary

- Audit all locally accessible Git repositories and public GitHub repositories
  that can be inspected without exposing credentials or private customer data.
- Treat direct commit/code evidence as the strongest evidence.
- Treat the existing `C:\Users\krith\Downloads\resume-metrics-audit.md` as a
  prior audit artifact, not as a substitute for inaccessible source
  repositories.
- Do not invent usage, performance, customer, revenue, team-size, adoption, or
  deployment metrics.
- Mark the 20% Time-to-Interactive claim and the six-week Schedulo recovery as
  unverified unless independently available records are found.
- Remove Loom from the final resumes. Projects contain only Revvie and Pinwren.

## Verified and limited work inventory

### Pinwren

Pinwren is directly accessible and authored under two verified Krithik
identities: `krithikm923@gmail.com` and
`112496915+Krithik-m-codes@users.noreply.github.com`.

The audit may use the following evidence:

- Next.js App Router server/client split, Cache Components, request-private
  session caching, in-process Hono API reads, RTK Query hydration and URL
  state, documented in `docs/adr/0020-dashboard-state-and-rendering.md`.
- SSE realtime synchronization, reconnect/backoff, cache invalidation,
  presence and optimistic state updates in the dashboard listener and realtime
  route.
- Tenant-scoped Drizzle/Postgres transactions with commit effects and
  composite tenant references in `packages/db`.
- Widget API safety, Shadow DOM-oriented implementation, lazy chunks, privacy
  controls, and full teardown behavior.
- Cloud signup/onboarding, consent, email verification, abuse limits and
  tests in commits `e5cf60e` and `5361116`.
- Cross-worker realtime/session/rate-limit fixes in `a6af078`.
- Marketing site, documentation, demos and deployment-facing surfaces in
  `f1f93ed`.

Pinwren can support both resumes and is the primary independently verifiable
full-stack evidence.

### Revvie

Revvie is a personal project at `https://revvie.xride-labs.in`. The existing
local audit artifact describes solo web, mobile and backend work, including
Next.js, Expo/React Native, Node/Express, Prisma/PostgreSQL, realtime
messaging, authentication and third-party integrations. These claims may be
used conservatively as personal-project evidence, without claims of adoption
or production scale. The resume must not imply a completeness level beyond
the inspected project evidence.

### Shubpy Solutions products

The accessible workspace does not contain the RoboKidz 360, Vryno Schedulo,
Vryno Projekto, Sales IQ or DocuSigner source repositories. They remain one
Shubpy Solutions employer entry. Product contributions may be included only
with cautious ownership wording:

- RoboKidz 360: frontend ownership claims are supported by the prior audit
  artifact but require repository access for independent re-verification.
- Schedulo: frontend recovery, Next.js App Router/Redux and calendar
  integration claims require confirmation; the six-week recovery claim is not
  independently verified.
- Sales IQ: use “contributed to” or “primary frontend contributor,” not sole
  author, unless source history is supplied.
- DocuSigner: describe frontend signing workflow work only if retained, and
  do not imply sole backend ownership.
- The 20% TTI improvement across three products is unverified and must not
  appear as fact in the resumes.

### Other repositories

Loom is explicitly omitted. Tripmate, portfolio, and other small or learning
repositories are not strong enough for the requested Projects section and are
omitted.

## Resume structure

Both files use the exact section order:

1. Summary
2. Experience
3. Projects
4. Technical Skills
5. Education

The layout is compact, ATS-readable, Jake's Resume-inspired, and uses A4
paper. Contact details and education come from the supplied resume PDF. The
current supplied materials conflict on title/date: the PDF says
`Frontend Developer` from May 2024, while portfolio data says `AI-Native Full
Stack Developer` from May 2025. This remains a confirmation item and must not
be silently resolved.

## Resume-specific emphasis

### Frontend resume

- Lead with React/Next.js architecture, server rendering, caching, reusable
  component systems, complex dashboard workflows, realtime UI and widget
  engineering.
- Present employer work as frontend ownership/contribution under one
  Shubpy Solutions entry.
- Use Pinwren and Revvie as concise personal projects.

### Full-stack resume

- Retain the strongest frontend evidence.
- Add Pinwren API, auth/onboarding, tenant isolation, PostgreSQL/Drizzle,
  realtime, jobs/integrations and deployment configuration.
- Describe employer backend work as collaboration or feature contribution,
  never as sole authorship.
- Keep Revvie’s backend breadth bounded by available evidence.

## Validation

For each resume:

- Compile LaTeX to PDF with an available non-interactive LaTeX engine.
- Confirm the PDF has exactly one page.
- Extract text to confirm searchable/selectable content and required section
  order.
- Inspect the rendered page for clipping, overflow and unreadable density.
- Verify contact and project links.
- Report every unverified claim or unresolved title/date mismatch.
