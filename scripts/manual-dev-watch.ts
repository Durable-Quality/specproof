#!/usr/bin/env bun
// Manual harness for the develop-alongside loop:
//
//   `specproof dev` on a repo with no spec, then `touch openapi.yaml` and add a
//   path — the audit view moves from the empty state to a verdict, no restart.
//
// Everything happens against a scratch target repo in the OS temp dir, never
// inside this checkout: a spec file living here would tie with (or beat)
// example/api/openapi.json in auto-discovery and quietly change what this
// repo's own tests audit.
//
// Usage (two terminals):
//   terminal 1:  bun run manual:dev      # scratch repo with no spec + specproof dev
//   terminal 2:  bun run manual:spec     # step 1 — touch openapi.yaml
//                bun run manual:path     # step 2 — add a documented operation
//                bun run manual:test     # step 3 — add a test that proves one status
//                bun run manual:status   # what the proof says right now
//                bun run manual:reset    # delete the scratch repo, restore this repo
//
// manual:dev restores this repo's checked-in app/proof.generated.json when it
// exits, because `specproof dev` rewrites that artifact from whichever repo it
// is auditing (see "Barebones specs" in CLAUDE.md).

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scratchRoot = path.join(os.tmpdir(), 'specproof-manual-target');
const scratchSpec = path.join(scratchRoot, 'openapi.yaml');
const scratchTest = path.join(scratchRoot, 'tests', 'widgets.test.ts');
const bundledProof = path.join(repoRoot, 'app', 'proof.generated.json');
// 3002, not the 3001 `bun run dev` uses: the walkthrough is worthless if the
// tab you are watching is served by an ordinary dev server auditing this repo,
// and a port clash between the two is the easiest way to end up there.
const port = process.env.PORT ?? '3002';

// One operation with two documented statuses, so the finished walkthrough shows
// both verdict states at once: 200 proven by the test below, 500 still untested.
const SPEC_WITH_PATH = `openapi: 3.1.0
info:
  title: Scratch API
  version: 0.1.0
paths:
  /widgets:
    get:
      tags:
        - Widgets
      summary: List widgets
      responses:
        '200':
          description: The widgets
        '500':
          description: Something went wrong
`;

const TEST_PROVING_200 = `import { describe, expect, it } from "vitest";

describe("GET /widgets", () => {
  it("returns 200 with the widget list", async () => {
    const res = await fetch("http://localhost:3000/widgets");

    expect(res.status).toBe(200);
  });
});
`;

function log(message: string): void {
  console.log(`manual: ${message}`);
}

/** The scratch repo, freshly emptied: a target with tests-shaped tooling and
 *  no API definition anywhere in it — where the walkthrough starts. */
function resetScratchRepo(): void {
  fs.rmSync(scratchRoot, { recursive: true, force: true });
  fs.mkdirSync(path.join(scratchRoot, 'tests'), { recursive: true });
  // Only so the audit view has a repo name to display; nothing installs here.
  fs.writeFileSync(
    path.join(scratchRoot, 'package.json'),
    JSON.stringify({ name: 'scratch-api', version: '0.0.0', private: true }, null, 2) + '\n'
  );
}

function requireScratchRepo(): void {
  if (fs.existsSync(scratchRoot)) return;
  console.error(
    `manual: no scratch repo at ${scratchRoot} yet: run \`bun run manual:dev\` first ` +
      '(it creates the repo, then serves it).'
  );
  process.exit(1);
}

function readProof(): { hasSpec?: boolean; operationCount?: number; repoName?: string } | null {
  try {
    return JSON.parse(fs.readFileSync(bundledProof, 'utf8'));
  } catch {
    return null;
  }
}

function status(): void {
  const spec = fs.existsSync(scratchSpec)
    ? fs.statSync(scratchSpec).size === 0
      ? 'openapi.yaml (empty)'
      : 'openapi.yaml'
    : 'none';
  const proof = readProof();
  log(`scratch repo: ${scratchRoot}`);
  log(`  spec:  ${spec}`);
  log(`  tests: ${fs.existsSync(scratchTest) ? path.relative(scratchRoot, scratchTest) : 'none'}`);
  if (!proof) {
    log('  proof: unreadable');
    return;
  }
  log(
    `  proof: repo=${proof.repoName} hasSpec=${proof.hasSpec} operations=${proof.operationCount}`
  );
}

/** What the audit view should be showing after each step, so the browser tab is
 *  checked against a stated expectation rather than a vibe. */
function expectation(step: string, expected: string): void {
  log(`${step}. Expect: ${expected}`);
  log('  (the page refreshes on its own; do not restart specproof dev)');
}

async function serve(): Promise<never> {
  resetScratchRepo();
  log(`scratch repo (no spec): ${scratchRoot}`);
  log(`serving http://localhost:${port}`);
  console.log('');
  log('expect right now: the empty state naming --repo / --spec (hasSpec: false)');
  log('then, in a second terminal:');
  log('  bun run manual:spec   # touch openapi.yaml   → empty state flips to the paths: hint');
  log('  bun run manual:path   # add GET /widgets     → a verdict appears, 200 + 500 untested');
  log('  bun run manual:test   # add a passing test   → 200 flips to proven, 500 stays untested');
  console.log('');

  // `specproof dev` rewrites the bundled artifact from the audited repo —
  // here, replacing this repo's committed TaskFlow proof with the scratch
  // repo's empty one, which is exactly the behavior step 0 is checking. Put the
  // real proof back on exit so the contract tests don't then fail on a scratch
  // repo's coverage.
  const snapshot = fs.existsSync(bundledProof) ? fs.readFileSync(bundledProof) : null;
  const restore = (): void => {
    if (snapshot === null) return;
    fs.writeFileSync(bundledProof, snapshot);
    log("restored this repo's app/proof.generated.json");
  };

  const child = spawn(
    process.execPath,
    [path.join(repoRoot, 'scripts', 'cli.ts'), 'dev', '--repo', scratchRoot, '--port', port],
    { stdio: 'inherit', cwd: repoRoot }
  );
  // Forward, don't swallow. A handler that does nothing keeps this wrapper
  // alive long enough to restore the artifact when Ctrl-C hits the whole
  // process group (the child gets its own copy of the signal that way) — but
  // it also makes a signal sent to this process alone a no-op, leaving a dev
  // server running whose watcher then rewrites the proof behind the restore.
  // Passing it on covers both.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => child.kill(signal));
  }

  const code: number = await new Promise((resolve) =>
    child.on('exit', (exitCode) => resolve(exitCode ?? 1))
  );
  restore();
  process.exit(code);
}

function main(): void {
  switch (process.argv[2] ?? 'serve') {
    case 'serve':
      void serve();
      break;
    case 'spec':
      requireScratchRepo();
      fs.writeFileSync(scratchSpec, '');
      expectation(
        'step 1: touched openapi.yaml (empty)',
        'still the empty state, but now the "add a paths: stanza" hint (hasSpec: true)'
      );
      break;
    case 'path':
      requireScratchRepo();
      fs.writeFileSync(scratchSpec, SPEC_WITH_PATH);
      expectation(
        'step 2: documented GET /widgets (200, 500)',
        'a Widgets section with GET /widgets, both statuses stamped untested'
      );
      break;
    case 'test':
      requireScratchRepo();
      fs.mkdirSync(path.dirname(scratchTest), { recursive: true });
      fs.writeFileSync(scratchTest, TEST_PROVING_200);
      expectation(
        'step 3: added tests/widgets.test.ts asserting 200',
        '200 stamped proven with the it() snippet; 500 still untested'
      );
      break;
    case 'status':
      status();
      break;
    case 'reset':
      fs.rmSync(scratchRoot, { recursive: true, force: true });
      log(`removed ${scratchRoot}`);
      log("run `bun run generate:proof` to put this repo's own proof back if it looks stale");
      break;
    default:
      console.error(
        `manual: unknown step: ${process.argv[2]}\n` +
          'Steps: serve (default), spec, path, test, status, reset'
      );
      process.exit(1);
  }
}

main();
