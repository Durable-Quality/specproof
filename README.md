<img src="public/banner.png" alt="SpecProof" />

# SpecProof

A standalone Next.js app that renders an audit view of any repo's API test coverage: every OpenAPI operation and response status, cross-examined against the repo's test assertions. Click a stamped verdict to read the test itself.

Point it at a repo the same way OpenAPI tooling works when installed into one — no repo-specific configuration is baked in:

- **Sources of truth** (read from the target repo, `SPECPROOF_REPO`): the OpenAPI spec (auto-discovered `openapi*.json` / `swagger*.json`, or set `SPECPROOF_SPEC`) + the repo's `*.test.ts` files, parsed from `describe("METHOD /path")` blocks and `.status).toBe(NNN)` assertions. `{param}`, `[param]`, and `:param` path segments are treated as equivalent when matching.
- **Generator**: `scripts/generate-proof.ts` compiles them into `app/proof.generated.json` — checked in, deterministic, regenerated automatically before `dev`/`build`.
- **Consumer**: the app renders the checked-in artifact; no target checkout is needed to build or deploy.
- **Drift guard**: `app/proof-contract.test.ts` fails CI when the artifact is stale relative to the spec/tests, when the proof doesn't cover exactly the spec's operations, or when a quoted snippet no longer points at a real `it()` block. It self-skips when no target repo is configured.

## Setup

Requires [Bun](https://bun.sh).

```bash
bun install
SPECPROOF_REPO=/path/to/your-repo bun run dev   # compiles the proof, then serves on http://localhost:3001
```

`SPECPROOF_REPO` defaults to the current working directory, so running the generator from inside the target repo needs no configuration at all. If the spec isn't named `openapi*.json` / `swagger*.json`, point `SPECPROOF_SPEC` at it (relative to the repo root).

## Commands

```bash
bun run dev             # generate:proof + next dev (port 3001)
bun run build           # generate:proof + next build
bun run start           # serve the production build (port 3001)
bun run generate:proof  # regenerate app/proof.generated.json only
bun run test:unit       # contract tests (self-skip without a configured target repo)
bun run lint            # ESLint + tsc
```

## Updating the proof

When the target repo's tests or OpenAPI spec change, the checked-in artifact goes stale and the contract tests fail. The fix:

```bash
SPECPROOF_REPO=/path/to/your-repo bun run generate:proof
git add app/proof.generated.json && git commit
```

## Conventions the parser relies on

- Test suites titled `describe("METHOD /path")` (`GET|POST|PUT|DELETE|PATCH`) — the path is matched against the spec's paths.
- Status assertions written as `.status).toBe(NNN)` or `.status).toEqual(NNN)`.
- Prettier-consistent formatting: `it()`/`test()` blocks are extracted by indentation, not a full parser.

## Releasing

Merges to `main` run the [Release workflow](.github/workflows/release.yml), which publishes the package to npm whenever `package.json`'s version isn't on the registry yet (requires the `NPM_TOKEN` repository secret).
