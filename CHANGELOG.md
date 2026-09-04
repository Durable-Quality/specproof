# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.9.0] - 2026-09-04

### Added
- A `NO DESCRIPTION` stamp marks an operation with no `summary` and a documented response with an empty `description`, so a missing description reads as the spec gap it is instead of as blank space.
- A `MISSING FROM SPEC` stamp marks every response status the spec does not document, greying the status code. Statuses SpecProof expects of an operation and never finds are now listed rather than silently absent: `500` for every operation, `404` where a path parameter addresses a resource, and `400` where the operation declares a request body. The stamp is about the spec, so it is independent of the test verdict beside it: a status nothing asserts reads `NO TEST`, and one the tests do assert reads `UNDOCUMENTED`.

### Changed
- `UNDOCUMENTED` is now reserved for a status the tests assert that the spec never mentions. A status with no assertions reads as `NO TEST` whether the spec documents it or not.

### Fixed
- A status code asserted in tests but absent from the OpenAPI spec no longer replaces the route's description with "asserted in tests, but absent from the OpenAPI spec". A description is only ever the spec's own, shown as written; SpecProof never substitutes text for it.

## [0.8.0] - 2026-08-03

### Added
- Specs can now be developed alongside SpecProof from nothing: an empty, comment-only, or path-less OpenAPI file compiles to an empty proof and renders instead of failing, so `specproof dev` opens on a repo whose API is still being written.
- `specproof dev` watches the audited repo's spec and test files and rebuilds the proof as they change, so adding an operation shows up in the report without a restart. Disable with `--no-watch`.
- `specproof generate --allow-empty` writes a proof with no operations even when the one it replaces had some.
- The report distinguishes "no API definition found" from "a spec exists but documents no operations yet", and the second points at the next edit to make.

### Changed
- The empty-proof guard is now regression-aware rather than absolute: writing a proof with no operations is refused only when it would overwrite one that had some. That case keeps its hard failure, and names both counts in the message.
- Finding no spec at all now writes an empty proof rather than keeping whatever was already on disk. Auditing a repo whose API isn't written yet could previously leave the previously audited repo's coverage on screen, relabeled with the new repo's name. A proof that already has operations is still kept, since a spec that suddenly can't be found is more often a moved file than a deleted API, and the warning now names `--allow-empty` as the override. `specproof dev` and `build` pass that flag when refreshing their own artifact; `--check` remains a hard failure.
- `specproof dev` no longer refuses to start when the spec doesn't parse. It warns, serves the last good proof, and heals on the next save, since half-written YAML is the normal state of a file being edited. `specproof build` still fails hard.

### Upgrading
- Proofs gain a `hasSpec` field, so a proof committed by 0.7.x is one field behind. Run `specproof generate` once and commit the result. `specproof generate --check` detects this case and says the proof came from an older SpecProof rather than reporting it as spec drift, so CI points at the upgrade instead of sending you looking for a change that didn't happen. Plain `specproof generate` just rewrites the file.

## [0.7.2] - 2026-08-01

### Changed
- Replaced the README's static coverage report screenshot with a walkthrough GIF covering the route breakdown and test snippet detail views.

## [0.7.1] - 2026-08-01

### Changed
- Trimmed the README to a quick start and CLI summary, since the marketing site now covers install variants, conventions, and the CI drift-guard example in more depth.
- Added a screenshot of the coverage report to the README.

## [0.7.0] - 2026-07-30

### Added
- YAML OpenAPI specs are read directly: auto-discovery now matches `openapi*` / `swagger*` in `.json`, `.yaml`, and `.yml`, and `--spec` accepts any of them (any other extension is sniffed). A spec and its conversion to the other format produce a byte-identical proof, so switching formats never registers as drift.
- `specproof generate` warns when two specs sit at the same depth in the tree, naming the one it audited. The case that matters is a `openapi.yaml` checked in beside a converted `openapi.json`, where the loser is usually stale.
- `generate` now names the spec it read in its success and `--check` output.

### Changed
- A malformed, empty, or non-object spec now fails with a one-line message instead of an uncaught stack trace, in both `generate` and `generate --check`, and never overwrites an existing proof.
- Tag section headers in the report no longer carry a leading sequence number.

### Fixed
- `generate` refuses an `--out` path that spec auto-discovery would read as an API definition (`openapi*` / `swagger*`), which previously let the proof overwrite the spec it was compiled from, or be audited as a spec on the next run.

## [0.6.1] - 2026-07-30

### Added
- The report footer now shows the SpecProof version it was rendered with.

### Changed
- The evidence panel's source line prints the test file's real path instead of upper-casing it.
- Footer credit now reads "BUILT BY DURABLE QUALITY".
- Trimmed the advice clause from the evidence panel's undocumented-status note.

## [0.6.0] - 2026-07-30

### Changed
- The report masthead now shows the audited repo's name as the main title, with the compile timestamp beneath it.
- Added a report footer crediting SpecProof and linking to Durable Quality, pinned to the bottom of the page.
- Operation rows no longer show a per-operation test-file summary line.

## [0.5.0] - 2026-07-21

### Added
- `specproof generate --check`, `dev`, `build`, and `start` now install and run with any package manager (npm, pnpm, yarn, or bun) — no Bun requirement for consumers.

### Changed
- The published CLI now ships as compiled JavaScript instead of raw TypeScript, so it runs on plain Node without a TypeScript-execution runtime.

## [0.4.0] - 2026-07-15

### Added
- The coverage report now records the audited repo's name (its package.json `name`, falling back to the directory name) and displays it in the report masthead.

### Changed
- Report header redesigned: the summary facts are now a labeled metadata strip with the verified percentage as one of the stats, and the compile timestamp (with time, in UTC) sits under the repo name.
- Tag sections are now collapsible accordions, open by default, with the per-tag verified count in the trigger row.
- Removed the standalone verdict legend row and the dot-leader fillers; status marks are right-aligned instead.

## [0.3.0] - 2026-07-15

### Added
- `specproof` CLI with `generate`, `dev`, `build`, and `start` commands, so the package is fully usable when installed into a target repo (`bun add -d specproof && bunx specproof dev`), with `--repo`, `--spec`, and `--port` options.
- `--out <path>` option (env `SPECPROOF_OUT`) on `generate` to write the proof anywhere, such as committed inside the audited repo.
- `--check` option on `generate`: verifies the proof at the output path is up to date and exits 1 on drift, for use as a CI guard.
- The generator writes an empty proof when no spec is found and no artifact exists yet, so a fresh install builds and renders the empty state.

### Changed
- The npm package now ships only what consumers need (analyzer, CLI, report app, configs): 17 files at about 18 kB, down from 36 files at 1.5 MB; brand images, the TaskFlow example and its demo proof, internal test suites, CI workflows, and internal docs are no longer published.
- Build toolchain packages (typescript, tailwindcss, postcss, postcss-import, autoprefixer, type stubs) moved from devDependencies to dependencies, and the app opts into `transpilePackages`, so the report app builds from source under `node_modules`.
- README rewritten to be shorter and consumer-focused: quick start, CLI reference, and CI drift guard.
- The report's empty-state hint now shows installed CLI commands instead of repo-checkout commands.
- Compressed `icon.png` from 369 kB to 24 kB and removed the unused banner and logo images; the README loads the icon from the repo instead of the package.

## [0.2.1] - 2026-07-14

### Changed
- Renamed the CI workflow file from `test-unit.yml` to `ci.yml` and refreshed the emoji in both workflow titles.

## [0.2.0] - 2026-07-14

### Added
- Bundled `example/` demo target: the fictional TaskFlow API (7 operations) plus fixture test files, audited automatically when no `SPECPROOF_REPO` is set — the app now renders a meaningful proof out of the box, demonstrating every verdict state.
- Unit test suite for the coverage analyzer (`lib/api-test-coverage.test.ts`, 30 tests): path-param normalization, snippet extraction, test-file parsing, spec discovery, evidence merging, and report assembly with independently computed expectations.
- CI workflow with separate `Build`, `Lint`, and `Test` jobs, running on pull requests and in the merge queue.
- Merge queue ruleset on `main`: PRs required, all CI checks must pass, no direct pushes.
- Marketing showcase page (`marketing/`) and brand assets (`public/`), with a banner in the README.

### Changed
- Releases now publish only after a PR merges to `main` through the merge queue; the manual release trigger was removed.
- `buildCoverageReport()` accepts an optional target repo root, and the analyzer's parsing internals are exported for testing.
- Larger SpecProof masthead in the coverage view.

## [0.1.0] - 2026-07-13

### Added
- Initial public release under new name SpecProof (npm package `specproof`).
- GitHub Actions release workflow: automatically publishes to npm when package version is updated.
- Comprehensive project documentation in CLAUDE.md.
- Generalized spec/test discovery: auto-discovers OpenAPI specs (`openapi*.json`, `swagger*.json`) and test files in any target repo; no longer OmniLens-specific.
- Support for explicit spec path via `SPECPROOF_SPEC` environment variable.

### Changed
- **Breaking**: Renamed environment variable `OMNILENS_REPO` → `SPECPROOF_REPO` for specifying the target repo to audit.
- **Breaking**: Renamed environment variable `OMNILENS_SPEC` → `SPECPROOF_SPEC` for specifying the OpenAPI spec path.
- Renamed npm package from `test-ledger` to `specproof`.
- Renamed generator script `scripts/generate-ledger.ts` → `scripts/generate-proof.ts` and npm command `generate:ledger` → `generate:proof`.
- Renamed generated artifact `app/ledger.generated.json` → `app/proof.generated.json`.
- Renamed contract test file `app/ledger-contract.test.ts` → `app/proof-contract.test.ts`.
- Renamed stylesheet `app/ledger.css` → `app/proof.css`.
- Renamed React component `CoverageLedger` → `CoverageProof`.
- Updated CSS class prefix `lg-` → `sp-` throughout the codebase.
- Generalized code comments and documentation from OmniLens-specific to target-agnostic language.
- GitHub Actions workflow `test-unit.yml` renamed to "Proof Contract Tests" with updated environment variable references.
- Removed `"private": true` from package.json to allow npm publishing.
- Updated package.json metadata: added `repository`, `homepage`, `description`, and `keywords`.

### Removed
- OmniLens-specific hardcoded paths and configuration.
