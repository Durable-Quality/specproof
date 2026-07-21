# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
