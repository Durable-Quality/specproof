# Scripts

## cli.ts

The `specproof` bin: the entrypoint installed consumers run (`npx specproof <command>`,
or the bunx/pnpm dlx/yarn dlx equivalent). Audits the repo it's run from
(override with `--repo` / `SPECPROOF_REPO`), while the Next.js dev/build/start
commands run against the SpecProof package directory itself, wherever it's
installed. Ships compiled to plain JS (`tsconfig.cli.json`, `bun run build:cli`)
so it runs under any package manager's Node, no Bun required at install time.

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

`dev` also watches the audited repo (`watchSources`): a recursive `fs.watch`
filtered to spec-named files and `*.test.*`, debounced 150ms, regenerating the
bundled artifact so Next's HMR refreshes the view without a restart.

## generate-proof.test.ts

Vitest suite for the generator itself: YAML/JSON spec equivalence, `--check`
behavior on drift, malformed and empty specs, and discovery ambiguity (two
specs tied at the same depth). Each test passes an explicit `out` into a temp
repo and re-imports the generator through `vi.resetModules()`, since
`SPECPROOF_REPO` / `SPECPROOF_SPEC` are read at module load.

```bash
bunx vitest run scripts/generate-proof.test.ts
```

## generate-proof.ts

Reads the audited target repo's OpenAPI spec + test suites (cwd by default,
override with `SPECPROOF_REPO`; spec auto-discovered, override with
`SPECPROOF_SPEC`) and writes the resulting coverage proof. Runs via
`bun run generate:proof` in this repo's own dev loop (also automatically
before `bun run dev` / `bun run build`), or `specproof generate` once
installed elsewhere.

```bash
bun run generate:proof                          # writes app/proof.generated.json (this repo's own loop)
SPECPROOF_REPO=/path/to/target bun run generate:proof   # audit a different repo
```

Defaults to writing the checked-in artifact at `app/proof.generated.json`;
`--out` / `SPECPROOF_OUT` redirects it (e.g. into a consumer's repo to
commit). `--check` verifies the output file is current without writing: the
CI drift guard. When no target spec is found, or a spec documents zero
operations, an empty proof is written so the app still builds and renders its
empty state, unless doing so would overwrite a proof that already had
operations, which requires `--allow-empty` (passed automatically by
`dev`/`build`; see "Barebones specs" in the top-level `CLAUDE.md`).

## manual-dev-watch.ts

Manual harness for the "develop-alongside" loop: `specproof dev` pointed at a
repo that starts with no spec, watching the audit view move from the empty
state to a proven verdict as a spec and tests get added, with no restart in
between. This is the one behavior the automated test suites can't assert,
since it only exists in a running dev server.

Everything runs against a scratch target repo in the OS temp dir
(`$TMPDIR/specproof-manual-target`), never inside this checkout, so it can't
tie with (or beat) `example/api/openapi.json` in spec auto-discovery.

Two terminals.

**Terminal 1** — create the scratch repo and serve it:

```bash
bun run manual:dev       # scratch repo with no spec + specproof dev on :3002 (PORT overrides)
```

Leave this running. It restores this repo's own `app/proof.generated.json`
on exit (Ctrl-C), since `specproof dev` overwrites that file with whatever
it's auditing while it runs.

**Terminal 2** — step through the walkthrough, checking `http://localhost:3002`
after each step:

```bash
bun run manual:spec      # step 1: touch openapi.yaml    -> hasSpec flips true, paths: hint
bun run manual:path      # step 2: document GET /widgets -> a verdict appears (200, 500 untested)
bun run manual:test      # step 3: add a passing test    -> 200 flips to proven with its snippet
```

Other steps, run any time:

```bash
bun run manual:status    # what the scratch repo and the proof currently hold
bun run manual:reset     # delete the scratch repo (run manual:dev again to start over)
```

Notes:

- Port is 3002, not the 3001 `bun run dev` uses, so a tab watching the
  ordinary example-fixture dev server can't be mistaken for the walkthrough.
- If Terminal 1 gets killed hard enough to skip the restore step, run
  `bun run generate:proof` to put this repo's own proof back.
- `manual:spec` / `manual:path` / `manual:test` / `manual:status` all require
  the scratch repo to exist already: run `manual:dev` first.
