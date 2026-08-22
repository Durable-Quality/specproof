// Argument parsing for the SpecProof CLI, split out from scripts/cli.ts so it
// can be unit-tested: cli.ts is a bin entrypoint that runs main() and calls
// process.exit() at import time, which a test cannot import safely.
//
// This module is pure: it neither reads nor writes process.env. Applying the
// parsed result (setting SPECPROOF_REPO/SPECPROOF_SPEC before the generator is
// dynamically imported) stays in cli.ts, where the ordering is load-bearing.

export const USAGE = `specproof: audit a repo's API test coverage against its OpenAPI spec

Usage: specproof <command> [options]

Commands:
  generate   Compile the coverage proof from the target repo's spec + tests
  dev        generate, then serve the audit view with next dev
  build      generate, then production-build the audit view
  start      Serve the production build

Options:
  --repo <path>   Repo to audit (default: current directory; env SPECPROOF_REPO)
  --spec <path>   OpenAPI spec (JSON or YAML), for when auto-discovery of
                  openapi* / swagger* doesn't apply, or when a repo holds more
                  than one. A relative path is resolved against the audited repo
                  root, then the current directory, then the enclosing git root;
                  an absolute path is taken as-is (env SPECPROOF_SPEC)
  --out <path>    generate only: where to write the proof (default: the app's
                  bundled artifact; env SPECPROOF_OUT)
  --check         generate only: verify the proof at --out is up to date instead
                  of writing: exits 1 on drift (the CI guard)
  --port <port>   dev/start only: port to serve on (default: 3001)
`;

export interface CliInvocation {
  /** Port for dev/start. */
  port: string;
  /** argv slice forwarded to the generator's own parser (--out / --check). */
  generateArgs: string[];
  /** --repo, verbatim; cli.ts puts it in SPECPROOF_REPO. */
  repo?: string;
  /** --spec, verbatim; cli.ts puts it in SPECPROOF_SPEC. */
  spec?: string;
}

/** Thrown for anything the caller should turn into usage text and exit 1. */
export class CliUsageError extends Error {}

/**
 * Parse the options following a command. `command` is needed because --out and
 * --check only apply to generate, and are rejected rather than ignored
 * elsewhere.
 */
export function parseCliArgs(command: string | undefined, rest: string[]): CliInvocation {
  const invocation: CliInvocation = { port: '3001', generateArgs: [] };

  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const value = () => {
      const v = rest[++i];
      if (!v) throw new CliUsageError(`${arg} requires a value`);
      return v;
    };

    if (arg === '--repo') invocation.repo = value();
    else if (arg === '--spec') invocation.spec = value();
    else if (arg === '--port') invocation.port = value();
    else if (arg === '--out' || arg === '--check') {
      if (command !== 'generate') {
        throw new CliUsageError(`${arg} only applies to the generate command`);
      }
      invocation.generateArgs.push(arg);
      if (arg === '--out') invocation.generateArgs.push(value());
    } else throw new CliUsageError(`unknown option: ${arg}`);
  }

  return invocation;
}
