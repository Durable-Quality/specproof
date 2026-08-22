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

import { CliUsageError, parseCliArgs, USAGE } from './cli-args.js';

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

function fail(message: string): never {
  console.error(`specproof: ${message}\n\n${USAGE}`);
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);

let invocation;
try {
  invocation = parseCliArgs(command, rest);
} catch (error) {
  if (error instanceof CliUsageError) fail(error.message);
  throw error;
}

const { port, generateArgs } = invocation;

// --repo/--spec become env vars so the analyzer (which reads them at import
// time) picks them up when the generator is dynamically imported below.
if (invocation.repo !== undefined) process.env.SPECPROOF_REPO = invocation.repo;
if (invocation.spec !== undefined) process.env.SPECPROOF_SPEC = invocation.spec;

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
