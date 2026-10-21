# ADR 0017 — Prettier + ESLint instead of Biome; React Compiler; release-please

**Status:** accepted (supersedes the "Lint / format: Biome" and "Changesets" choices in blueprint 02 §2 and 11)

## Context

Before the public v1 the owner asked for the most widely used toolchain, so outside contributors meet tools
they already know. Biome covered formatting and a recommended rule set, but had no type-aware rules, no
React Compiler rules and no Next.js rules. The blueprint also named Changesets for releases while the repo
had none set up.

## Decision

1. **Prettier 3** formats everything (`printWidth` 110, double quotes, trailing commas), with
   `prettier-plugin-tailwindcss` sorting classes in the dashboard.
2. **ESLint 9 flat config** at the root (`eslint.config.mjs`): `typescript-eslint` strict + stylistic
   type-checked for every package, `eslint-config-next` (React, hooks, `@next/next`, Core Web Vitals) and the
   full `eslint-plugin-react-hooks` React Compiler set plus `jsx-a11y` recommended for `apps/web`, and
   `eslint-config-prettier` last. `pnpm lint` fails on warnings and on unused disable comments.
   Deliberate option choices are commented in the config: `prefer-nullish-coalescing` ignores strings (an
   empty string means "not set" throughout), `no-confusing-void-expression` allows arrow shorthand,
   `consistent-type-definitions` prefers `type`, and CommonJS files may `require()`. Any other exception is a
   per-line `eslint-disable-next-line rule -- reason`.
3. **TypeScript** in every package: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
   `noImplicitOverride`, `noFallthroughCasesInSwitch`.
4. **The dashboard is built with the React Compiler**, using Turbopack's native Rust port
   (`reactCompiler: true`, `experimental.turbopackRustReactCompiler: true`) and with **typed routes**.
   Form drafts that follow a server value use `useSyncedState` (React's "adjust state while rendering"
   pattern) instead of effects, as the compiler's lint rules require.
5. **Hooks:** `simple-git-hooks` runs `lint-staged` on pre-commit and `commitlint` (Conventional Commits) on
   commit-msg.
6. **Releases:** release-please (manifest mode) versions the app (tags `vX.Y.Z`, Docker image on GHCR with
   SBOM and provenance) and `@pinwren/widget` (tags `widget-vX.Y.Z`, npm with provenance) from Conventional
   Commits, replacing Changesets.

## Consequences

- Lint is slower than Biome (type-aware rules, about a minute for the whole repo) but catches unhandled
  promises, unsafe `any` flows and React Compiler bail-outs that Biome could not.
- `turbopackRustReactCompiler` is experimental; if it misbehaves, drop that flag and add
  `babel-plugin-react-compiler` — the lint rules stay the same.
- Contributors must write Conventional Commit messages; the PR-title workflow enforces the squash commit.
