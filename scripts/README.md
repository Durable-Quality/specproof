# Scripts

## cli.ts

The `specproof` bin (`npx specproof <command>`, or the bunx/pnpm dlx/yarn dlx
equivalent). Audits the repo it's run from (`--repo` / `SPECPROOF_REPO`);
the Next.js dev/build/start commands run against the SpecProof package
directory itself. Ships compiled to plain JS (`tsconfig.cli.json`,
`bun run build:cli`), so it needs Node only, no Bun, at install time.

```
specproof generate   # compile the coverage proof from the target repo's spec + tests
specproof dev         # generate, then serve the audit view with next dev
specproof build        # generate, then production-build the audit view
specproof start        # serve the production build

--repo <path>     repo to audit (default: cwd; env SPECPROOF_REPO)
--spec <path>     OpenAPI spec, relative to the repo root (env SPECPROOF_SPEC)
--out <path>      generate only: where to write the proof (env SPECPROOF_OUT)
--check           generate only: verify --out is current instead of writing; exits 1 on drift
--allow-empty     generate only: write a proof with no operations even if the one replaced had some
--port <port>     dev/start only: port to serve on (default: 3001)
--no-watch        dev only: don't rebuild the proof when the spec or tests change
```

`dev` also watches the audited repo (`watchSources`: a debounced `fs.watch`
on spec-named files and `*.test.*`), regenerating the bundled artifact so
Next's HMR refreshes the view without a restart.

## generate-proof.ts

Reads the target repo's OpenAPI spec + tests and writes the coverage proof.
Runs via `bun run generate:proof` (also automatically before `bun run dev` /
`bun run build`), or `specproof generate` once installed elsewhere.

```bash
bun run generate:proof                                  # writes app/proof.generated.json
SPECPROOF_REPO=/path/to/target bun run generate:proof    # audit a different repo
```

Writes `app/proof.generated.json` by default; `--out` / `SPECPROOF_OUT`
redirects it. `--check` verifies the output is current without writing (the
CI drift guard). A missing spec or zero-operation spec writes an empty proof
so the app still renders its empty state, unless that would overwrite a
proof that already had operations, which needs `--allow-empty` (passed
automatically by `dev`/`build`; see "Barebones specs" in the top-level
`CLAUDE.md`).

```bash
bunx vitest run tests/unit/generate-proof.test.ts   # YAML/JSON equivalence, --check drift, empty/malformed specs, discovery ties
```

## manual-dev-watch.ts

Manual harness for the "develop-alongside" loop: `specproof dev` on a repo
that starts with no spec, watching the audit view move from empty state to a
proven verdict as spec and tests get added, no restart in between. This only
exists in a running dev server, so it isn't covered by the automated suites.

Runs against a scratch repo in the OS temp dir
(`$TMPDIR/specproof-manual-target`), never inside this checkout, so it can't
tie with `example/api/openapi.json` in spec auto-discovery.

**Terminal 1** — create the scratch repo and serve it (leave running; restores
this repo's own `app/proof.generated.json` on Ctrl-C):

```bash
bun run manual:dev       # scratch repo with no spec + specproof dev on :3002 (PORT overrides)
```

**Terminal 2** — step through, checking `http://localhost:3002` after each:

```bash
bun run manual:spec      # step 1: touch openapi.yaml    -> hasSpec flips true, paths: hint
bun run manual:path      # step 2: document GET /widgets -> a verdict appears (200, 500 untested)
bun run manual:test      # step 3: add a passing test    -> 200 flips to proven with its snippet
bun run manual:status    # what the scratch repo and the proof currently hold
bun run manual:reset     # delete the scratch repo (rerun manual:dev to start over)
```

Notes: port 3002 keeps this separate from the 3001 example-fixture dev
server. If Terminal 1 is killed hard enough to skip the restore, run
`bun run generate:proof` to put this repo's proof back. `manual:spec` /
`manual:path` / `manual:test` / `manual:status` all require `manual:dev` to
have run first.
