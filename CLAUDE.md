# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SpecProof: a standalone Next.js app that renders an audit view of any repo's API test coverage: every OpenAPI operation and response status, cross-examined against the target repo's test assertions. Clicking a stamped verdict shows the actual test snippet that proves (or fails to prove) coverage.

This repo does not contain an API or its tests — it audits a target repo from the outside, the way OpenAPI tooling works when installed into a repo. Nothing repo-specific is baked in.

## Architecture: generate → checked-in artifact → contract-test

1. **Sources of truth**, read from the target repo (`SPECPROOF_REPO` env var; defaults to the current working directory):
   - The OpenAPI spec — auto-discovered as the shallowest `openapi*.json` / `swagger*.json` in the tree, or set explicitly with `SPECPROOF_SPEC` (relative to the repo root).
   - The repo's `*.test.ts` / `*.test.tsx` / `*.test.js` files — parsed via regex for `describe("METHOD /path")` blocks and `.status).toBe(NNN)` / `.status).toEqual(NNN)` assertions.
2. **Analyzer** (`lib/api-test-coverage.ts`): joins the two sources into a `CoverageReport` (tags → operations → statuses, each status with assertion counts and extracted `it()` snippets). Operations are joined on the describe title's method + path; `{param}`, `[param]`, and `:param` segments are treated as equivalent. When several test files describe the same operation, the one with the most `it()` blocks wins.
3. **Generator** (`scripts/generate-proof.ts`): calls the analyzer, writes the result to `app/proof.generated.json`. This is checked in, deterministic, and regenerated automatically before `dev`/`build`. When no target spec is found it leaves the existing artifact untouched (exit 0), so the app always builds.
4. **Consumer** (`app/page.tsx` → `components/CoverageProof.tsx`): renders the checked-in artifact only. No target checkout is needed to build or deploy the app itself. An empty proof renders an empty-state hint.
5. **Drift guard** (`app/proof-contract.test.ts`): fails when the artifact is stale relative to the spec/tests, when the proof's audited operations don't exactly match the spec's operations, or when a quoted snippet no longer points at a real `it()`/`test()` line. This suite self-skips (via `describe.skipIf`) when no target spec is resolvable.

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
bun run test:unit        # contract tests (vitest run; self-skips without a configured target)
bun run test:unit:watch  # vitest watch mode
bun run lint             # eslint + tsc --noEmit
bun run lint:es          # eslint only
bun run lint:ts          # tsc --noEmit only
```

To run a single test file: `bunx vitest run app/proof-contract.test.ts` (there is currently only the one test file).

The generator/contract tests need a target repo:

```bash
SPECPROOF_REPO=/path/to/target-repo bun run generate:proof
# optionally, if the spec has a nonstandard name/location:
SPECPROOF_REPO=/path/to/target-repo SPECPROOF_SPEC=docs/api-spec.json bun run generate:proof
```

## Updating the proof

When a target repo's test or OpenAPI spec changes, the checked-in `app/proof.generated.json` goes stale and the contract tests fail. Fix:

```bash
SPECPROOF_REPO=/path/to/target-repo bun run generate:proof
git add app/proof.generated.json && git commit
```

## Releasing

Merges to `main` trigger `.github/workflows/release.yml`, which publishes to npm when `package.json`'s version isn't already on the registry (needs the `NPM_TOKEN` repo secret). To release: bump `version` in `package.json` and merge.

## Notes on the parsing approach

`lib/api-test-coverage.ts` parses test files with regexes rather than a real TS/AST parser, relying on prettier-consistent formatting conventions in the audited repo:
- `describe("METHOD /path")` titles are matched for the HTTP method prefix (`GET|POST|PUT|DELETE|PATCH`) followed by the operation path.
- `it()`/`test()` blocks are extracted by matching the opening call, then scanning for the next `});` at the same indentation level — not a brace-matching parser, so it depends on consistent formatting in the audited repo.
- Snippet source is dedented before being stored/rendered.

If this parsing logic needs updating, check it against real test files in a target repo — the contract test's "every quoted snippet points at a real it()/test() block" check is what catches regressions here.
