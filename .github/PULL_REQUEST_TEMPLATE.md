## What and why

<!-- What does this PR change, and what problem does it solve? Link the issue: "Closes #123". -->

## How it was tested

<!-- Commands you ran, screens you checked (light and dark), browsers for widget changes. -->

## Checklist

- [ ] The PR title follows Conventional Commits (`feat(widget): …`, `fix(api): …`) — it becomes the squash commit and the changelog entry
- [ ] `pnpm verify` passes (format, lint, typecheck, unit tests, build)
- [ ] Playwright suites pass for the parts I touched (`pnpm test:e2e`)
- [ ] New behaviour has tests; every security mitigation has a test
- [ ] UI changes include empty, loading and error states, keyboard access and dark mode
- [ ] No secrets, customer data or screenshots of private sites in the diff
- [ ] For `packages/widget`: no new copyleft dependency (the widget is MIT) and the bundle size change is noted
- [ ] For `packages/db`: the migration is generated with `pnpm db:generate` and safe to run on a live instance
