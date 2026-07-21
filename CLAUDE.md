# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SpecProof: a standalone Next.js app that renders an audit view of any repo's API test coverage: every OpenAPI operation and response status, cross-examined against the target repo's test assertions. Clicking a stamped verdict shows the actual test snippet that proves (or fails to prove) coverage.

This repo does not contain a real API or its tests — it audits a target repo from the outside, the way OpenAPI tooling works when installed into a repo. Nothing repo-specific is baked in. It does carry a hand-written demo target in `example/` (see "Example fixture" below), which is what gets audited when no `SPECPROOF_REPO` is set.

## Architecture: generate → checked-in artifact → contract-test

1. **Sources of truth**, read from the target repo (`SPECPROOF_REPO` env var; defaults to the current working directory):
   - The OpenAPI spec — auto-discovered as the shallowest `openapi*.json` / `swagger*.json` in the tree, or set explicitly with `SPECPROOF_SPEC` (relative to the repo root).
   - The repo's `*.test.ts` / `*.test.tsx` / `*.test.js` files — parsed via regex for `describe("METHOD /path")` blocks and `.status).toBe(NNN)` / `.status).toEqual(NNN)` assertions.
2. **Analyzer** (`lib/api-test-coverage.ts`): joins the two sources into a `CoverageReport` (tags → operations → statuses, each status with assertion counts and extracted `it()` snippets). Operations are joined on the describe title's method + path; `{param}`, `[param]`, and `:param` segments are treated as equivalent. When several test files describe the same operation, the one with the most `it()` blocks wins.
3. **Generator** (`scripts/generate-proof.ts`): calls the analyzer, writes the result to `app/proof.generated.json`. This is checked in, deterministic, and regenerated automatically before `dev`/`build`. When no target spec is found it leaves an existing artifact untouched (exit 0) — or, if the artifact is missing entirely (a fresh install; it isn't published), writes an empty proof so the app always builds and renders its empty state.
4. **Consumer** (`app/page.tsx` → `components/CoverageProof.tsx`): renders the checked-in artifact only. No target checkout is needed to build or deploy the app itself. An empty proof renders an empty-state hint.
5. **Drift guard** (`app/proof-contract.test.ts`): fails when the artifact is stale relative to the spec/tests, when the proof's audited operations don't exactly match the spec's operations, or when a quoted snippet no longer points at a real `it()`/`test()` line. This suite self-skips (via `describe.skipIf`) when no target spec is resolvable — in this repo one always is (the example fixture), so `bun run test:unit` always exercises the full analyzer here.

## Example fixture (`example/`)

`example/` is a hand-written demo target: `example/api/openapi.json` (the fictional "TaskFlow" API, 7 operations) plus `example/tests/*.test.ts` written in exactly the `describe("METHOD /path")` / `.status).toBe(NNN)` shape the parser expects. Because spec auto-discovery finds the shallowest `openapi*.json` under the target root (cwd by default), running `dev` / `generate:proof` / `test:unit` from this repo audits the example automatically — no `SPECPROOF_REPO` needed. Neither the example nor its generated proof is published to npm (both excluded from the `files` allowlist): TaskFlow exists purely for this repo's development, demos, and tests; installed consumers start from an empty proof.

- The example files are **fixture data parsed as text**, never executed or compiled: they are excluded from vitest (`vitest.config.ts`), tsc (`tsconfig.json`), and eslint (`eslint.config.mjs`). They only need to look like a prettier-formatted test suite.
- The spec and tests are **deliberately out of step** so the demo shows every verdict state: fully proven operations (`POST /auth/login`, `GET /tasks`, `GET /tasks/{taskId}`), partial coverage (`POST /tasks`, `PATCH /tasks/{taskId}`), untested operations (`DELETE /tasks/{taskId}`, `GET /projects`), and one status the tests assert but the spec omits (422 on `POST /tasks`). Preserve that mix when editing.
- Editing anything in `example/` makes the checked-in proof stale and fails the contract tests: run `bun run generate:proof` and commit the regenerated `app/proof.generated.json`.

Because of this split, most day-to-day work happens in exactly one of two places:
- Changing what's audited/how coverage is computed → `lib/api-test-coverage.ts` (+ regenerate the proof).
- Changing how the proof is displayed → `components/CoverageProof.tsx` / `app/proof.css`, reading the existing `app/proof.generated.json` as fixture data — no target checkout needed.

## Commands

Developing this repo itself requires [Bun](https://bun.sh) (`packageManager` is pinned to it, and `generate:proof` runs the TypeScript generator directly via Bun's native TS execution). This is purely a dev-tooling choice for this repo's own scripts — it has no bearing on consumers, who install the published `specproof` bin with npm, pnpm, yarn, or bun; see "CLI / npm packaging" below.

```bash
bun install
bun run dev              # generate:proof + next dev (port 3001)
bun run build            # generate:proof + next build
bun run start            # serve the production build (port 3001)
bun run generate:proof   # regenerate app/proof.generated.json only
bun run test:unit        # contract tests (vitest run; audits example/ unless SPECPROOF_REPO is set)
bun run test:unit:watch  # vitest watch mode
bun run lint             # eslint + tsc --noEmit
bun run lint:es          # eslint only
bun run lint:ts          # tsc --noEmit only
```

To run a single test file: `bunx vitest run app/proof-contract.test.ts` (contract tests) or `bunx vitest run lib/api-test-coverage.test.ts` (analyzer unit tests). The unit tests' inline fixtures deliberately use operations that don't exist in the example spec (`/widgets`, `/gadgets`) — the analyzer parses this repo's own `*.test.ts` files as raw text when auditing `example/`, and colliding paths would pollute the generated proof.

To audit a real repo instead of the bundled example:

```bash
SPECPROOF_REPO=/path/to/target-repo bun run generate:proof
# optionally, if the spec has a nonstandard name/location:
SPECPROOF_REPO=/path/to/target-repo SPECPROOF_SPEC=docs/api-spec.json bun run generate:proof
```

## CLI / npm packaging

The package ships a `specproof` bin (`dist/scripts/cli.js`, `#!/usr/bin/env node` shebang) for use when installed into a target repo — with any package manager: `npm install -D specproof` + `npx specproof dev`, or the `bun add -d` / `pnpm add -D` / `yarn add -D` equivalents. Commands: `generate` / `dev` / `build` / `start`, with `--repo` / `--spec` mapping to the env vars, `--port` for dev/start, and (generate only) `--out <path>` (env `SPECPROOF_OUT`) to write the proof somewhere other than the bundled `app/proof.generated.json` — e.g. committed into the consumer's repo — plus `--check`, which verifies the file at `--out` is current instead of writing and exits 1 on drift (the consumer-side CI guard; unlike plain generate, a missing spec is a hard failure under `--check`). Next.js commands run against the package directory (`next dev <pkgDir>`), while the analyzer audits the consumer's cwd. The CLI sets `SPECPROOF_REPO`/`SPECPROOF_SPEC` env vars *before* dynamically importing the generator, because the analyzer reads them at module load.

**Why `dist/` and not raw TypeScript sources:** the bin used to point straight at `scripts/cli.ts` with a `#!/usr/bin/env bun` shebang, relying on Bun's ability to execute TypeScript with no build step — which made Bun a hard runtime requirement for every consumer, not just this repo's own dev tooling. `tsconfig.cli.json` compiles `scripts/cli.ts` + `scripts/generate-proof.ts` + `lib/api-test-coverage.ts` to plain Node-ESM JS under `dist/` (mirroring the source tree, so relative imports resolve unchanged); `npm run build:cli` runs it, and `prepublishOnly` wires it into `npm publish` automatically. `dist/` is gitignored — it's a build artifact, regenerated at publish time, never checked in. `cli.ts`'s dynamic-`import()` of the generator (rather than the old synchronous `require()`) exists because plain Node — unlike Bun — cannot `require()` an ESM module synchronously.

`package.json`'s `files` allowlist keeps the tarball to the runnable app (`app`, `components`, `dist`, and the Next/Tailwind/TS configs) — `example/`, `app/proof.generated.json` (the TaskFlow demo data must not ship; a fresh install gets an empty proof written by the generator's no-spec fallback instead), `public/` (branding PNGs only, referenced by the README via a raw.githubusercontent URL), `marketing/`, CI workflows, `CHANGELOG.md`, this repo's own test suites (`app/proof-contract.test.ts`, `lib/api-test-coverage.test.ts`), raw `lib/`/`scripts/` TypeScript sources (superseded by `dist/`), and this file are deliberately not published. When adding a file the published app needs at runtime, add it to `files`.

## Updating the proof

When a target repo's test or OpenAPI spec changes, the checked-in `app/proof.generated.json` goes stale and the contract tests fail. Fix:

```bash
SPECPROOF_REPO=/path/to/target-repo bun run generate:proof
git add app/proof.generated.json && git commit
```

## CI & Releasing

`main` is protected by a repo ruleset (PR required, merge queue, no direct pushes). The flow: open a PR → the CI workflow (`.github/workflows/ci.yml`, jobs `Build` / `Lint` / `Test` / `Verify install`) runs on the PR and again in the merge queue → all checks must pass → clicking merge queues the PR and GitHub merges it (squash). The `Build` job runs `bun run build:cli` and smoke-tests `dist/scripts/cli.js` under a plain Node install with no Bun in the execution path. The `Verify install` job goes further and is the real regression guard for "the published CLI works with any package manager": a 4-way matrix (`npm` / `pnpm` / `yarn` / `bun`) that packs the tarball, does a real install of it into a scratch consumer repo (copied from `example/`) via that package manager, then runs `specproof generate` through that manager's actual invocation path (`npx`, `pnpm exec`, `yarn <bin>`, `bunx`) and checks the resulting proof has operations. The `yarn` leg activates Yarn Classic via Corepack (`corepack enable && corepack prepare yarn@1.22.22 --activate`); that step itself is cwd-independent, but note that invoking the resulting `yarn` shim from *this repo's own* directory would fail (`Unsupported package manager specification (bun@1.1.38)`) because Corepack reads the nearest `package.json`'s `packageManager` field and doesn't recognize Bun — which is why the install/run steps operate in the scratch consumer fixture (`/tmp/consumer`, its own unrelated `package.json`), not the checkout.

Every merge to `main` then triggers `.github/workflows/release.yml`, which publishes to npm when `package.json`'s version isn't already on the registry (needs the `NPM_TOKEN` repo secret). It installs deps with Bun, then runs `npm publish`, whose `prepublishOnly` lifecycle script rebuilds `dist/` before packing. To release: bump `version` in `package.json`, open a PR, and merge. There is no manual release trigger.

## Notes on the parsing approach

`lib/api-test-coverage.ts` parses test files with regexes rather than a real TS/AST parser, relying on prettier-consistent formatting conventions in the audited repo:
- `describe("METHOD /path")` titles are matched for the HTTP method prefix (`GET|POST|PUT|DELETE|PATCH`) followed by the operation path.
- `it()`/`test()` blocks are extracted by matching the opening call, then scanning for the next `});` at the same indentation level — not a brace-matching parser, so it depends on consistent formatting in the audited repo.
- Snippet source is dedented before being stored/rendered.

If this parsing logic needs updating, check it against real test files in a target repo — the contract test's "every quoted snippet points at a real it()/test() block" check is what catches regressions here.
