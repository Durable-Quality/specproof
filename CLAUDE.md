# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

SpecProof: a standalone Next.js app that renders an audit view of any repo's API test coverage: every OpenAPI operation and response status, cross-examined against the target repo's test assertions. Clicking a stamped verdict shows the actual test snippet that proves (or fails to prove) coverage.

This repo does not contain a real API or its tests — it audits a target repo from the outside, the way OpenAPI tooling works when installed into a repo. Nothing repo-specific is baked in. It does carry a hand-written demo target in `example/` (see "Example fixture" below), which is what gets audited when no `SPECPROOF_REPO` is set.

## Architecture: generate → checked-in artifact → contract-test

1. **Sources of truth**, read from the target repo (`SPECPROOF_REPO` env var; defaults to the current working directory):
   - The OpenAPI spec — auto-discovered as the shallowest `openapi*` / `swagger*` file in the tree (`.json`, `.yaml`, or `.yml`), or set explicitly with `SPECPROOF_SPEC` (relative to the repo root). JSON and YAML are parsed into the same document by `loadSpec`, so a spec converted between the two formats yields a byte-identical proof and never trips the drift guard; `--spec` accepts any extension and sniffs the format when it isn't one of those three. Equal-depth candidates are broken alphabetically, which means an `openapi.json` beside an `openapi.yaml` keeps winning; the generator warns whenever a tie had to be broken, since one of the two files is usually a stale conversion of the other.
   - The repo's `*.test.ts` / `*.test.tsx` / `*.test.js` files — parsed via regex for `describe("METHOD /path")` blocks and `.status).toBe(NNN)` / `.status).toEqual(NNN)` assertions.
2. **Analyzer** (`lib/api-test-coverage.ts`): joins the two sources into a `CoverageReport` (tags → operations → statuses, each status with assertion counts and extracted `it()` snippets). Operations are joined on the describe title's method + path; `{param}`, `[param]`, and `:param` segments are treated as equivalent. When several test files describe the same operation, the one with the most `it()` blocks wins. A status row can come from three places: the spec's `responses`, a test assertion the spec never documents (`documented: false`), or `expectedStatuses` (`expected: true`), which synthesizes the standard responses an operation's shape implies and the spec omits: `500` always, `404` when the path has a parameter, `400` when the operation declares a `requestBody`. Every status row counts exactly once, whichever of the three produced it: `coveredCount` is the rows with assertions, `gapCount` the rows without, so `coveredCount + gapCount === statuses.length` for every operation and the tally an operation shows (`2/3`) always matches the marks beside it and the rows inside it. A synthesized row is a hole in the spec *and* an unproven response, so it lands in `gapCount` while the description slot is what names it a spec hole; the verified percentage therefore measures every response the report renders, not the documented surface alone.
3. **Generator** (`scripts/generate-proof.ts`): calls the analyzer, writes the result to `app/proof.generated.json`. This is checked in, deterministic, and regenerated automatically before `dev`/`build`. When no target spec is found it writes an empty proof (exit 0) so the app always builds and renders its empty state — unless that would replace a proof that already had operations, which takes `--allow-empty`; see "Barebones specs" below.
4. **Consumer** (`app/page.tsx` → `components/CoverageProof.tsx`): renders the checked-in artifact only. Two stamps sit in the description slot and never substitute for text the spec did write: `MISSING FROM SPEC` for a status the spec does not document at all (`documented: false`, synthesized or asserted), `NO DESCRIPTION` for a response the spec lists with an empty `description`, or an operation with no `summary`. The trailing stamp is the test verdict and is independent of both, so an asserted status the spec omits reads `MISSING FROM SPEC` and `UNDOCUMENTED` together. No target checkout is needed to build or deploy the app itself. An empty proof renders an empty-state hint, branching on the report's `hasSpec` flag: `false` means no API definition was found at all and shows the `--repo` / `--spec` hints, `true` means a spec exists but documents no operations yet and shows the `paths:` stanza to add next.
5. **Drift guard** (`tests/integration/proof-contract.integration.test.ts`): fails when the artifact is stale relative to the spec/tests, when the proof's audited operations don't exactly match the spec's operations, or when a quoted snippet no longer points at a real `it()`/`test()` line. This suite self-skips (via `describe.skipIf`) when no target spec is resolvable — in this repo one always is (the example fixture), so `bun run test:integration` always exercises the full analyzer here.

## Example fixture (`example/`)

`example/` is a hand-written demo target: `example/api/openapi.json` (the fictional "TaskFlow" API, 7 operations) plus `example/tests/*.test.ts` written in exactly the `describe("METHOD /path")` / `.status).toBe(NNN)` shape the parser expects. Because spec auto-discovery finds the shallowest `openapi*` spec under the target root (cwd by default), running `dev` / `generate:proof` / `test` from this repo audits the example automatically — no `SPECPROOF_REPO` needed. Neither the example nor its generated proof is published to npm (both excluded from the `files` allowlist): TaskFlow exists purely for this repo's development, demos, and tests; installed consumers start from an empty proof.

- The example files are **fixture data parsed as text**, never executed or compiled: they are excluded from vitest (`vitest.config.ts`), tsc (`tsconfig.json`), and eslint (`eslint.config.mjs`). They only need to look like a prettier-formatted test suite.
- The spec and tests are **deliberately out of step** so the demo shows every verdict state: fully proven operations (`POST /auth/login`, `GET /tasks`, `GET /tasks/{taskId}`), partial coverage (`POST /tasks`, `PATCH /tasks/{taskId}`), an untested operation (`GET /projects`), a status the tests assert that the spec omits (500 on `DELETE /tasks/{taskId}`), and a response the spec lists with an empty `description` (422 on `POST /tasks`, which a test does assert, so it reads `NO DESCRIPTION` and `VERIFIED` together). No operation documents a 500, so every one carries a `MISSING FROM SPEC` row: six synthesized and stamped `NO TEST`, and the delete's, which the test asserts, stamped `UNDOCUMENTED`. That last pair is what shows a status is never listed twice, and that the description slot and the verdict answer different questions. Preserve that mix when editing.
- Editing anything in `example/` makes the checked-in proof stale and fails the contract tests: run `bun run generate:proof` and commit the regenerated `app/proof.generated.json`.

## Barebones specs (the develop-alongside loop)

SpecProof is expected to be pointed at a repo whose API is still being written, so an incomplete spec must render rather than fail. `loadSpec` treats an empty file, a whitespace-only file, and a comment-only YAML file (which parses to `null`) as `{}`: a scaffold, not a broken document. The check happens before parsing because an empty `.json` is a syntax error while an empty `.yaml` is the legal null document, and the same intent must not depend on the extension. Genuinely malformed specs still throw.

The zero-operations guard is **regression-aware, not absolute**: an empty proof is refused only when it would overwrite one that already had operations (truncation, or discovery latching onto the wrong file), and `--allow-empty` overrides that deliberately. With nothing to lose, zero operations is just the ordinary state of a new spec, so the generator writes it and exits 0. This is what makes a committed empty proof a legitimate `--check` state instead of perpetual drift.

**No spec at all takes the same path**, and for the same reason: the generator writes an empty `hasSpec: false` proof rather than keeping whatever was already there, and only refuses when the proof being replaced has operations in it (then `--allow-empty` overrides, as above). It used to keep any existing artifact unconditionally, which meant `specproof dev --repo <repo-with-no-spec>` opened on the *previously audited* repo's coverage, relabeled with the new repo's name — the same cross-repo confusion the zero-operations guard was made regression-aware to avoid, reached through the other branch. A proof that has operations is still left alone without the flag, because a spec that suddenly can't be found is more often broken discovery than a deleted API. `--check` is unaffected: with no spec it remains a hard failure, since CI asked for a verification that can't be performed.

`dev` and `build` pass `--allow-empty` internally when refreshing the bundled artifact, because that file is a cache of whichever repo was last audited rather than a durable record of this one. Without it the guards compare operation counts across two unrelated repos and leave the previous repo's coverage on screen while claiming to audit a scaffold. They still apply to an explicit `--out`, which is the consumer's committed proof.

`specproof dev` also **watches** the audited repo (`watchSources` in `scripts/cli.ts`): a recursive `fs.watch` filtered to spec-named files and `*.test.*`, debounced 150ms, regenerating the bundled artifact so Next's HMR refreshes the view. Notes:
- The filter deliberately excludes the proof itself, or a repo auditing itself (this one) would loop forever.
- Files are matched by *name*, not against the currently resolved spec, because the whole point is that the spec often doesn't exist yet at startup.
- `dev` uses `nextCliAsync` (`spawn`), not `spawnSync`: the synchronous version blocks the event loop and the watcher would never fire. `build`/`start` still use `spawnSync`.
- `dev` no longer aborts when the spec fails to parse: it warns, ensures an artifact exists so Next can boot, and heals on the next save. `build` stays a hard failure.

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
bun run test              # vitest run (all suites under tests/)
bun run test:unit         # tests/unit only: analyzer + generator, in isolated temp repos
bun run test:integration  # tests/integration only: the drift-guard contract test (audits example/ unless SPECPROOF_REPO is set)
bun run test:unit:watch        # vitest watch mode, tests/unit
bun run test:integration:watch # vitest watch mode, tests/integration
bun run lint             # eslint + tsc --noEmit
bun run lint:es          # eslint only
bun run lint:ts          # tsc --noEmit only
```

### Manual harness for the develop-alongside loop

`scripts/manual-dev-watch.ts` drives the one behavior the automated suites can't assert, because it only exists in a running dev server: `specproof dev` on a repo with no spec, then `touch openapi.yaml` and add a path, with the audit view moving from the empty state to a verdict and no restart in between. Two terminals:

```bash
bun run manual:dev       # scratch target repo with no spec + specproof dev on :3002 (PORT overrides)
# then, in a second terminal:
bun run manual:spec      # step 1: touch openapi.yaml    -> hasSpec flips true, paths: hint
bun run manual:path      # step 2: document GET /widgets -> a verdict appears (200, 500 untested)
bun run manual:test      # step 3: add a passing test    -> 200 flips to proven with its snippet
bun run manual:status    # what the scratch repo and the proof currently hold
bun run manual:reset     # delete the scratch repo
```

Two things it does deliberately, both of which the walkthrough is wrong without:

- The scratch repo lives in the OS temp dir, never inside this checkout. A spec file here would tie with (or beat) `example/api/openapi.json` on discovery depth and silently change what this repo's own tests audit.
- `manual:dev` snapshots `app/proof.generated.json` and restores it on exit. The run itself is supposed to overwrite it: replacing this repo's committed TaskFlow proof with the scratch repo's empty one is step 0 of the walkthrough. Restoring afterwards is what keeps the contract tests from failing on a scratch repo's coverage. If the process is killed hard enough to skip the restore, `bun run generate:proof` puts it back.

Tests live under `tests/`, split by kind: `tests/unit/` holds suites that exercise a module in isolation against self-contained temp-dir fixtures, `tests/integration/` holds suites that exercise the real pipeline end to end against this repo's own checked-in state — and its files are named `*.integration.test.ts` to mark that. To run a single test file: `bunx vitest run tests/unit/api-test-coverage.test.ts` (analyzer unit tests), `bunx vitest run tests/unit/generate-proof.test.ts` (generator tests: YAML/JSON equivalence, `--check` behavior on drift, malformed and empty specs, discovery ambiguity), or `bunx vitest run tests/integration/proof-contract.integration.test.ts` (the drift-guard contract test). The generator tests always pass an explicit `out` into a temp repo, and re-import the generator through `vi.resetModules()` per run because `SPECPROOF_REPO`/`SPECPROOF_SPEC` are read at module load. The unit tests' inline fixtures deliberately use operations that don't exist in the example spec (`/widgets`, `/gadgets`) — the analyzer parses this repo's own `*.test.ts` files as raw text when auditing `example/`, and colliding paths would pollute the generated proof.

To audit a real repo instead of the bundled example:

```bash
SPECPROOF_REPO=/path/to/target-repo bun run generate:proof
# optionally, if the spec has a nonstandard name/location:
SPECPROOF_REPO=/path/to/target-repo SPECPROOF_SPEC=docs/api-spec.json bun run generate:proof
```

## CLI / npm packaging

The package ships a `specproof` bin (`dist/scripts/cli.js`, `#!/usr/bin/env node` shebang) for use when installed into a target repo — with any package manager: `npm install -D specproof` + `npx specproof dev`, or the `bun add -d` / `pnpm add -D` / `yarn add -D` equivalents. Commands: `generate` / `dev` / `build` / `start`, with `--repo` / `--spec` mapping to the env vars, `--port` for dev/start, `--no-watch` for dev, and (generate only) `--out <path>` (env `SPECPROOF_OUT`) to write the proof somewhere other than the bundled `app/proof.generated.json` — e.g. committed into the consumer's repo — plus `--check`, which verifies the file at `--out` is current instead of writing and exits 1 on drift (the consumer-side CI guard; unlike plain generate, a missing spec is a hard failure under `--check`), and `--allow-empty` (see "Barebones specs" above). Next.js commands run against the package directory (`next dev <pkgDir>`), while the analyzer audits the consumer's cwd. The CLI sets `SPECPROOF_REPO`/`SPECPROOF_SPEC` env vars *before* dynamically importing the generator, because the analyzer reads them at module load.

**Why `dist/` and not raw TypeScript sources:** the bin used to point straight at `scripts/cli.ts` with a `#!/usr/bin/env bun` shebang, relying on Bun's ability to execute TypeScript with no build step — which made Bun a hard runtime requirement for every consumer, not just this repo's own dev tooling. `tsconfig.cli.json` compiles `scripts/cli.ts` + `scripts/generate-proof.ts` + `lib/api-test-coverage.ts` to plain Node-ESM JS under `dist/` (mirroring the source tree, so relative imports resolve unchanged); `npm run build:cli` runs it, and `prepublishOnly` wires it into `npm publish` automatically. `dist/` is gitignored — it's a build artifact, regenerated at publish time, never checked in. `cli.ts`'s dynamic-`import()` of the generator (rather than the old synchronous `require()`) exists because plain Node — unlike Bun — cannot `require()` an ESM module synchronously.

`package.json`'s `files` allowlist keeps the tarball to the runnable app (`app`, `components`, `dist`, `lib`, and the Next/Tailwind/TS configs) — `example/`, `app/proof.generated.json` (the TaskFlow demo data must not ship; a fresh install gets an empty proof written by the generator's no-spec fallback instead), `public/` (branding PNGs only, referenced by the README via a raw.githubusercontent URL), `marketing/`, CI workflows, `CHANGELOG.md`, this repo's own test suites (`tests/` is never in the allowlist at all, so everything under it — unit and integration alike — is excluded without needing an explicit `!` entry), and this file are deliberately not published. `lib/api-test-coverage.ts` itself *does* ship despite also being compiled into `dist/lib/api-test-coverage.js` for the CLI's own runtime use — the raw source is still required because `app/page.tsx` and `components/CoverageProof.tsx` reference its types via `import type`, and Next's production build (`specproof build`) runs a full TypeScript typecheck that needs the actual `.ts` file on disk even though the import is erased at runtime; shipping only `dist/`'s compiled JS (no `.d.ts`, since `tsconfig.cli.json` sets `declaration: false`) made `specproof build` hard-fail for every installed consumer until this was caught. `lib/utils.ts` (the `cn()` classname helper `components/ui/*` import at runtime) ships as a plain file too — it's app UI code, not CLI code, so it was never part of the `tsconfig.cli.json` compile set to begin with. When adding a file the published app needs at runtime *or* at build-time typecheck, add it to `files`. Nothing SpecProof writes is ever a spec: the generator's only output is the proof at `--out`, and it refuses an `--out` whose basename auto-discovery would match (`openapi*` / `swagger*`), so the proof can neither clobber the definition it was compiled from nor be mistaken for one on the next run. The same care applies to packages: `yaml` (the spec parser) is a real `dependencies` entry rather than a dev dependency, because `dist/lib/api-test-coverage.js` imports it on every `specproof generate` in a consumer's repo.

## Updating the proof

When a target repo's test or OpenAPI spec changes, the checked-in `app/proof.generated.json` goes stale and the contract tests fail. Fix:

```bash
SPECPROOF_REPO=/path/to/target-repo bun run generate:proof
git add app/proof.generated.json && git commit
```

The marketing site's hero carries a mirror of that same proof. `bun run generate:mockup` (`scripts/generate-mockup.ts`) rewrites the markup between the two marker comments inside `marketing/index.html`'s `<div class="report">` from `app/proof.generated.json`, so the mockup shows the audit the app renders rather than a hand-written impression of it. The page around it, its CSS, and the accordion script at the foot of the file are hand-maintained; the mockup has the same tag and route accordions the app does, minus the stamp that opens the test-code panel. The same run also rewrites the footer's `<span id="r-version">` from `package.json`'s `version`, so a release bump can't leave that tag pointing at a stale version the way it once did. Regenerate it whenever the example fixture changes or the version bumps: nothing tests it, so a stale mockup fails nothing and simply lies.

## CI & Releasing

`main` is protected by a repo ruleset (PR required, merge queue, no direct pushes). The flow: open a PR → the CI workflow (`.github/workflows/ci.yml`, jobs `Build` / `Lint` / `Test` / `Verify E2E`) runs on the PR and again in the merge queue → all checks must pass → clicking merge queues the PR and GitHub merges it (squash). The `Build` job runs `bun run build:cli` and smoke-tests `dist/scripts/cli.js` under a plain Node install with no Bun in the execution path. The `Test` job runs `bun run test:unit` and `bun run test:integration` as two separate steps, unit first, rather than the combined `bun run test`, so a CI log or a re-run targets one kind without pulling in the other. The `Verify E2E` job goes further and is the real regression guard for "the published CLI works with any package manager": a 4-way matrix (`npm` / `pnpm` / `yarn` / `bun`) that packs the tarball, does a real install of it into a scratch consumer repo (copied from `example/`) via that package manager, then runs `specproof generate` through that manager's actual invocation path (`npx`, `pnpm exec`, `yarn <bin>`, `bunx`) and checks the resulting proof has operations, then exercises the `--check` drift guard end-to-end (fresh proof passes, an injected spec change fails it without writing, regenerating heals it, and the no-spec hard-fail-vs-soft-skip asymmetry). A further step walks the barebones loop in that same fixture: `touch openapi.yaml` generates an empty proof with `hasSpec: true` and passes `--check`, adding the first operation makes `--check` fail until regenerated, and emptying a spec whose proof had operations stays a hard failure that leaves the proof untouched until `--allow-empty` is passed. One step converts the consumer's spec to YAML with a real YAML writer and asserts the format is invisible to the proof: with both files present discovery must stay on the JSON copy and warn about the tie, and with only the YAML present the proof must come out byte-identical and still pass `--check` against the JSON-derived one. That conversion runs from the checkout rather than the fixture, because `yaml` is installed there. The `yarn` leg activates Yarn Classic via Corepack (`corepack enable && corepack prepare yarn@1.22.22 --activate`); that step itself is cwd-independent, but note that invoking the resulting `yarn` shim from *this repo's own* directory would fail (`Unsupported package manager specification (bun@1.1.38)`) because Corepack reads the nearest `package.json`'s `packageManager` field and doesn't recognize Bun — which is why the install/run steps operate in the scratch consumer fixture (`/tmp/consumer`, its own unrelated `package.json`), not the checkout.

Every merge to `main` then triggers `.github/workflows/release.yml`, which publishes to npm when `package.json`'s version isn't already on the registry (needs the `NPM_TOKEN` repo secret). It installs deps with Bun, then runs `npm publish`, whose `prepublishOnly` lifecycle script rebuilds `dist/` before packing. To release: bump `version` in `package.json`, open a PR, and merge. There is no manual release trigger.

## Notes on the parsing approach

`lib/api-test-coverage.ts` parses test files with regexes rather than a real TS/AST parser, relying on prettier-consistent formatting conventions in the audited repo:
- `describe("METHOD /path")` titles are matched for the HTTP method prefix (`GET|POST|PUT|DELETE|PATCH`) followed by the operation path.
- `it()`/`test()` blocks are extracted by matching the opening call, then scanning for the next `});` at the same indentation level — not a brace-matching parser, so it depends on consistent formatting in the audited repo.
- Snippet source is dedented before being stored/rendered.

If this parsing logic needs updating, check it against real test files in a target repo — the contract test's "every quoted snippet points at a real it()/test() block" check is what catches regressions here.
