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
import { spawn, spawnSync } from 'child_process';
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

const USAGE = `specproof — audit a repo's API test coverage against its OpenAPI spec

Usage: specproof <command> [options]

Commands:
  generate   Compile the coverage proof from the target repo's spec + tests
  dev        generate, then serve the audit view with next dev
  build      generate, then production-build the audit view
  start      Serve the production build

Options:
  --repo <path>   Repo to audit (default: current directory; env SPECPROOF_REPO)
  --spec <path>   OpenAPI spec (JSON or YAML), relative to the repo root when the
                  auto-discovery of openapi* / swagger* doesn't apply, or when a
                  repo holds more than one (env SPECPROOF_SPEC)
  --out <path>    generate only: where to write the proof (default: the app's
                  bundled artifact; env SPECPROOF_OUT)
  --check         generate only: verify the proof at --out is up to date instead
                  of writing — exits 1 on drift (the CI guard)
  --allow-empty   generate only: write a proof with no operations even when the
                  one being replaced had some
  --port <port>   dev/start only: port to serve on (default: 3001)
  --no-watch      dev only: don't rebuild the proof when the spec or tests change
`;

function fail(message: string): never {
  console.error(`specproof: ${message}\n\n${USAGE}`);
  process.exit(1);
}

const [command, ...rest] = process.argv.slice(2);

let port = '3001';
let watch = true;
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
  else if (arg === '--no-watch') {
    if (command !== 'dev') fail('--no-watch only applies to the dev command');
    watch = false;
  } else if (arg === '--out' || arg === '--check' || arg === '--allow-empty') {
    if (command !== 'generate') fail(`${arg} only applies to the generate command`);
    generateArgs.push(arg);
    if (arg === '--out') generateArgs.push(value());
  } else fail(`unknown option: ${arg}`);
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

// Resolve Next's bin relative to this package so the CLI works no matter
// where the consumer's package manager hoisted the dependency tree.
function nextBin(): string {
  const require = createRequire(import.meta.url);
  return require.resolve('next/dist/bin/next', { paths: [appRoot] });
}

function nextCli(...args: string[]): number {
  const result = spawnSync(process.execPath, [nextBin(), ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  return result.status ?? 1;
}

/**
 * Same, but without blocking the event loop — which `dev` requires, because
 * spawnSync would starve the watcher below and no file change would ever be
 * noticed while the server ran.
 */
function nextCliAsync(...args: string[]): Promise<number> {
  const child = spawn(process.execPath, [nextBin(), ...args], {
    stdio: 'inherit',
    env: process.env,
  });
  // Ctrl-C should stop the server, not orphan it behind an exiting CLI.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => child.kill(signal));
  }
  return new Promise((resolve) => child.on('exit', (code) => resolve(code ?? 1)));
}

const TEST_FILE_RE = /\.test\.(ts|tsx|js)$/;
const IGNORED_RE = /(^|[\\/])(node_modules|\.next|\.git|dist)([\\/]|$)/;

/**
 * Rebuild the proof whenever the audited repo's spec or tests change. The app
 * imports the generated artifact, so rewriting it is enough — Next's HMR
 * refreshes the audit view from there, and adding a path to the spec shows up
 * as a verdict without a restart.
 */
async function watchSources(onChange: () => void): Promise<void> {
  // Dynamic, for the same reason generate() is: a static import would freeze
  // the analyzer's view of SPECPROOF_REPO before the flags above parsed.
  const { looksLikeSpecFile } = await import('../lib/api-test-coverage.js');

  const root = path.resolve(process.env.SPECPROOF_REPO ?? process.cwd());
  const explicitSpec = process.env.SPECPROOF_SPEC
    ? path.resolve(root, process.env.SPECPROOF_SPEC)
    : null;

  // Matched by name rather than against the currently resolved spec, because
  // in the case this exists for the spec often doesn't exist yet: `specproof
  // dev` on an empty repo, then `touch openapi.yaml`, has to start watching a
  // file that wasn't there at startup.
  const isSource = (file: string): boolean => {
    if (IGNORED_RE.test(file)) return false;
    if (explicitSpec && path.resolve(root, file) === explicitSpec) return true;
    // Deliberately excludes the proof itself: when a repo audits itself, the
    // generator writes the artifact back into the watched tree, and treating
    // that as a source change would loop forever.
    return looksLikeSpecFile(path.basename(file)) || TEST_FILE_RE.test(file);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    fs.watch(root, { recursive: true }, (_event, file) => {
      if (!file || !isSource(String(file))) return;
      // Editors save in bursts (write, rename, chmod); coalesce them.
      clearTimeout(timer);
      timer = setTimeout(onChange, 150);
    });
  } catch {
    console.warn(
      'specproof: recursive file watching is unavailable on this platform. ' +
        'Re-run specproof dev to pick up spec changes, or pass --no-watch to silence this.'
    );
  }
}

async function main(): Promise<void> {
  switch (command) {
    case 'generate':
      process.exit(await generate(generateArgs));
      break;
    // dev/build always refresh the bundled artifact — it is what the app
    // renders. A consumer's committed copy (--out) is generate's concern.
    //
    // --allow-empty because the bundled artifact is a cache of whichever repo
    // was last audited, not a durable record of this one: the empty-proof guard
    // would otherwise compare operation counts across two unrelated repos and
    // refuse, leaving the previous repo's coverage on screen while claiming to
    // audit a scaffold. The guard still applies to an explicit --out.
    case 'dev': {
      if ((await generate(['--allow-empty'])) !== 0) {
        // A dev server that refuses to start on an unreadable spec is the
        // wrong trade: half-written YAML is the normal state of a file you
        // are editing, and with the watcher running the view heals on the
        // next save. Only guarantee the app has an artifact to import, so
        // Next can boot at all.
        const { emptyProof, GENERATED_PROOF_PATH } = await import('./generate-proof.js');
        if (!fs.existsSync(GENERATED_PROOF_PATH)) {
          fs.writeFileSync(
            GENERATED_PROOF_PATH,
            JSON.stringify(emptyProof(false), null, 2) + '\n'
          );
        }
        console.warn('specproof: starting anyway. The audit view will refresh once the spec parses.');
      }

      if (watch) {
        let running = false;
        await watchSources(() => {
          if (running) return; // a rebuild is already in flight; its own run picks up the latest
          running = true;
          void generate(['--allow-empty']).finally(() => {
            running = false;
          });
        });
      }

      process.exit(await nextCliAsync('dev', appRoot, '--port', port));
      break;
    }
    case 'build': {
      // Unlike dev, a spec that won't compile is a hard build failure.
      const generated = await generate(['--allow-empty']);
      if (generated !== 0) process.exit(generated);
      process.exit(nextCli('build', appRoot));
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
