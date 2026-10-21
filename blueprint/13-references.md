# 13 — References

## Upstream projects to study

| Project | Licence | What to learn | Rule |
|---|---|---|---|
| **SitePing** — [github.com/NeosiaNexus/SitePing](https://github.com/NeosiaNexus/SitePing); local fork with a self-host server at `E:\Shubpy\SitePing` (personal fork [Krithik-m-codes/SitePing](https://github.com/Krithik-m-codes/SitePing), `apps/selfhost`) | MIT | DOM anchoring (`packages/widget/src/dom`, `annotator.ts`, `markers.ts`), closed Shadow DOM widget, store-agnostic server handler, screenshot storage abstraction, webhook escaping, comment threads, access-control model (`packages/server/src/options.ts`) | May adapt code **with attribution** in `THIRD_PARTY_NOTICES.md` |
| **BugPin** — [github.com/aranticlabs/bugpin](https://github.com/aranticlabs/bugpin), [docs.bugpin.io](https://docs.bugpin.io/), running instance at `https://bugs.shubpy.com` | AGPL-3.0 (server/admin), MIT (widget), commercial (ee) | Product behaviour only: annotation tools, reporter/team notification model, per-project keys + domain whitelist (hostname match), settings-in-DB approach, EE gating pattern (S3 storage is EE — we deliberately make it free) | **Do not copy code.** Behaviour study only |
| **FasterFixes** — [faster-fixes.com/open-source](https://www.faster-fixes.com/open-source) | AGPL-3.0 + MIT widgets | MCP server for feedback, React-tree capture idea | Behaviour study only |
| **BugDrop** — [launch post](https://neonwatty.com/project-updates/bugdrop-2026-01-launch/) | MIT | GitHub-issue flow, untrusted-content cautions | Ideas only |
| **SnapDOM** — [github.com/zumerlab/snapdom](https://github.com/zumerlab/snapdom) | MIT | DOM capture via SVG foreignObject; limits: cross-origin iframes → placeholders, CORS-readable assets required | Dependency |
| **rrweb** | MIT | Replay record/player, masking options | Dependency |
| **@medv/finder** | MIT | Unique selector generation | Dependency |
| **perfect-freehand** | MIT | Pen strokes | Dependency |
| **Better Auth** | MIT | Orgs, passkeys, SSO/SCIM plugins | Dependency |
| **pg-boss** | MIT | Postgres job queue | Dependency |

## Market sources (pricing/features — re-verify before marketing use)

- Feedbucket comparisons (competitor-authored): [Marker.io alternatives](https://feedbucket.app/alternatives/marker-io-alternatives), [BugHerd alternatives](https://feedbucket.app/alternatives/bugherd-alternatives), [Userback alternatives](https://feedbucket.app/alternatives/userback-alternatives), [Usersnap vs BugHerd vs Marker.io](https://feedbucket.app/blog/usersnap-vs-bugherd-vs-marker-io)
- [ReviseFlow — Marker.io alternatives](https://reviseflow.io/blog/marker-io-alternatives), [FasterFixes — Marker.io alternatives](https://www.faster-fixes.com/blog/marker-io-alternatives), [FasterFixes — BugHerd alternatives](https://www.faster-fixes.com/blog/bugherd-alternatives), [Snapfeed — Marker.io alternatives](https://snapfeed.app/marker-io-alternatives), [Webvizio — Markup.io alternatives](https://webvizio.com/blog/8-best-markup-io-alternatives-with-pricing-comparison/)
- [OpenAlternative — self-hosted feedback tools](https://openalternative.co/collections/self-hosted/categories/feedback-feature-request-management), [Quackback — feedback widget tools](https://quackback.io/blog/feedback-widget-tools)
- Gleap (vendor-authored): [best in-app bug reporting tools 2026](https://www.gleap.io/blog/best-in-app-bug-reporting-tools-2026), [Jam alternative](https://www.gleap.io/alternatives/alternative-to-jam); [G2 Jam review](https://www.g2.com/products/jam-dev/reviews/jam-dev-review-9856499)

## Technical sources

- [monday.com engineering — Capturing DOM as image is harder than you think](https://engineering.monday.com/?p=11028)
- [SnapDOM vs html2canvas (author post)](https://dev.to/tinchox5/why-snapdom-beats-html2canvas-for-dom-to-image-capture-14ch)

## Licensing sources

- [Armin Ronacher — licensing / FSL](https://lucumr.pocoo.org/2023/11/19/cathedral-and-bazaaar-licensing/)
- [OSI license-discuss — AGPL for SaaS protection](https://lists.opensource.org/pipermail/license-discuss_lists.opensource.org/2024-June/022293.html)
- [OneUptime — open source vs open core](https://oneuptime.com/blog/post/2026-03-03-open-source-vs-open-core-whats-the-difference/markdown)
- [Directus licence revision discussion](https://community.directus.io/t/directus-license-revision-community-feedback-requested/2125/17)
- [Monetizely — enforcing limits on self-hosted OSS](https://www.getmonetizely.com/articles/can-you-enforce-usage-limits-on-self-hosted-open-source-software)

## Open questions for the owner (answer before Phase 3)

1. Final product name, domain and trademark check.
2. Legal entity and jurisdiction for the commercial licence and Stripe account (affects tax, invoicing currency).
3. Final prices after customer interviews (07 §3 are proposals).
4. Cloud hosting provider and regions (EU + US at launch, or one region first).
5. Whether to offer an INR price list for India-based customers.
