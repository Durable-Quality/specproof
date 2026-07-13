// Generates the coverage ledger rendered by the Test Ledger app from the
// audited OmniLens checkout's OpenAPI spec + colocated route.test.ts suites
// (sibling ../OmniLens by default, override with OMNILENS_REPO).
//
// Run via `bun run generate:ledger` (also runs automatically before
// `bun run dev` / `bun run build`). The output is checked in at
// app/ledger.generated.json; the ledger-contract test fails if it goes stale
// relative to the spec or the route tests.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { buildCoverageReport, WEB_ROOT } from '../lib/api-test-coverage';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const GENERATED_LEDGER_PATH = path.join(
  appRoot,
  'app/ledger.generated.json'
);

export function buildLedger(): Record<string, unknown> {
  return buildCoverageReport() as unknown as Record<string, unknown>;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  if (!fs.existsSync(WEB_ROOT)) {
    console.error(
      `generate-ledger: OmniLens checkout not found at ${WEB_ROOT} — ` +
        'clone omnilens/OmniLens as a sibling of this repo, or point OMNILENS_REPO at a checkout'
    );
    process.exit(1);
  }
  const ledger = buildLedger();
  const operationCount = (ledger.operationCount as number) ?? 0;
  if (operationCount === 0) {
    console.error('generate-ledger: no operations found in the OmniLens OpenAPI spec — refusing to write an empty ledger');
    process.exit(1);
  }
  fs.writeFileSync(GENERATED_LEDGER_PATH, JSON.stringify(ledger, null, 2) + '\n');
  console.log(`generate-ledger: wrote ${path.relative(appRoot, GENERATED_LEDGER_PATH)} (${operationCount} operations)`);
}
