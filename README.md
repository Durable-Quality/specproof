# Test Ledger

A standalone Next.js app that renders an audit view of [OmniLens](https://github.com/omnilens/OmniLens)'s API test coverage: every OpenAPI operation and response status, cross-examined against the colocated `route.test.ts` assertions. Click a stamped verdict to read the test itself.

It follows the same generate → checked-in artifact → contract-test recipe as OmniLens's OpenAPI spec pipeline:

- **Sources of truth** (read from an OmniLens checkout): `apps/web/app/api/openapi/openapi.generated.json` + `apps/web/app/api/**/route.test.ts` (parsed from `describe("METHOD /api/…")` blocks and `.status).toBe(NNN)` assertions).
- **Generator**: `scripts/generate-ledger.ts` compiles them into `app/ledger.generated.json` — checked in, deterministic, regenerated automatically before `dev`/`build`.
- **Consumer**: the app renders the checked-in artifact; no OmniLens checkout is needed to build or deploy.
- **Drift guard**: `app/ledger-contract.test.ts` fails CI when the artifact is stale relative to the spec/tests, when the ledger doesn't cover exactly the spec's operations, or when a quoted snippet no longer points at a real `it()` block.

## Setup

Requires [Bun](https://bun.sh). The generator and contract tests expect an OmniLens checkout as a sibling directory (`../OmniLens`), or wherever `OMNILENS_REPO` points:

```bash
bun install
bun run dev              # regenerates the ledger, then serves on http://localhost:3001
```

## Commands

```bash
bun run dev              # generate:ledger + next dev (port 3001)
bun run build            # generate:ledger + next build
bun run start            # serve the production build (port 3001)
bun run generate:ledger  # regenerate app/ledger.generated.json only
bun run test:unit        # contract tests (self-skip without an OmniLens checkout)
bun run lint             # ESLint + tsc
```

## Updating the ledger

When an OmniLens API route test or `@openapi` annotation changes, the checked-in artifact goes stale and CI fails. The fix:

```bash
bun run generate:ledger   # or OMNILENS_REPO=/path/to/OmniLens bun run generate:ledger
git add app/ledger.generated.json && git commit
```
