<img src="https://raw.githubusercontent.com/Durable-Quality/specproof/main/public/icon.png" alt="SpecProof" width="120" />

# SpecProof

Audit your API test coverage against your OpenAPI spec. SpecProof cross-examines every operation and response status against your test suite's assertions and renders the verdicts as a browsable report.

<img src="https://raw.githubusercontent.com/Durable-Quality/specproof/main/public/specproof.gif" alt="SpecProof coverage report walkthrough" width="720" />

## Quick start

```bash
bun add -d specproof
bunx specproof dev          # audit the current repo → http://localhost:3001
bun add -d specproof@latest # update to the latest version
```

Also works with `npm`, `pnpm` and `yarn`.

Starting from scratch works too! SpecProof opens on an empty or half-written spec and rebuilds the report as you add operations, so you can write the spec and watch coverage appear beside it.

## CLI

```bash
specproof generate [--out proof.json] [--check]   # compile the coverage proof
specproof dev                                     # generate + serve the report, rebuilding on change
specproof build && specproof start                # production build + serve
```

Run `specproof --help` for the full option list:

- `--repo`
- `--spec`
- `--out`
- `--port`
- `--allow-empty`
- `--no-watch`

## Telemetry

SpecProof sends one anonymous event per command, so we can see how many people use it and which features matter. npm's download counts can't tell us that. It says so the first time it runs.

Turn it off with any of:

```bash
specproof telemetry disable    # saved for this machine
SPECPROOF_TELEMETRY=0          # per run or in CI
DO_NOT_TRACK=1                 # the cross-tool standard
```

`specproof telemetry` shows the current setting. To see exactly what would be sent without sending it, set `SPECPROOF_TELEMETRY_DEBUG=1` (this prints everything the CLI itself builds, but not the approximate location below, which is added after the event arrives).

**What an event contains:** the command (`generate`, `dev`, `build`, `start`), the names of the flags used (never their values), whether it succeeded and how long it took, the SpecProof version, Node major version, OS and CPU architecture, package manager, whether it ran in CI and which provider, and the report's shape in ranges: operation and response counts (for example `10-49`), untested operations, and verified coverage rounded down to 10%. No person profile is ever created, so events aren't tied to an identity, but PostHog's GeoIP lookup does attach an approximate location (city, country, coordinates, timezone) derived from the sending machine's IP address at the time the event arrives.

**Identifiers:** a random ID created on first run and stored in `~/.config/specproof/telemetry.json` (`%APPDATA%\specproof` on Windows), and a salted hash of the repo's git remote, so we can count repos without receiving their URLs.

**Never sent:** code, file paths, spec or test contents, repo or package names, or flag values.

Events go to [PostHog](https://posthog.com) (EU region) as anonymous events, with no person profiles. The IP address used for that GeoIP lookup is not otherwise stored: the project is set to discard it once the event is enriched.

## License

MIT
