#!/usr/bin/env node
// SpecProof CLI — the entrypoint when the package is installed into a target
// repo (`npx specproof <command>`, or the bunx/pnpm dlx/yarn dlx equivalent).
// Audits the repo it is run from (override with --repo / SPECPROOF_REPO)
// while Next.js dev/build/start run against the SpecProof package directory
// itself, wherever it is installed.
//
// Ships as plain compiled JS (see tsconfig.cli.json / `build:cli`) so it runs
// under any package manager's Node — no TypeScript-execution runtime like Bun
// required at install time.

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

// This file runs both as source (scripts/cli.ts, via `bun run dev` in this
// repo's own dev loop) and compiled (dist/scripts/cli.js, once installed as
// a dependency — see tsconfig.cli.json) — one directory level deeper than
// the package root. Walking up to the nearest package.json finds the right
// root either way, rather than hardcoding a hop count that only holds for
// one of the two layouts.
function findPackageRoot(startDir: string): string {
  let dir = startDir;
  while (!fs.existsSync(path.join(dir, 'package.json'))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error(`could not locate package.json above ${startDir}`);
    dir = parent;
  }
  return dir;
}

const appRoot = findPackageRoot(path.dirname(fileURLToPath(import.meta.url)));

const USAGE = `specproof — audit a repo's API test coverage against its OpenAPI spec

Usage: specproof <command> [options]

Commands:
  generate   Compile the coverage proof from the target repo's spec + tests
  dev        generate, then serve the audit view with next dev
  build      generate, then production-build the audit view
  start      Serve the production build

Options:
  --repo <path>   Repo to audit (default: current directory; env SPECPROOF_REPO)
  --spec <path>   OpenAPI spec, relative to the repo root when the auto-discovery
                  of openapi*.json / swagger*.json doesn't apply (env SPECPROOF_SPEC)
  --out <path>    generate only: where to write the proof (default: the app's
                  bundled artifact; env SPECPROOF_OUT)
  --check         generate only: verify the proof at --out is up to date instead
                  of writing — exits 1 on drift (the CI guard)
  --port <port>   dev/start only: port to serve on (default: 3001)
`;

function fail(message: string): never {
  console.error(`specproof: ${message}\n\n${USAGE}`);
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);

let port = '3001';
const generateArgs: string[] = [];
for (let i = 0; i < rest.length; i++) {
  const arg = rest[i];
  const value = () => {
    const v = rest[++i];
    if (!v) fail(`${arg} requires a value`);
    return v;
  };
  // --repo/--spec become env vars so the analyzer (which reads them at import
  // time) picks them up when the generator is dynamically imported below.
  if (arg === '--repo') process.env.SPECPROOF_REPO = value();
  else if (arg === '--spec') process.env.SPECPROOF_SPEC = value();
  else if (arg === '--port') port = value();
  else if (arg === '--out' || arg === '--check') {
    if (command !== 'generate') fail(`${arg} only applies to the generate command`);
    generateArgs.push(arg);
    if (arg === '--out') generateArgs.push(value());
  } else fail(`unknown option: ${arg}`);
}

async function generate(argv: string[]): Promise<number> {
  // Dynamic import so the env vars set above are read, not the values at CLI
  // startup, and so this works as a plain Node ESM import (no synchronous
  // require-of-ESM, which Node — unlike Bun — cannot do).
  const { parseGenerateArgs, runGenerate } = await import('./generate-proof.js');
  return runGenerate(parseGenerateArgs(argv));
}

function nextCli(...args: string[]): number {
  const require = createRequire(import.meta.url);
  // Resolve Next's bin relative to this package so the CLI works no matter
  // where the consumer's package manager hoisted the dependency tree.
  const nextBin = require.resolve('next/dist/bin/next', { paths: [appRoot] });
  const result = spawnSync(process.execPath, [nextBin, ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  return result.status ?? 1;
}

async function main(): Promise<void> {
  switch (command) {
    case 'generate':
      process.exit(await generate(generateArgs));
      break;
    case 'dev':
    case 'build': {
      // dev/build always refresh the bundled artifact — it is what the app
      // renders. A consumer's committed copy (--out) is generate's concern.
      const generated = await generate([]);
      if (generated !== 0) process.exit(generated);
      process.exit(
        command === 'dev'
          ? nextCli('dev', appRoot, '--port', port)
          : nextCli('build', appRoot)
      );
      break;
    }
    case 'start':
      process.exit(nextCli('start', appRoot, '--port', port));
      break;
    case 'help':
    case '--help':
    case '-h':
    case undefined:
      console.log(USAGE);
      process.exit(command ? 0 : 1);
      break;
    default:
      fail(`unknown command: ${command}`);
  }
}

main();
