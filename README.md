<img src="https://raw.githubusercontent.com/Durable-Quality/specproof/main/public/icon.png" alt="SpecProof" width="120" />

# SpecProof

Audit your API test coverage against your OpenAPI spec. SpecProof cross-examines every operation and response status against your test suite's assertions and renders the verdicts as a browsable report.

<img src="https://raw.githubusercontent.com/Durable-Quality/specproof/main/public/screenshot.png" alt="SpecProof coverage report" width="720" />

## Quick start

```bash
npm install -D specproof
npx specproof dev   # audit the current repo → http://localhost:3001
```

Also works with `bun`, `pnpm` and `yarn`.

## CLI

```bash
specproof generate [--out proof.json] [--check]   # compile the coverage proof
specproof dev                                     # generate + serve the report
specproof build && specproof start                # production build + serve
```

Run `specproof --help` for the full option list (`--repo`, `--spec`, `--out`, `--port`).

## License

MIT
