<img src="https://raw.githubusercontent.com/Durable-Quality/specproof/main/public/icon.png" alt="SpecProof" width="120" />

# SpecProof

Audit your API test coverage against your OpenAPI spec. SpecProof cross-examines every operation and response status in the spec against your test suite's assertions and renders the verdicts as a browsable report. Click any verdict to read the test that proves it, or see exactly what's untested.

## Quick start

```bash
npm install -D specproof
npx specproof dev   # audit the current repo → http://localhost:3001
```

Works with any package manager: `bun add -d specproof && bunx specproof dev`, `pnpm add -D specproof && pnpm exec specproof dev`, or the `yarn add -D` equivalent.

The OpenAPI spec is auto-discovered (`openapi*` / `swagger*`, in `.json`, `.yaml`, or `.yml`); tests are your `*.test.ts` / `*.test.tsx` / `*.test.js` files.

## CLI

```bash
specproof generate [--out proof.json] [--check]   # compile the coverage proof
specproof dev                                     # generate + serve the report
specproof build && specproof start                # production build + serve
```

| Option | Env var | Meaning |
| --- | --- | --- |
| `--repo <path>` | `SPECPROOF_REPO` | Repo to audit (default: current directory) |
| `--spec <path>` | `SPECPROOF_SPEC` | Spec file, relative to the repo root, when auto-discovery doesn't apply |
| `--out <path>` | `SPECPROOF_OUT` | Where `generate` writes the proof |
| `--port <port>` | | Port for `dev` / `start` (default: 3001) |

## Drift guard in CI

Commit the proof next to your code, then have CI fail whenever the spec or tests change without regenerating it:

```bash
specproof generate --out specproof.json           # regenerate + commit
specproof generate --out specproof.json --check   # CI: exits 1 when stale
```

## Conventions the parser relies on

- Test suites titled `describe("METHOD /path")` (`GET|POST|PUT|DELETE|PATCH`). The path is matched against the spec's paths; `{param}`, `[param]`, and `:param` segments are equivalent.
- Status assertions written as `.status).toBe(NNN)` or `.status).toEqual(NNN)`.
- Prettier-consistent formatting: `it()`/`test()` blocks are extracted by indentation, not a full parser.

## Development

Contributing to this repo (not required to use the published CLI above) uses [Bun](https://bun.sh):

```bash
bun install
bun run dev         # audits the bundled example/ fixture on port 3001
bun run test:unit   # analyzer unit tests + proof drift guards
bun run lint        # ESLint + tsc
```

Point a checkout at a real repo with `SPECPROOF_REPO=/path/to/repo bun run dev`. See [CLAUDE.md](CLAUDE.md) for architecture notes.

## License

MIT
