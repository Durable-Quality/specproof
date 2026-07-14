# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
