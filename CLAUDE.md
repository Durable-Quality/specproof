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
3. **Generator** (`scripts/generate-proof.ts`): calls the analyzer, writes the result to `app/proof.generated.json`. This is checked in, deterministic, and regenerated automatically before `dev`/`build`. When no target spec is found it leaves an existing artifact untouched (exit 0) — or, if the artifact is missing entirely (a fresh npm install; it isn't published), writes an empty proof so the app always builds and renders its empty state.
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

Requires [Bun](https://bun.sh).

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

The package ships a `specproof` bin (`scripts/cli.ts`, Bun shebang) for use when installed into a target repo: `generate` / `dev` / `build` / `start`, with `--repo` / `--spec` mapping to the env vars, `--port` for dev/start, and (generate only) `--out <path>` (env `SPECPROOF_OUT`) to write the proof somewhere other than the bundled `app/proof.generated.json` — e.g. committed into the consumer's repo — plus `--check`, which verifies the file at `--out` is current instead of writing and exits 1 on drift (the consumer-side CI guard; unlike plain generate, a missing spec is a hard failure under `--check`). Next.js commands run against the package directory (`next dev <pkgDir>`), while the analyzer audits the consumer's cwd. The CLI sets `SPECPROOF_REPO`/`SPECPROOF_SPEC` env vars *before* dynamically importing the generator, because the analyzer reads them at module load.

`package.json`'s `files` allowlist keeps the tarball to the runnable app (`app`, `components`, `lib`, `scripts`, and the Next/Tailwind/TS configs) — `example/`, `app/proof.generated.json` (the TaskFlow demo data must not ship; a fresh install gets an empty proof written by the generator's no-spec fallback instead), `public/` (branding PNGs only, referenced by the README via a raw.githubusercontent URL), `marketing/`, CI workflows, `CHANGELOG.md`, this repo's own test suites (`app/proof-contract.test.ts`, `lib/api-test-coverage.test.ts` — negated in `files`; consumers can't run them since vitest is a devDependency), and this file are deliberately not published. When adding a file the published app needs at runtime, add it to `files`.

## Updating the proof

When a target repo's test or OpenAPI spec changes, the checked-in `app/proof.generated.json` goes stale and the contract tests fail. Fix:

```bash
SPECPROOF_REPO=/path/to/target-repo bun run generate:proof
git add app/proof.generated.json && git commit
```

## CI & Releasing

`main` is protected by a repo ruleset (PR required, merge queue, no direct pushes). The flow: open a PR → the CI workflow (`.github/workflows/ci.yml`, jobs `Build` / `Lint` / `Test`) runs on the PR and again in the merge queue → all three checks must pass → clicking merge queues the PR and GitHub merges it (squash).

Every merge to `main` then triggers `.github/workflows/release.yml`, which publishes to npm when `package.json`'s version isn't already on the registry (needs the `NPM_TOKEN` repo secret). To release: bump `version` in `package.json`, open a PR, and merge. There is no manual release trigger.

## Notes on the parsing approach

`lib/api-test-coverage.ts` parses test files with regexes rather than a real TS/AST parser, relying on prettier-consistent formatting conventions in the audited repo:
- `describe("METHOD /path")` titles are matched for the HTTP method prefix (`GET|POST|PUT|DELETE|PATCH`) followed by the operation path.
- `it()`/`test()` blocks are extracted by matching the opening call, then scanning for the next `});` at the same indentation level — not a brace-matching parser, so it depends on consistent formatting in the audited repo.
- Snippet source is dedented before being stored/rendered.

If this parsing logic needs updating, check it against real test files in a target repo — the contract test's "every quoted snippet points at a real it()/test() block" check is what catches regressions here.
