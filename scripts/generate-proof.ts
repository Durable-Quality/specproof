// Generates the coverage proof rendered by the SpecProof app from the
// audited target repo's OpenAPI spec + test suites (the current directory by
// default, override with SPECPROOF_REPO; spec auto-discovered, override with
// SPECPROOF_SPEC).
//
// Run via `bun run generate:proof` (also runs automatically before
// `bun run dev` / `bun run build`). The output is checked in at
// app/proof.generated.json; the proof-contract test fails if it goes stale
// relative to the spec or the tests. When no target spec is found, the
// existing artifact is left untouched so the app still builds and renders.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { buildCoverageReport, resolveSpecPath, TARGET_REPO_ROOT } from '../lib/api-test-coverage';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const GENERATED_PROOF_PATH = path.join(
  appRoot,
  'app/proof.generated.json'
);

export function buildProof(): Record<string, unknown> {
  return buildCoverageReport() as unknown as Record<string, unknown>;
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  if (!resolveSpecPath()) {
    console.warn(
      `generate-proof: no OpenAPI spec found under ${TARGET_REPO_ROOT} — ` +
        'set SPECPROOF_REPO to the repo to audit (or SPECPROOF_SPEC to the spec file); keeping the existing proof'
    );
    process.exit(0);
  }
  const proof = buildProof();
  const operationCount = (proof.operationCount as number) ?? 0;
  if (operationCount === 0) {
    console.error('generate-proof: no operations found in the OpenAPI spec — refusing to write an empty proof');
    process.exit(1);
  }
  fs.writeFileSync(GENERATED_PROOF_PATH, JSON.stringify(proof, null, 2) + '\n');
  console.log(`generate-proof: wrote ${path.relative(appRoot, GENERATED_PROOF_PATH)} (${operationCount} operations)`);
}
